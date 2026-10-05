-- Phase 6.1-6.2: client approval and publish rules enforced in the database.
--
-- The promise of the product: nothing goes live unless the client approved that exact version.
-- So the rules live in a trigger that every writer, including the service role and an owner
-- calling the REST API directly, passes through.
--
--   Approval  request_client_approval() (editor+) makes sure the stored version matches the
--             content, issues a hashed single-use 14 day token tied to that version and moves the
--             study to awaiting_client_approval. The client's actions (approve, request changes,
--             decline) are service-role-only functions, each tied to the token.
--   Publish   a BEFORE UPDATE trigger blocks status -> 'published' unless: an approval exists for
--             the CURRENT version and the stored version equals the content; the template is
--             allowed for the workspace; the slug is valid and not reserved; every claim the
--             content points at is confirmed by the client; the client has not declined.
--   Status    no client can write status or slug directly any more; transitions go through
--             functions that audit-log.
--
-- Rollback (dev only): drop the functions and trigger below, drop the two tables, drop column
-- client_declined_at, and re-grant update (status, slug) on case_studies to authenticated.

alter table public.case_studies add column client_declined_at timestamptz;

-- No client may write status or slug directly: every transition has a function that checks the rules.
revoke update (status, slug) on public.case_studies from authenticated;

-- ---------------------------------------------------------------------------
-- Approval tokens
-- ---------------------------------------------------------------------------

create table public.case_study_approval_tokens (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  -- The token is tied to one stored version: after an edit it no longer applies.
  version        int not null,
  -- SHA-256 hex of the raw 32-byte token. The raw token goes only into the email.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null default now() + interval '14 days',
  used_at        timestamptz,
  revoked_at     timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (expires_at <= created_at + interval '14 days'),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade,
  foreign key (case_study_id, version)
    references public.case_study_versions (case_study_id, version)
);

create index case_study_approval_tokens_workspace_idx on public.case_study_approval_tokens (workspace_id);
create index case_study_approval_tokens_study_idx on public.case_study_approval_tokens (case_study_id);

alter table public.case_study_approval_tokens enable row level security;

create policy approval_tokens_select_editor on public.case_study_approval_tokens
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy approval_tokens_select_editor on public.case_study_approval_tokens is
  'Editor+ can see whether an approval request is pending, used, revoked or expired (token_hash is not granted). Tokens are issued by request_client_approval() and consumed only by the server.';

revoke all on public.case_study_approval_tokens from anon, authenticated;
grant select (id, case_study_id, workspace_id, version, expires_at, used_at, revoked_at, created_at)
  on public.case_study_approval_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- What the client said back
-- ---------------------------------------------------------------------------

