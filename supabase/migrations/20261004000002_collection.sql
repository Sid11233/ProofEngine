-- Phase 1.2: collection layer (proof requests, interviews, transcripts, uploads,
-- referrals, question flows).
--
-- Conventions (same as 20261004000001_identity.sql):
--   * RLS enabled in the same migration, explicit policies, a comment per policy.
--   * anon has no privileges. authenticated gets column-scoped grants.
--   * Every child table carries workspace_id and a COMPOSITE foreign key
--     (parent_id, workspace_id) so the denormalised workspace_id can never
--     disagree with its parent, even if a service-role code path has a bug.
--   * Transcript, upload and referral rows are written only by the server (service
--     role, in the token-authenticated interview endpoints). Clients get select only.
--
-- Rollback (dev only):
--   drop view if exists public.proof_requests_safe;
--   drop table if exists public.question_flows, public.referrals, public.interview_uploads,
--     public.interview_messages, public.interviews, public.proof_requests;

-- ---------------------------------------------------------------------------
-- proof_requests
-- ---------------------------------------------------------------------------

create table public.proof_requests (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  created_by      uuid references auth.users (id) on delete set null,
  client_name     text not null check (char_length(btrim(client_name)) between 1 and 200),
  client_email    text not null check (char_length(client_email) <= 320 and client_email ~ '^[^@\s]+@[^@\s]+$'),
  project_type    text check (char_length(project_type) <= 200),
  flow_type       text not null check (flow_type in ('agency', 'saas', 'custom')),
  focus_outcomes  text[] not null default '{}'
                    check (cardinality(focus_outcomes) <= 3),
  tone            text check (char_length(tone) <= 100),
  -- SHA-256 of the raw 32-byte token, hex encoded. The raw token is never stored.
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  status          text not null default 'draft'
                    check (status in ('draft', 'sent', 'started', 'completed', 'expired', 'revoked')),
  created_at      timestamptz not null default now(),
  -- Link lifetime is capped in the database, not just by app code.
  check (expires_at <= created_at + interval '90 days'),
  -- Target for composite foreign keys from child tables.
  unique (id, workspace_id)
);

create index proof_requests_workspace_id_idx on public.proof_requests (workspace_id);
create index proof_requests_workspace_status_idx on public.proof_requests (workspace_id, status);

alter table public.proof_requests enable row level security;

create policy proof_requests_select_member on public.proof_requests
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy proof_requests_select_member on public.proof_requests is
  'Any member can read their workspace''s proof requests (token_hash column is not granted).';

create policy proof_requests_insert_editor on public.proof_requests
  for insert to authenticated
  with check (
    public.is_member(workspace_id, 'editor')
    and created_by = (select auth.uid())
    and status = 'draft'
  );
comment on policy proof_requests_insert_editor on public.proof_requests is
  'Editor+ can create requests in their workspace, as themselves, starting in draft.';

create policy proof_requests_update_editor on public.proof_requests
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy proof_requests_update_editor on public.proof_requests is
  'Editor+ can edit, send and revoke requests. workspace_id, created_by and token_hash are not updatable (column grants).';

create policy proof_requests_delete_admin on public.proof_requests
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy proof_requests_delete_admin on public.proof_requests is
  'Admin+ can delete requests.';

-- token_hash is deliberately absent from every client grant: a client can
-- neither read nor overwrite it. Column-level select grant lists every other column.
revoke all on public.proof_requests from anon, authenticated;
grant select (
  id, workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, expires_at, revoked_at, status, created_at
) on public.proof_requests to authenticated;
grant insert (
  workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, token_hash, expires_at, status
) on public.proof_requests to authenticated;
grant update (
  client_name, client_email, project_type, focus_outcomes, tone, revoked_at, status
) on public.proof_requests to authenticated;
grant delete on public.proof_requests to authenticated;

-- The view the app queries. It has no token_hash column and runs with the
-- caller's privileges (security_invoker), so RLS on proof_requests still applies.
create view public.proof_requests_safe
with (security_invoker = true) as
select
  id, workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, expires_at, revoked_at, status, created_at
from public.proof_requests;

revoke all on public.proof_requests_safe from anon, authenticated;
grant select on public.proof_requests_safe to authenticated;

-- ---------------------------------------------------------------------------
-- interviews
-- ---------------------------------------------------------------------------

create table public.interviews (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null,
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  status               text not null default 'started'
                         check (status in ('started', 'completed', 'abandoned')),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  consent_given        boolean not null default false,
  consent_text_version text check (char_length(consent_text_version) <= 50),
  message_count        int not null default 0 check (message_count >= 0),
  unique (id, workspace_id),
  foreign key (request_id, workspace_id)
    references public.proof_requests (id, workspace_id) on delete cascade
);

