-- Phase 1.3: output, billing and safety tables.
--
-- Same conventions as the previous two migrations. Extra rules in this one:
--   * Append-only tables (case_study_versions, approvals, audit_log) have no
--     update/delete policy, no update/delete/truncate privilege for any API role
--     (service_role included), and a trigger that rejects update/delete even for the
--     table owner. The only delete allowed is the ON DELETE CASCADE that fires when
--     a whole workspace is hard-deleted (privacy, Phase 11).
--   * Case study state is controlled by RLS: editors can only move a case study
--     between draft / awaiting_client_approval / unpublished. 'approved' is set only
--     by the server (service role) after the client approves. 'published' is NOT
--     writable by clients yet: Phase 6.2 adds it together with the publish trigger
--     that enforces approval, template and slug rules.
--
-- Rollback (dev only):
--   drop table if exists public.page_events, public.audit_log, public.usage_counters,
--     public.subscriptions, public.takedown_requests, public.approvals, public.claims,
--     public.case_study_versions, public.case_studies, public.template_entitlements,
--     public.templates;
--   drop function if exists public.reject_mutation(), public.check_claim_quote(),
--     public.write_audit_log(uuid, text, text);

-- ---------------------------------------------------------------------------
-- Shared trigger: append-only enforcement
-- ---------------------------------------------------------------------------

create function public.reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Allow the cascade that runs after a whole workspace has been deleted.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;

-- ---------------------------------------------------------------------------
-- templates (global catalogue, managed by migrations)
-- ---------------------------------------------------------------------------

create table public.templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 100),
  category       text check (char_length(category) <= 100),
  tier           text not null check (tier in ('free', 'pro', 'pack')),
  sections       jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(sections) = 'array' and octet_length(sections::text) <= 20000),
  default_theme  jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(default_theme) = 'object' and octet_length(default_theme::text) <= 10000),
  active         boolean not null default true
);

alter table public.templates enable row level security;

create policy templates_select_authenticated on public.templates
  for select to authenticated
  using (true);
comment on policy templates_select_authenticated on public.templates is
  'Any signed-in user can browse the template catalogue. Nobody can write through the API: templates are managed by migrations or the service role.';

revoke all on public.templates from anon, authenticated;
grant select on public.templates to authenticated;

-- ---------------------------------------------------------------------------
-- template_entitlements
-- ---------------------------------------------------------------------------

create table public.template_entitlements (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  template_id   uuid not null references public.templates (id) on delete cascade,
  source        text not null check (source in ('plan', 'purchase')),
  granted_at    timestamptz not null default now(),
  primary key (workspace_id, template_id)
);

alter table public.template_entitlements enable row level security;

create policy template_entitlements_select_member on public.template_entitlements
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy template_entitlements_select_member on public.template_entitlements is
  'Members can see which templates their workspace owns. No client writes: entitlements come from the plan or a verified Stripe webhook.';

revoke all on public.template_entitlements from anon, authenticated;
grant select on public.template_entitlements to authenticated;

-- ---------------------------------------------------------------------------
-- case_studies
-- ---------------------------------------------------------------------------

create table public.case_studies (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  interview_id     uuid,
  template_id      uuid references public.templates (id),
  theme_settings   jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(theme_settings) = 'object' and octet_length(theme_settings::text) <= 10000),
  content          jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 200000),
  status           text not null default 'draft'
                     check (status in ('draft', 'awaiting_client_approval', 'approved', 'published', 'unpublished')),
  slug             text check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  current_version  int not null default 1 check (current_version >= 1),
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id),
  -- Deleting an interview keeps the case study row but detaches it.
  foreign key (interview_id, workspace_id)
    references public.interviews (id, workspace_id) on delete set null (interview_id)
);

create index case_studies_workspace_id_idx on public.case_studies (workspace_id);
create index case_studies_workspace_status_idx on public.case_studies (workspace_id, status);

alter table public.case_studies enable row level security;

create policy case_studies_select_member on public.case_studies
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy case_studies_select_member on public.case_studies is
  'Members can read their workspace''s case studies.';

create policy case_studies_insert_editor on public.case_studies
  for insert to authenticated
  with check (
    public.is_member(workspace_id, 'editor')
    and status = 'draft'
  );
comment on policy case_studies_insert_editor on public.case_studies is
  'Editor+ can create case studies, always starting as draft.';

-- Editors work on anything that is not live; they cannot set approved/published.
create policy case_studies_update_editor on public.case_studies
  for update to authenticated
  using (
    public.is_member(workspace_id, 'editor')
    and status in ('draft', 'awaiting_client_approval', 'approved', 'unpublished')
  )
  with check (
    public.is_member(workspace_id, 'editor')
    and status in ('draft', 'awaiting_client_approval', 'unpublished')
  );
comment on policy case_studies_update_editor on public.case_studies is
  'Editor+ can edit case studies that are not published, and can only move them to draft, awaiting_client_approval or unpublished. Approved is set by the server after client approval.';

