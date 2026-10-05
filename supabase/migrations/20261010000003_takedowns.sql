-- Phase 6.5: report / takedown flow and the platform emergency switch.
--
--   * Anyone can report a published page (rate limited, Turnstile, no account). The server inserts
--     through create_takedown_request(), service role only; a single open report per page and contact
--     is kept, and a page can hold at most 20 open reports, so a flood cannot grow the table.
--   * A report never removes a page by itself (anyone could otherwise delete anyone's page). The
--     workspace owners and the platform admin are told; either can unpublish, and the platform admin
--     can disable a page, which publishes nothing until it is restored and cannot be undone by the
--     workspace.
--
-- Rollback (dev only): drop the functions below, drop the view column filter by recreating the view
-- without disabled_at, drop column disabled_at and ip_hash, drop the partial index.

alter table public.case_studies add column disabled_at timestamptz;
alter table public.takedown_requests add column ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$');

create unique index takedown_requests_one_open_per_contact
  on public.takedown_requests (case_study_id, lower(contact_email))
  where status in ('open', 'reviewing');

-- Disabled pages disappear from the public view at once.
create or replace view public.public_case_studies
with (security_barrier = true)
as
select
  w.subdomain_slug                          as workspace_slug,
  w.name                                    as workspace_name,
  (w.plan = 'free')                         as show_badge,
  cs.slug                                   as slug,
  cs.content #- '{client,logoPath}'         as content,
  cs.content #>> '{client,logoPath}'        as logo_path,
  cs.theme_settings                         as theme_settings,
  cs.published_at                           as published_at,
  t.id                                      as template_id,
  t.name                                    as template_name,
  t.category                                as template_category,
  t.tier                                    as template_tier,
  t.sections                                as template_sections,
  t.default_theme                           as template_default_theme,
  t.active                                  as template_active
from public.case_studies cs
join public.workspaces w on w.id = cs.workspace_id
left join public.templates t on t.id = coalesce(
  cs.template_id,
  (select d.id from public.templates d where d.tier = 'free' and d.active order by (d.name = 'Classic') desc, d.name limit 1)
)
where cs.status = 'published'
  and cs.disabled_at is null
  and cs.slug is not null
  and w.subdomain_slug is not null;

-- A disabled page cannot be published again by the workspace.
create or replace function public.enforce_publish_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stored jsonb;
  bad_refs int;
  workspace_slug text;
begin
  if old.status = 'published' and new.status = 'published' and new.content is distinct from old.content then
    new.status := 'draft';
    new.published_at := null;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    if new.disabled_at is not null then
      raise exception 'publish_blocked:disabled';
    end if;
    if new.client_declined_at is not null then
      raise exception 'publish_blocked:declined';
    end if;

    if not exists (select 1 from public.approvals a where a.case_study_id = new.id and a.version = new.current_version) then
      raise exception 'publish_blocked:not_approved';
    end if;
    select v.content into stored from public.case_study_versions v
    where v.case_study_id = new.id and v.version = new.current_version;
    if stored is distinct from new.content then
      raise exception 'publish_blocked:not_approved';
    end if;
    if jsonb_typeof(new.content -> 'sections') <> 'array' or jsonb_array_length(new.content -> 'sections') = 0 then
      raise exception 'publish_blocked:empty';
    end if;

    if new.template_id is not null and not public.template_allowed(new.workspace_id, new.template_id) then
      raise exception 'publish_blocked:template_locked';
    end if;

    if new.slug is null
       or new.slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'
       or new.slug ~ '--'
       or public.is_reserved_slug(new.slug) then
      raise exception 'publish_blocked:bad_slug';
    end if;
    select w.subdomain_slug into workspace_slug from public.workspaces w where w.id = new.workspace_id;
    if workspace_slug is null then
      raise exception 'publish_blocked:no_workspace_address';
    end if;

    if exists (select 1 from public.claims c where c.case_study_id = new.id and not c.client_confirmed) then
      raise exception 'publish_blocked:claims_unconfirmed';
    end if;
    select count(*) into bad_refs
    from (
      select (j #>> '{}') as ref
      from jsonb_path_query(new.content, '$.sections[*].metrics[*].claimId') j
      union all
      select (j #>> '{}')
      from jsonb_path_query(new.content, '$.sections[*].quote.claimId') j
    ) refs
    where refs.ref !~ '^[0-9a-f-]{36}$'
       or not exists (
         select 1 from public.claims c
         where c.id = refs.ref::uuid and c.case_study_id = new.id and c.client_confirmed
       );
    if bad_refs > 0 then
      raise exception 'publish_blocked:claims_unconfirmed';
    end if;

    new.published_at := now();
  elsif old.status = 'published' and new.status is distinct from 'published' then
    new.published_at := null;
  end if;

  return new;
end
$$;

-- Server only: a public report about a published page.
create function public.create_takedown_request(ws_slug text, study_slug text, report_reason text, email text, ip text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  new_id uuid;
begin
  select c.* into cs
  from public.case_studies c join public.workspaces w on w.id = c.workspace_id
  where w.subdomain_slug = ws_slug and c.slug = study_slug and c.status = 'published' and c.disabled_at is null;
  if cs.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.takedown_requests t where t.case_study_id = cs.id and t.status in ('open', 'reviewing')) >= 20 then
    raise exception 'Too many open reports' using errcode = '54000';
  end if;
  insert into public.takedown_requests (case_study_id, workspace_id, reason, contact_email, ip_hash)
  values (cs.id, cs.workspace_id, report_reason, lower(btrim(email)), ip)
  returning id into new_id;
  perform public.audit(cs.workspace_id, 'takedown.report', cs.id::text);
  return new_id;
end
$$;

-- Server only (platform admin): switch a page off for everyone, or back on.
create function public.set_case_study_disabled(study uuid, disable boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
begin
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if disable then
    update public.case_studies
      set disabled_at = now(), status = case when status = 'published' then 'unpublished' else status end
      where id = study;
    update public.takedown_requests set status = 'actioned' where case_study_id = study and status in ('open', 'reviewing');
    perform public.audit(cs.workspace_id, 'takedown.disable', study::text);
  else
    update public.case_studies set disabled_at = null where id = study;
    perform public.audit(cs.workspace_id, 'takedown.restore', study::text);
  end if;
end
$$;

-- Server only (platform admin): move a report along.
create function public.resolve_takedown(request uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_status not in ('reviewing', 'actioned', 'dismissed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.takedown_requests set status = new_status where id = request;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.create_takedown_request(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_case_study_disabled(uuid, boolean) from public, anon, authenticated;
revoke all on function public.resolve_takedown(uuid, text) from public, anon, authenticated;
grant execute on function public.create_takedown_request(text, text, text, text, text) to service_role;
grant execute on function public.set_case_study_disabled(uuid, boolean) to service_role;
grant execute on function public.resolve_takedown(uuid, text) to service_role;