create index interviews_workspace_id_idx on public.interviews (workspace_id);
create index interviews_request_id_idx on public.interviews (request_id);

alter table public.interviews enable row level security;

create policy interviews_select_member on public.interviews
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy interviews_select_member on public.interviews is
  'Members can read their workspace''s interviews. All writes happen server-side via the token-authenticated interview endpoint (service role).';

revoke all on public.interviews from anon, authenticated;
grant select on public.interviews to authenticated;

-- ---------------------------------------------------------------------------
-- interview_messages
-- ---------------------------------------------------------------------------

create table public.interview_messages (
  id            uuid primary key default gen_random_uuid(),
  interview_id  uuid not null,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  role          text not null check (role in ('client', 'bot')),
  content       text not null check (char_length(content) <= 4000),
  created_at    timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (interview_id, workspace_id)
    references public.interviews (id, workspace_id) on delete cascade
);

create index interview_messages_workspace_id_idx on public.interview_messages (workspace_id);
create index interview_messages_interview_idx on public.interview_messages (interview_id, created_at);

alter table public.interview_messages enable row level security;

create policy interview_messages_select_member on public.interview_messages
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy interview_messages_select_member on public.interview_messages is
  'Members can read transcripts in their workspace. Inserts happen only through the server (service role) in the interview endpoint.';

revoke all on public.interview_messages from anon, authenticated;
grant select on public.interview_messages to authenticated;

-- ---------------------------------------------------------------------------
-- interview_uploads
-- ---------------------------------------------------------------------------

create table public.interview_uploads (
  id            uuid primary key default gen_random_uuid(),
  interview_id  uuid not null,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  file_path     text not null check (char_length(file_path) <= 500),
  kind          text not null check (kind in ('logo', 'headshot', 'audio')),
  size_bytes    int not null check (size_bytes between 0 and 10485760),
  created_at    timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (interview_id, workspace_id)
    references public.interviews (id, workspace_id) on delete cascade
);

create index interview_uploads_workspace_id_idx on public.interview_uploads (workspace_id);
create index interview_uploads_interview_idx on public.interview_uploads (interview_id);

alter table public.interview_uploads enable row level security;

create policy interview_uploads_select_member on public.interview_uploads
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy interview_uploads_select_member on public.interview_uploads is
  'Members can read upload metadata. Files live in a private bucket; rows are inserted only by the server.';

revoke all on public.interview_uploads from anon, authenticated;
grant select on public.interview_uploads to authenticated;

-- ---------------------------------------------------------------------------
-- referrals
-- ---------------------------------------------------------------------------

create table public.referrals (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  interview_id      uuid,
  referred_name     text not null check (char_length(btrim(referred_name)) between 1 and 200),
  referred_contact  text not null check (char_length(btrim(referred_contact)) between 1 and 320),
  status            text not null default 'new'
                      check (status in ('new', 'contacted', 'won', 'dismissed')),
  created_at        timestamptz not null default now(),
  foreign key (interview_id, workspace_id)
    references public.interviews (id, workspace_id) on delete cascade
);

create index referrals_workspace_id_idx on public.referrals (workspace_id);
create index referrals_interview_idx on public.referrals (interview_id);

alter table public.referrals enable row level security;

create policy referrals_select_member on public.referrals
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy referrals_select_member on public.referrals is
  'Members can read their workspace''s referrals.';

create policy referrals_update_editor on public.referrals
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy referrals_update_editor on public.referrals is
  'Editor+ can change a referral''s status. Only the status column is updatable (column grant). Inserts happen only through the token-authenticated server path.';

revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;
grant update (status) on public.referrals to authenticated;

-- ---------------------------------------------------------------------------
-- question_flows
-- ---------------------------------------------------------------------------

create table public.question_flows (
  id            uuid primary key default gen_random_uuid(),
  -- NULL workspace_id means a system flow, shared by everyone.
  workspace_id  uuid references public.workspaces (id) on delete cascade,
  type          text not null check (type in ('agency', 'saas', 'custom')),
  name          text not null check (char_length(name) between 1 and 200),
  questions     jsonb not null
                  check (jsonb_typeof(questions) = 'array' and octet_length(questions::text) <= 20000),
  created_at    timestamptz not null default now()
);

create index question_flows_workspace_id_idx on public.question_flows (workspace_id);

alter table public.question_flows enable row level security;

create policy question_flows_select on public.question_flows
  for select to authenticated
  using (workspace_id is null or public.is_member(workspace_id));
comment on policy question_flows_select on public.question_flows is
  'Any signed-in user can read system flows (workspace_id is null); members can also read their workspace''s own flows. No client writes: system flows are managed by migrations.';

revoke all on public.question_flows from anon, authenticated;
grant select on public.question_flows to authenticated;
