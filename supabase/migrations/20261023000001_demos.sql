-- Demos: interactive product demos (screenshots, simulated chat, workflow, before/after) that owners build and
-- publish on their public pages. Content is JSON, never HTML.
--
--   demos               The demo. Editors write drafts; only admins publish (publish_demo), and a trigger enforces the
--                       rules: authenticity and redaction attested, no unresolved flagged screenshot, a valid unreserved
--                       slug, the plan's limit on live demos, and never a blocked demo. Publishing snapshots the content.
--   demo_versions       Snapshots. Insert-only (written by the publish trigger).
--   demo_assets         Screenshot files in the private demo-assets bucket. Rows are written by the server only.
--   demo_embed_origins  Websites allowed to frame the demo (admin+).
--   demo_leads          People who left an email at the lead gate, with their consent. Server inserts only.
--   demo_events         view / step / complete / cta_click / lead. No IP, no user agent, no visitor id. Server inserts only.
--   demo_reports        "Report this demo". Server inserts only; reviewed by platform operators.
--   public_demos        The one thing an anonymous visitor may read: published demos.
--
-- Rollback (dev only): drop view public.public_demos; drop the seven tables above and the functions publish_demo,
--   unpublish_demo, resolve_demo_asset, set_demo_blocked, plan_demo_limit and the demo trigger functions;
--   delete from storage.buckets where id = 'demo-assets'; delete from public.consent_texts where version = 'demo-lead-v1'.

-- ---------------------------------------------------------------------------
-- Plan limit on live demos (src/lib/billing/plans.ts must match; a test checks it)
-- ---------------------------------------------------------------------------

create function public.plan_demo_limit(plan text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case plan when 'pro' then 10 when 'team' then 50 else 1 end
$$;
revoke all on function public.plan_demo_limit(text) from public, anon;
grant execute on function public.plan_demo_limit(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Lead consent wording (versioned like the signing release; placeholder until a lawyer reviews it)
-- ---------------------------------------------------------------------------

insert into public.consent_texts (version, kind, body)
values ('demo-lead-v1', 'demo_lead_consent',
  'LAWYER REVIEW REQUIRED. PLACEHOLDER TEXT, NOT LEGAL ADVICE. I agree that the business that made this demo may store my name and email address and contact me about it. I can ask them to delete my details at any time.');

-- ---------------------------------------------------------------------------
-- demos
-- ---------------------------------------------------------------------------

create table public.demos (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  created_by             uuid references auth.users (id) on delete set null,
  title                  text not null check (char_length(btrim(title)) between 1 and 120),
  slug                   text check (slug is null or (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' and slug !~ '--')),
  status                 text not null default 'draft' check (status in ('draft', 'review', 'published', 'unpublished', 'blocked')),
  content                jsonb not null default '{"scenes":[]}'::jsonb
                           check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 300000),
  theme                  jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(theme) = 'object' and octet_length(theme::text) <= 10000),
  settings               jsonb not null default '{"lead_gate":"none","allow_embed":false}'::jsonb
                           check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 10000
                                  and coalesce(settings ->> 'lead_gate', 'none') in ('none', 'start', 'end')),
  current_version        int not null default 1 check (current_version >= 1),
  case_study_id          uuid,
  authenticity_attested  boolean not null default false,
  redaction_acknowledged boolean not null default false,
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id),
  foreign key (case_study_id, workspace_id) references public.case_studies (id, workspace_id) on delete set null (case_study_id)
);

create index demos_workspace_idx on public.demos (workspace_id);
create index demos_workspace_status_idx on public.demos (workspace_id, status);

alter table public.demos enable row level security;

create policy demos_select_member on public.demos
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demos_select_member on public.demos is
  'Members read their own workspace''s demos, and no other workspace''s.';

create policy demos_insert_editor on public.demos
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and status = 'draft' and created_by = (select auth.uid()));
comment on policy demos_insert_editor on public.demos is
  'Editors and above create demos, always as drafts and attributed to themselves.';

create policy demos_update_editor on public.demos
  for update to authenticated
  using (public.is_member(workspace_id, 'editor') and status in ('draft', 'review', 'unpublished'))
  with check (public.is_member(workspace_id, 'editor') and status in ('draft', 'review', 'unpublished'));
comment on policy demos_update_editor on public.demos is
  'Editors and above edit demos that are not live or blocked. Status, slug and version are not updatable by clients (column privileges): publishing goes through publish_demo.';