-- Admins can also touch live pages. Moving a page to published is added in
-- Phase 6.2 together with the database trigger that enforces the publish rules.
create policy case_studies_update_admin on public.case_studies
  for update to authenticated
  using (public.is_member(workspace_id, 'admin'))
  with check (
    public.is_member(workspace_id, 'admin')
    and status in ('draft', 'awaiting_client_approval', 'unpublished')
  );
comment on policy case_studies_update_admin on public.case_studies is
  'Admin+ can edit or take down a live case study (back to draft or unpublished). Publishing is not possible from the client until the Phase 6.2 trigger exists.';

create policy case_studies_delete_admin on public.case_studies
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy case_studies_delete_admin on public.case_studies is
  'Admin+ can delete case studies.';

revoke all on public.case_studies from anon, authenticated;
grant select on public.case_studies to authenticated;
grant insert (workspace_id, interview_id, template_id, theme_settings, content, slug, status)
  on public.case_studies to authenticated;
grant update (template_id, theme_settings, content, status, slug, current_version)
  on public.case_studies to authenticated;
grant delete on public.case_studies to authenticated;

-- ---------------------------------------------------------------------------
-- case_study_versions (append-only)
-- ---------------------------------------------------------------------------

create table public.case_study_versions (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  version        int not null check (version >= 1),
  content        jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 200000),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (case_study_id, version),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index case_study_versions_workspace_id_idx on public.case_study_versions (workspace_id);

alter table public.case_study_versions enable row level security;

create policy case_study_versions_select_member on public.case_study_versions
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy case_study_versions_select_member on public.case_study_versions is
  'Members can read version history.';

create policy case_study_versions_insert_editor on public.case_study_versions
  for insert to authenticated
  with check (
    public.is_member(workspace_id, 'editor')
    and created_by = (select auth.uid())
  );
comment on policy case_study_versions_insert_editor on public.case_study_versions is
  'Editor+ can append a version, attributed to themselves. There is deliberately no update or delete policy.';

revoke all on public.case_study_versions from anon, authenticated, service_role;
grant select, insert on public.case_study_versions to authenticated, service_role;

create trigger case_study_versions_append_only
  before update or delete on public.case_study_versions
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- claims
-- ---------------------------------------------------------------------------

create table public.claims (
  id                 uuid primary key default gen_random_uuid(),
  case_study_id      uuid not null,
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  text               text not null check (char_length(text) <= 1000),
  source_message_id  uuid not null,
  source_quote       text not null check (char_length(source_quote) between 1 and 1000),
  client_confirmed   boolean not null default false,
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade,
  foreign key (source_message_id, workspace_id)
    references public.interview_messages (id, workspace_id) on delete cascade
);

create index claims_workspace_id_idx on public.claims (workspace_id);
create index claims_case_study_idx on public.claims (case_study_id);

-- The core promise of the product, enforced by the database: a claim's quote must
-- appear verbatim in a message the CLIENT wrote. The generator also checks this in
-- code; this makes it impossible to bypass.
create function public.check_claim_quote()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.interview_messages m
    where m.id = new.source_message_id
      and m.workspace_id = new.workspace_id
      and m.role = 'client'
      and position(new.source_quote in m.content) > 0
  ) then
    raise exception 'claim quote must appear verbatim in the referenced client message'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger claims_check_quote
  before insert or update of source_quote, source_message_id on public.claims
  for each row execute function public.check_claim_quote();

alter table public.claims enable row level security;

create policy claims_select_member on public.claims
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy claims_select_member on public.claims is
  'Members can read claims (shown as sources on the review screen).';

create policy claims_insert_editor on public.claims
  for insert to authenticated
  with check (
    public.is_member(workspace_id, 'editor')
    and client_confirmed = false
  );
comment on policy claims_insert_editor on public.claims is
  'Editor+ (the generator, running as the user) can add claims, always unconfirmed. Only the server can set client_confirmed, after the client approves. No client update policy.';

revoke all on public.claims from anon, authenticated;
grant select on public.claims to authenticated;
grant insert (case_study_id, workspace_id, text, source_message_id, source_quote, client_confirmed)
  on public.claims to authenticated;

-- ---------------------------------------------------------------------------
-- approvals (append-only, server-written)
-- ---------------------------------------------------------------------------

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  case_study_id   uuid not null,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  version         int not null,
  approver_email  text not null check (char_length(approver_email) <= 320),
  method          text not null check (char_length(method) <= 50),
  approved_at     timestamptz not null default now(),
  ip_hash         text check (ip_hash ~ '^[0-9a-f]{64}$'),
  unique (case_study_id, version),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade,
  -- An approval must point at a version that really exists.
  foreign key (case_study_id, version)
    references public.case_study_versions (case_study_id, version)
);