create table public.case_study_feedback (
  id             uuid primary key default gen_random_uuid(),
  case_study_id  uuid not null,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  version        int not null,
  kind           text not null check (kind in ('changes_requested', 'declined')),
  -- Plain text written by the client. Always rendered as text.
  message        text check (message is null or char_length(message) between 1 and 1000),
  ip_hash        text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index case_study_feedback_study_idx on public.case_study_feedback (case_study_id, created_at);
create index case_study_feedback_workspace_idx on public.case_study_feedback (workspace_id);

alter table public.case_study_feedback enable row level security;

create policy case_study_feedback_select_editor on public.case_study_feedback
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy case_study_feedback_select_editor on public.case_study_feedback is
  'Editor+ can read what the client asked for. Rows are written only by the token-authenticated server functions and never changed.';

revoke all on public.case_study_feedback from anon, authenticated, service_role;
grant select on public.case_study_feedback to authenticated, service_role;

create trigger case_study_feedback_append_only
  before update or delete on public.case_study_feedback
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- request_client_approval
-- ---------------------------------------------------------------------------

create function public.request_client_approval(study uuid, hash text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  stored jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null or not public.is_member(cs.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if cs.client_declined_at is not null then
    raise exception 'The client declined this case study' using errcode = '22023';
  end if;
  if cs.status not in ('draft', 'awaiting_client_approval') then
    raise exception 'Approval can only be requested for a draft' using errcode = '22023';
  end if;
  if jsonb_typeof(cs.content -> 'sections') <> 'array' or jsonb_array_length(cs.content -> 'sections') = 0 then
    raise exception 'The case study is empty' using errcode = '22023';
  end if;

  -- Bring the stored versions up to date so the client is shown exactly what will be approved.
  select v.content into stored from public.case_study_versions v
  where v.case_study_id = study and v.version = cs.current_version;
  if stored is distinct from cs.content then
    insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
    values (study, cs.workspace_id, cs.current_version + 1, cs.content, (select auth.uid()));
    update public.case_studies set current_version = cs.current_version + 1 where id = study;
    cs.current_version := cs.current_version + 1;
  end if;

  -- Only one live approval link per study.
  update public.case_study_approval_tokens set revoked_at = now()
  where case_study_id = study and used_at is null and revoked_at is null;

  insert into public.case_study_approval_tokens (case_study_id, workspace_id, version, token_hash, created_by)
  values (study, cs.workspace_id, cs.current_version, hash, (select auth.uid()));

  update public.case_studies set status = 'awaiting_client_approval' where id = study;
  perform public.audit(cs.workspace_id, 'approval.request', study::text);
  return cs.current_version;
end
$$;

-- ---------------------------------------------------------------------------
-- The client's three actions (server only; each consumes the token)
-- ---------------------------------------------------------------------------

-- Shared validation. Returns the locked token and case study, or raises P0002 (the app answers
-- every failure the same way, so a token cannot be probed).
create function public.lock_approval(hash text)
returns public.case_study_approval_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
  stored jsonb;
begin
  select * into tok from public.case_study_approval_tokens where token_hash = hash for update;
  if tok.id is null or tok.used_at is not null or tok.revoked_at is not null or tok.expires_at <= now() then
    raise exception 'Approval link is not valid' using errcode = 'P0002';
  end if;

  select * into cs from public.case_studies where id = tok.case_study_id for update;
  -- The link only works for the version it was issued for, and only while that version is awaiting approval.
  if cs.id is null or cs.status <> 'awaiting_client_approval' or cs.current_version <> tok.version or cs.client_declined_at is not null then
    raise exception 'Approval link is not valid' using errcode = 'P0002';
  end if;

  select v.content into stored from public.case_study_versions v
  where v.case_study_id = cs.id and v.version = tok.version;
  if stored is distinct from cs.content then
    raise exception 'Approval link is not valid' using errcode = 'P0002';
  end if;
  return tok;
end
$$;

create function public.approve_case_study(token_hash text, ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
  approver text;
begin
  tok := public.lock_approval(token_hash);
  select * into cs from public.case_studies where id = tok.case_study_id;

  -- The approver is the person the interview was sent to, never something typed on the approval page.
  select r.client_email into approver
  from public.interviews i
  join public.proof_requests r on r.id = i.request_id and r.workspace_id = i.workspace_id
  where i.id = cs.interview_id and i.workspace_id = cs.workspace_id;
  if approver is null then
    raise exception 'Approval link is not valid' using errcode = 'P0002';
  end if;

  insert into public.approvals (case_study_id, workspace_id, version, approver_email, method, ip_hash)
  values (cs.id, cs.workspace_id, tok.version, approver, 'email_link', ip_hash);

  -- Approving this exact version confirms what it contains.
  update public.claims set client_confirmed = true where case_study_id = cs.id;
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'approved' where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.approve', cs.id::text);
end
$$;

create function public.request_case_study_changes(token_hash text, note text, ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
begin
  if note is null or char_length(btrim(note)) not between 1 and 1000 then
    raise exception 'Invalid note' using errcode = '22023';
  end if;
  tok := public.lock_approval(token_hash);
  select * into cs from public.case_studies where id = tok.case_study_id;

  insert into public.case_study_feedback (case_study_id, workspace_id, version, kind, message, ip_hash)
  values (cs.id, cs.workspace_id, tok.version, 'changes_requested', btrim(note), ip_hash);
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'draft' where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.changes_requested', cs.id::text);
end
$$;

create function public.decline_case_study(token_hash text, ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
begin
  tok := public.lock_approval(token_hash);
  select * into cs from public.case_studies where id = tok.case_study_id;

  insert into public.case_study_feedback (case_study_id, workspace_id, version, kind, ip_hash)
  values (cs.id, cs.workspace_id, tok.version, 'declined', ip_hash);
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  -- Declined stories can never be published or sent for approval again.
  update public.case_studies set status = 'unpublished', client_declined_at = now() where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.declined', cs.id::text);
end
$$;

-- ---------------------------------------------------------------------------
-- Publish rules: one trigger, every writer
-- ---------------------------------------------------------------------------

create function public.enforce_publish_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stored jsonb;
  bad_refs int;
  workspace_slug text;
begin
  -- Content changed on a live page: it goes back to draft and must be approved again.
  if old.status = 'published' and new.status = 'published' and new.content is distinct from old.content then
    new.status := 'draft';
    new.published_at := null;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    -- (f) the client has not declined
    if new.client_declined_at is not null then
      raise exception 'publish_blocked:declined';
    end if;

    -- (a) an approval exists for the CURRENT version, and the stored version is the content
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

    -- (b) the template is allowed for this workspace (no template means the free default)
    if new.template_id is not null and not public.template_allowed(new.workspace_id, new.template_id) then
      raise exception 'publish_blocked:template_locked';
    end if;

    -- (c) a valid, unreserved slug, and a workspace address to put it under
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

    -- (d) every claim of the study is confirmed, and every number or quote on the page points at one
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

create trigger case_studies_enforce_publish_rules
  before update on public.case_studies
  for each row execute function public.enforce_publish_rules();

-- ---------------------------------------------------------------------------
-- publish / unpublish (admin and above)
-- ---------------------------------------------------------------------------

create function public.publish_case_study(study uuid, new_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  chosen text;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null or not public.is_member(cs.workspace_id, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if cs.status not in ('approved', 'unpublished') then
    raise exception 'publish_blocked:not_approved';
  end if;

  chosen := lower(btrim(coalesce(new_slug, cs.slug)));
  -- The trigger checks everything; this only sets the values it will check.
  update public.case_studies set slug = chosen, status = 'published' where id = study;
  perform public.audit(cs.workspace_id, 'case_study.publish', study::text);
  return chosen;
end
$$;

create function public.unpublish_case_study(study uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
begin
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null or not public.is_member(cs.workspace_id, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if cs.status <> 'published' then
    raise exception 'Not published' using errcode = '22023';
  end if;
  update public.case_studies set status = 'unpublished' where id = study;
  perform public.audit(cs.workspace_id, 'case_study.unpublish', study::text);
end
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke all on function public.request_client_approval(uuid, text) from public, anon;
revoke all on function public.publish_case_study(uuid, text) from public, anon;
revoke all on function public.unpublish_case_study(uuid) from public, anon;
grant execute on function public.request_client_approval(uuid, text) to authenticated;
grant execute on function public.publish_case_study(uuid, text) to authenticated;
grant execute on function public.unpublish_case_study(uuid) to authenticated;

-- Server only (token-authenticated client endpoints) and the trigger function.
revoke all on function public.lock_approval(text) from public, anon, authenticated;
revoke all on function public.approve_case_study(text, text) from public, anon, authenticated;
revoke all on function public.request_case_study_changes(text, text, text) from public, anon, authenticated;
revoke all on function public.decline_case_study(text, text) from public, anon, authenticated;
revoke all on function public.enforce_publish_rules() from public, anon, authenticated;
grant execute on function public.lock_approval(text) to service_role;
grant execute on function public.approve_case_study(text, text) to service_role;
grant execute on function public.request_case_study_changes(text, text, text) to service_role;
grant execute on function public.decline_case_study(text, text) to service_role;