create policy demos_delete_admin on public.demos
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin') and status <> 'blocked');
comment on policy demos_delete_admin on public.demos is
  'Admins and above delete a demo, except one the platform blocked (that record is kept).';

revoke all on public.demos from anon, authenticated, service_role;
grant select on public.demos to authenticated;
-- The server-only role may write demos too (tests and operator scripts); the publish rules still apply to every writer through the trigger.
grant select, insert, update on public.demos to service_role;
grant insert (workspace_id, created_by, title, content, theme, settings, case_study_id) on public.demos to authenticated;
grant update (title, content, theme, settings, case_study_id, authenticity_attested, redaction_acknowledged) on public.demos to authenticated;
grant delete on public.demos to authenticated;

-- ---------------------------------------------------------------------------
-- demo_versions (insert-only) and demo_events (insert-only): children may only go with their demo
-- ---------------------------------------------------------------------------

create function public.reject_demo_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deleting the demo (or a purge, or a deleted workspace) removes its children; nothing else may change them.
  if tg_op = 'DELETE' and (
       coalesce(current_setting('pe.purge', true), '') = 'on'
       or not exists (select 1 from public.demos d where d.id = old.demo_id)
     ) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;
revoke all on function public.reject_demo_child_mutation() from public, anon, authenticated;

create table public.demo_versions (
  id            uuid primary key default gen_random_uuid(),
  demo_id       uuid not null,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  version       int not null check (version >= 1),
  content       jsonb not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (demo_id, version),
  foreign key (demo_id, workspace_id) references public.demos (id, workspace_id) on delete cascade
);
create index demo_versions_workspace_idx on public.demo_versions (workspace_id);
create index demo_versions_demo_idx on public.demo_versions (demo_id);

alter table public.demo_versions enable row level security;
create policy demo_versions_select_member on public.demo_versions
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demo_versions_select_member on public.demo_versions is
  'Members read their own workspace''s demo snapshots. There is deliberately no insert, update or delete policy: snapshots are written by the publish trigger and never changed.';
revoke all on public.demo_versions from anon, authenticated, service_role;
grant select on public.demo_versions to authenticated;
grant select, insert on public.demo_versions to service_role;
create trigger demo_versions_append_only before update or delete on public.demo_versions
  for each row execute function public.reject_demo_child_mutation();

create table public.demo_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  demo_id       uuid not null,
  type          text not null check (type in ('view', 'step', 'complete', 'cta_click', 'lead')),
  step_index    int check (step_index is null or step_index between 0 and 200),
  created_at    timestamptz not null default now(),
  foreign key (demo_id, workspace_id) references public.demos (id, workspace_id) on delete cascade
);
create index demo_events_workspace_idx on public.demo_events (workspace_id);
create index demo_events_demo_idx on public.demo_events (demo_id, created_at);

alter table public.demo_events enable row level security;
create policy demo_events_select_member on public.demo_events
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demo_events_select_member on public.demo_events is
  'Members read their own workspace''s demo analytics. Events carry no IP address, user agent or visitor id, are inserted only by the server and never changed.';
revoke all on public.demo_events from anon, authenticated, service_role;
grant select on public.demo_events to authenticated;
grant select, insert on public.demo_events to service_role;
create trigger demo_events_append_only before update or delete on public.demo_events
  for each row execute function public.reject_demo_child_mutation();

-- ---------------------------------------------------------------------------
-- demo_assets
-- ---------------------------------------------------------------------------

create table public.demo_assets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  demo_id       uuid not null,
  -- {workspace_id}/{demo_id}/{uuid}.webp in the private demo-assets bucket
  file_path     text not null,
  kind          text not null check (kind in ('screenshot', 'image', 'logo')),
  width         int not null check (width between 1 and 10000),
  height        int not null check (height between 1 and 10000),
  size_bytes    int not null check (size_bytes between 1 and 5242880),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  flagged       boolean not null default false,
  flag_reason   text check (flag_reason is null or char_length(flag_reason) <= 300),
  resolution    text check (resolution is null or resolution in ('blurred', 'acknowledged')),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (file_path ~ ('^' || workspace_id::text || '/' || demo_id::text || '/[0-9a-f-]{36}\.webp$')),
  foreign key (demo_id, workspace_id) references public.demos (id, workspace_id) on delete cascade
);
create index demo_assets_workspace_idx on public.demo_assets (workspace_id);
create index demo_assets_demo_idx on public.demo_assets (demo_id);

