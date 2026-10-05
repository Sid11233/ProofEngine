-- Phase 7.2-7.3: privacy-light page analytics and the dashboard's aggregation views.
--
--   * record_page_event() (service role only) is the single write path into page_events. It stores the
--     event type, the case study, a hostname-only referrer and a timestamp. No IP, no user agent, no
--     visitor id: the table has no column for them, and the function never receives them.
--   * The dashboard reads four views created WITH security_invoker, so the caller's own row-level
--     security applies to the underlying tables: a user only ever sees their own workspaces' numbers.
--   * The public view also exposes the workspace website, used for the page's call-to-action link.
--
-- Rollback (dev only): drop the views and the function below, drop trigger page_events_append_only,
-- and recreate public_case_studies without workspace_website.

create trigger page_events_append_only
  before update or delete on public.page_events
  for each row execute function public.reject_mutation();

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
  t.active                                  as template_active,
  w.website                                 as workspace_website
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

create function public.record_page_event(ws_slug text, study_slug text, event_type text, ref_host text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  host text;
begin
  if event_type is null or event_type not in ('view', 'cta_click', 'referral_click') then
    raise exception 'Invalid event' using errcode = '22023';
  end if;
  select c.* into cs
  from public.case_studies c join public.workspaces w on w.id = c.workspace_id
  where w.subdomain_slug = ws_slug and c.slug = study_slug and c.status = 'published' and c.disabled_at is null;
  if cs.id is null then
    return false;
  end if;
  -- Hostname only: anything else is dropped rather than stored.
  host := lower(btrim(coalesce(ref_host, '')));
  if host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' or char_length(host) > 253 then
    host := null;
  end if;
  insert into public.page_events (case_study_id, workspace_id, type, referrer)
  values (cs.id, cs.workspace_id, event_type, host);
  return true;
end
$$;

revoke all on function public.record_page_event(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_page_event(text, text, text, text) to service_role;

-- Daily event counts per page and type (UTC days).
create view public.page_event_daily
with (security_invoker = true)
as
select workspace_id, case_study_id, (created_at at time zone 'utc')::date as day, type, count(*)::int as events
from public.page_events
group by workspace_id, case_study_id, (created_at at time zone 'utc')::date, type;

create view public.case_study_status_counts
with (security_invoker = true)
as
select workspace_id, status, count(*)::int as n
from public.case_studies
group by workspace_id, status;

create view public.referral_status_counts
with (security_invoker = true)
as
select workspace_id, status, count(*)::int as n
from public.referrals
group by workspace_id, status;

-- Requests sent (everything past draft), interviews started and interviews completed, per workspace.
create view public.request_funnel
with (security_invoker = true)
as
select
  r.workspace_id,
  count(*) filter (where r.status <> 'draft')::int as sent,
  count(i.id)::int as started,
  count(i.id) filter (where i.status = 'completed')::int as completed
from public.proof_requests r
left join public.interviews i on i.request_id = r.id and i.workspace_id = r.workspace_id
group by r.workspace_id;

revoke all on public.page_event_daily, public.case_study_status_counts, public.referral_status_counts, public.request_funnel from public, anon;
grant select on public.page_event_daily, public.case_study_status_counts, public.referral_status_counts, public.request_funnel to authenticated;