create index approvals_workspace_id_idx on public.approvals (workspace_id);

alter table public.approvals enable row level security;

create policy approvals_select_member on public.approvals
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy approvals_select_member on public.approvals is
  'Members can see approvals for their workspace. Rows are inserted only by the server (service role) in the approval endpoint, and can never be changed.';

revoke all on public.approvals from anon, authenticated, service_role;
grant select on public.approvals to authenticated;
grant select, insert on public.approvals to service_role;

create trigger approvals_append_only
  before update or delete on public.approvals
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- takedown_requests
-- ---------------------------------------------------------------------------

create table public.takedown_requests (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  reason         text not null check (char_length(reason) between 1 and 2000),
  contact_email  text not null check (char_length(contact_email) <= 320 and contact_email ~ '^[^@\s]+@[^@\s]+$'),
  status         text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at     timestamptz not null default now(),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index takedown_requests_workspace_id_idx on public.takedown_requests (workspace_id);
create index takedown_requests_case_study_idx on public.takedown_requests (case_study_id);

alter table public.takedown_requests enable row level security;

create policy takedown_requests_select_admin on public.takedown_requests
  for select to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy takedown_requests_select_admin on public.takedown_requests is
  'Admin+ can read takedown requests for their workspace. Inserts come only from the rate-limited public endpoint (service role); the platform admin handles status changes with the service role.';

revoke all on public.takedown_requests from anon, authenticated;
grant select on public.takedown_requests to authenticated;

-- ---------------------------------------------------------------------------
-- subscriptions (written only by the Stripe webhook)
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  workspace_id            uuid primary key references public.workspaces (id) on delete cascade,
  stripe_customer_id      text unique check (char_length(stripe_customer_id) <= 100),
  stripe_subscription_id  text unique check (char_length(stripe_subscription_id) <= 100),
  plan                    text not null default 'free' check (plan in ('free', 'pro', 'team')),
  status                  text check (char_length(status) <= 50),
  current_period_end      timestamptz
);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_member on public.subscriptions
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy subscriptions_select_member on public.subscriptions is
  'Members can see their workspace''s subscription. No client writes: only the verified Stripe webhook (service role) changes billing state.';

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- usage_counters (incremented only by the server)
-- ---------------------------------------------------------------------------

create table public.usage_counters (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  period         date not null,
  ai_messages    int not null default 0 check (ai_messages >= 0),
  interviews     int not null default 0 check (interviews >= 0),
  storage_bytes  bigint not null default 0 check (storage_bytes >= 0),
  primary key (workspace_id, period)
);

alter table public.usage_counters enable row level security;

create policy usage_counters_select_member on public.usage_counters
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy usage_counters_select_member on public.usage_counters is
  'Members can read usage for the dashboard. Counters are written only by the server, so users cannot reset their own limits.';

revoke all on public.usage_counters from anon, authenticated;
grant select on public.usage_counters to authenticated;

-- ---------------------------------------------------------------------------
-- audit_log (append-only)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  -- Not a foreign key on purpose: the record outlives a deleted user.
  actor         uuid,
  action        text not null check (action ~ '^[a-z][a-z0-9_.]{0,99}$'),
  target        text check (char_length(target) <= 200),
  created_at    timestamptz not null default now()
);

create index audit_log_workspace_created_idx on public.audit_log (workspace_id, created_at desc);

alter table public.audit_log enable row level security;

create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy audit_log_select_admin on public.audit_log is
  'Admin+ can read the audit log. No insert/update/delete policy: entries are written through write_audit_log() or by the service role, and never changed.';

revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.reject_mutation();

-- The only client-reachable way to write an audit entry. The actor is always the
-- caller (never a parameter), and the caller must be an editor or above, so a
-- viewer cannot pollute the log.
create function public.write_audit_log(ws uuid, action text, target text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  insert into public.audit_log (workspace_id, actor, action, target)
  values (ws, (select auth.uid()), action, target);
end
$$;

revoke all on function public.write_audit_log(uuid, text, text) from public, anon;
grant execute on function public.write_audit_log(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- page_events (privacy-light analytics; inserted only by the server)
-- ---------------------------------------------------------------------------

create table public.page_events (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  type           text not null check (type in ('view', 'cta_click', 'referral_click')),
  -- Hostname only. No IP, no user agent, no visitor id is ever stored.
  referrer       text check (char_length(referrer) <= 253),
  created_at     timestamptz not null default now(),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index page_events_workspace_id_idx on public.page_events (workspace_id);
create index page_events_case_study_created_idx on public.page_events (case_study_id, created_at);

alter table public.page_events enable row level security;

create policy page_events_select_member on public.page_events
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy page_events_select_member on public.page_events is
  'Members can read their workspace''s page analytics (dashboard). Inserts come only from the rate-limited server endpoint.';

revoke all on public.page_events from anon, authenticated;
grant select on public.page_events to authenticated;