create function public.limit_demo_assets()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.demo_assets a where a.demo_id = new.demo_id) >= 40 then
    raise exception 'A demo can have at most 40 images' using errcode = '54000';
  end if;
  return new;
end
$$;
revoke all on function public.limit_demo_assets() from public, anon, authenticated;
create trigger demo_assets_limit before insert on public.demo_assets
  for each row execute function public.limit_demo_assets();

alter table public.demo_assets enable row level security;
create policy demo_assets_select_member on public.demo_assets
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demo_assets_select_member on public.demo_assets is
  'Members read their own workspace''s asset records. Rows are inserted and changed only by the server (service role) after it has validated and re-encoded the file; owners resolve a flag only through resolve_demo_asset().';
revoke all on public.demo_assets from anon, authenticated, service_role;
grant select on public.demo_assets to authenticated;
grant select, insert, update, delete on public.demo_assets to service_role;

-- ---------------------------------------------------------------------------
-- demo_embed_origins (admin+ manage)
-- ---------------------------------------------------------------------------

create table public.demo_embed_origins (
  id            uuid primary key default gen_random_uuid(),
  demo_id       uuid not null,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  origin        text not null check (char_length(origin) <= 253 and origin ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'),
  unique (demo_id, origin),
  foreign key (demo_id, workspace_id) references public.demos (id, workspace_id) on delete cascade
);
create index demo_embed_origins_workspace_idx on public.demo_embed_origins (workspace_id);
create index demo_embed_origins_demo_idx on public.demo_embed_origins (demo_id);

create function public.limit_demo_origins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.demo_embed_origins o where o.demo_id = new.demo_id) >= 10 then
    raise exception 'A demo can allow at most 10 websites' using errcode = '54000';
  end if;
  return new;
end
$$;
revoke all on function public.limit_demo_origins() from public, anon, authenticated;
create trigger demo_embed_origins_limit before insert on public.demo_embed_origins
  for each row execute function public.limit_demo_origins();

alter table public.demo_embed_origins enable row level security;
create policy demo_embed_origins_select_member on public.demo_embed_origins
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demo_embed_origins_select_member on public.demo_embed_origins is
  'Members read their own workspace''s allowed websites (they are also public, as the frame-ancestors header of a published embed).';
create policy demo_embed_origins_insert_admin on public.demo_embed_origins
  for insert to authenticated
  with check (public.is_member(workspace_id, 'admin'));
comment on policy demo_embed_origins_insert_admin on public.demo_embed_origins is
  'Admins and above allow a website to embed one of their demos. The origin format is a table constraint.';
create policy demo_embed_origins_update_admin on public.demo_embed_origins
  for update to authenticated
  using (public.is_member(workspace_id, 'admin'))
  with check (public.is_member(workspace_id, 'admin'));
comment on policy demo_embed_origins_update_admin on public.demo_embed_origins is
  'Admins and above change the origin (the only updatable column).';
create policy demo_embed_origins_delete_admin on public.demo_embed_origins
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy demo_embed_origins_delete_admin on public.demo_embed_origins is
  'Admins and above stop allowing a website.';
revoke all on public.demo_embed_origins from anon, authenticated, service_role;
grant select on public.demo_embed_origins to authenticated;
grant insert (demo_id, workspace_id, origin) on public.demo_embed_origins to authenticated;
grant update (origin) on public.demo_embed_origins to authenticated;
grant delete on public.demo_embed_origins to authenticated;
grant select, insert, update, delete on public.demo_embed_origins to service_role;

-- ---------------------------------------------------------------------------
-- demo_leads
-- ---------------------------------------------------------------------------

create table public.demo_leads (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  demo_id               uuid not null,
  email                 text not null check (char_length(email) between 3 and 320 and email like '%_@_%'),
  name                  text check (name is null or char_length(name) <= 200),
  consent               boolean not null check (consent),
  consent_text_version  text not null references public.consent_texts (version),
  step_reached          int check (step_reached is null or step_reached between 0 and 200),
  created_at            timestamptz not null default now(),
  foreign key (demo_id, workspace_id) references public.demos (id, workspace_id) on delete cascade
);
create index demo_leads_workspace_idx on public.demo_leads (workspace_id);
create index demo_leads_demo_idx on public.demo_leads (demo_id, created_at);

alter table public.demo_leads enable row level security;
create policy demo_leads_select_member on public.demo_leads
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy demo_leads_select_member on public.demo_leads is
  'Members read their own workspace''s leads. Leads are inserted only by the server, after consent and bot checks.';
create policy demo_leads_delete_admin on public.demo_leads
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy demo_leads_delete_admin on public.demo_leads is
  'Admins and above delete a lead when the person asks for their details to be removed.';
revoke all on public.demo_leads from anon, authenticated, service_role;
grant select, delete on public.demo_leads to authenticated;
grant select, insert on public.demo_leads to service_role;

-- ---------------------------------------------------------------------------
-- demo_reports (service role only; reviewed by platform operators)
-- ---------------------------------------------------------------------------

create table public.demo_reports (
  id             uuid primary key default gen_random_uuid(),
  demo_id        uuid not null references public.demos (id) on delete cascade,
  reason         text not null check (char_length(btrim(reason)) between 1 and 1000),
  contact_email  text check (contact_email is null or (char_length(contact_email) <= 320 and contact_email like '%_@_%')),
  status         text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at     timestamptz not null default now()
);
create index demo_reports_demo_idx on public.demo_reports (demo_id);
create index demo_reports_status_idx on public.demo_reports (status, created_at);

-- RLS on with no policy: signed-in users and anon can do nothing. The grants below are the service role's.
alter table public.demo_reports enable row level security;
revoke all on public.demo_reports from anon, authenticated, service_role;
grant select, insert on public.demo_reports to service_role;
grant update (status) on public.demo_reports to service_role;

-- ---------------------------------------------------------------------------
-- The publish rules: one trigger, every writer
-- ---------------------------------------------------------------------------

create function public.enforce_demo_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_name text;
begin
  -- A blocked demo stays blocked until the platform unblocks it (set_demo_blocked).
  if old.status = 'blocked' and new.status <> 'blocked' and coalesce(current_setting('pe.unblock', true), '') <> 'on' then
    raise exception 'publish_blocked:blocked';
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    if not new.authenticity_attested then
      raise exception 'publish_blocked:not_attested';
    end if;
    if not new.redaction_acknowledged then
      raise exception 'publish_blocked:not_redacted';
    end if;
    if exists (select 1 from public.demo_assets a where a.demo_id = new.id and a.flagged) then
      raise exception 'publish_blocked:flagged_assets';
    end if;
    if new.slug is null or new.slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' or new.slug ~ '--' or public.is_reserved_slug(new.slug) then
      raise exception 'publish_blocked:bad_slug';
    end if;
    if jsonb_typeof(new.content -> 'scenes') <> 'array' or jsonb_array_length(new.content -> 'scenes') = 0 then
      raise exception 'publish_blocked:empty';
    end if;

    select w.plan into plan_name from public.workspaces w where w.id = new.workspace_id;
    if (select count(*) from public.demos d where d.workspace_id = new.workspace_id and d.status = 'published' and d.id <> new.id) >= public.plan_demo_limit(plan_name) then
      raise exception 'publish_blocked:plan_limit';
    end if;

    -- Snapshot exactly what goes live.
    new.current_version := old.current_version + 1;
    new.published_at := now();
    insert into public.demo_versions (demo_id, workspace_id, version, content, created_by)
    values (new.id, new.workspace_id, new.current_version, new.content, (select auth.uid()));
  end if;
  return new;
end
$$;
revoke all on function public.enforce_demo_rules() from public, anon, authenticated;
create trigger demos_enforce_rules before update on public.demos
  for each row execute function public.enforce_demo_rules();

-- ---------------------------------------------------------------------------
-- publish_demo / unpublish_demo (admin+), resolve_demo_asset (editor+), set_demo_blocked (server only)
-- ---------------------------------------------------------------------------

create function public.publish_demo(demo uuid, new_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.demos;
  chosen text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into d from public.demos where id = demo for update;
  if d.id is null or not public.is_member(d.workspace_id, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if d.status not in ('draft', 'review', 'unpublished') then
    raise exception 'publish_blocked:invalid_state';
  end if;
  chosen := lower(btrim(coalesce(new_slug, d.slug)));
  -- The trigger checks everything; this only sets the values it will check.
  update public.demos set slug = chosen, status = 'published' where id = demo;
  perform public.audit(d.workspace_id, 'demo.publish', demo::text);
  return chosen;
end
$$;
revoke all on function public.publish_demo(uuid, text) from public, anon;
grant execute on function public.publish_demo(uuid, text) to authenticated;

create function public.unpublish_demo(demo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.demos;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into d from public.demos where id = demo for update;
  if d.id is null or not public.is_member(d.workspace_id, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if d.status <> 'published' then
    raise exception 'The demo is not published' using errcode = '22023';
  end if;
  update public.demos set status = 'unpublished', published_at = null where id = demo;
  perform public.audit(d.workspace_id, 'demo.unpublish', demo::text);
end
$$;
revoke all on function public.unpublish_demo(uuid) from public, anon;
grant execute on function public.unpublish_demo(uuid) to authenticated;

-- An unresolved flag (sensitive-looking content) blocks publishing until the owner blurs it or says it is fine.
create function public.resolve_demo_asset(asset uuid, how text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.demo_assets;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into a from public.demo_assets where id = asset for update;
  if a.id is null or not public.is_member(a.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if how is null or how not in ('blurred', 'acknowledged') then
    raise exception 'Invalid resolution' using errcode = '22023';
  end if;
  update public.demo_assets set flagged = false, resolution = how, resolved_at = now(), resolved_by = (select auth.uid()) where id = asset;
  perform public.audit(a.workspace_id, 'demo.asset_resolve', a.demo_id::text);
end
$$;
revoke all on function public.resolve_demo_asset(uuid, text) from public, anon;
grant execute on function public.resolve_demo_asset(uuid, text) to authenticated;

-- Platform operators only (the admin screen checks PLATFORM_ADMIN_EMAILS, then calls this with the service role).
create function public.set_demo_blocked(demo uuid, blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.demos;
begin
  select * into d from public.demos where id = demo for update;
  if d.id is null then
    raise exception 'Demo not found' using errcode = 'P0002';
  end if;
  if blocked then
    update public.demos set status = 'blocked', published_at = null where id = demo;
  else
    perform set_config('pe.unblock', 'on', true);
    update public.demos set status = 'unpublished' where id = demo and status = 'blocked';
    perform set_config('pe.unblock', 'off', true);
  end if;
  perform public.audit(d.workspace_id, case when blocked then 'demo.block' else 'demo.unblock' end, demo::text);
end
$$;
revoke all on function public.set_demo_blocked(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_demo_blocked(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- public_demos: the one anonymous read surface for demos
-- ---------------------------------------------------------------------------
-- A security-barrier view owned by the migration role: only published demos, only public-safe columns (no workspace id,
-- no creator, no attestations). Blocked demos are not published, so they vanish from here the moment they are blocked.

create view public.public_demos
with (security_barrier = true)
as
select
  d.id                                  as id,
  w.subdomain_slug                      as workspace_slug,
  (w.plan = 'free')                     as show_badge,
  d.slug                                as slug,
  d.title                               as title,
  d.theme                               as theme,
  d.settings                            as settings,
  d.content                             as content,
  d.published_at                        as published_at,
  case when coalesce((d.settings ->> 'allow_embed')::boolean, false)
       then coalesce((select array_agg(o.origin order by o.origin) from public.demo_embed_origins o where o.demo_id = d.id), '{}'::text[])
       else '{}'::text[] end            as embed_origins
from public.demos d
join public.workspaces w on w.id = d.workspace_id
where d.status = 'published'
  and d.slug is not null
  and w.subdomain_slug is not null;

comment on view public.public_demos is
  'The anonymous read surface for demos: published demos with public-safe columns. Add columns here deliberately; never expose workspace ids, creators, attestations, assets or leads.';
revoke all on public.public_demos from public, anon, authenticated;
grant select on public.public_demos to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private storage bucket for screenshots: no client access at all
-- ---------------------------------------------------------------------------
-- Not public. A RESTRICTIVE policy denies anon and signed-in users every access to this bucket, even if a permissive
-- policy is added later. Only the server (service role) reads and writes it; /api/demo-asset streams files after its
-- own checks. Skipped where the storage schema is not installed.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('demo-assets', 'demo-assets', false, 5242880, array['image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    begin
      execute $p$
        create policy demo_assets_bucket_deny_clients on storage.objects
          as restrictive for all to anon, authenticated
          using (bucket_id <> 'demo-assets') with check (bucket_id <> 'demo-assets')
      $p$;
      execute $c$
        comment on policy demo_assets_bucket_deny_clients on storage.objects is
          'Denies every client (anon and signed-in) any access to the demo-assets bucket. Only the service role can read or write it.'
      $c$;
    exception when insufficient_privilege then
      raise notice 'could not create the storage policy (needs the storage admin); the bucket is still private with no permissive policy';
    end;
  end if;
end
$$;
