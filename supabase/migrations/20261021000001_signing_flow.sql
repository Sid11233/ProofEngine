-- Combined client approval and e-signature (replaces the one-click approval at /approve).
--
-- The signing link reuses case_study_approval_tokens (32 random bytes stored hashed, bound to one version, 14 days,
-- revocable, single use). New here:
--   * signing_challenges gets token_id and session_hash: the emailed code proves who is at the link, and a successful
--     check hands the browser a session secret (only its hash is stored) good for 30 minutes.
--   * Service-role functions: issue_signing_code (3 a hour), verify_signing_code (5 attempts), check_signing_session,
--     sign_case_study, log_signing_viewed. Changes and decline are replaced to also write signature_events.
--   * Any content edit revokes the open link and puts the case study back to draft, so it must be sent again.
--   * request_client_approval also writes the 'sent' event.
--
-- approve_case_study (one-click) stays in the database for older tests and tooling but the app no longer calls it, and
-- publishing still needs a signature (20261019000001).
--
-- Rollback (dev only): drop the functions below and the trigger case_studies_revoke_signing_links; restore
-- request_client_approval, request_case_study_changes and decline_case_study from 20261009000001; drop the two columns.

alter table public.signing_challenges
  add column token_id uuid references public.case_study_approval_tokens (id) on delete cascade,
  add column session_hash text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$');

create index signing_challenges_token_idx on public.signing_challenges (token_id, created_at);

-- ---------------------------------------------------------------------------
-- Editing content invalidates the link
-- ---------------------------------------------------------------------------

create function public.revoke_signing_links_on_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    update public.case_study_approval_tokens set revoked_at = now()
    where case_study_id = new.id and used_at is null and revoked_at is null;
    if old.status = 'awaiting_client_approval' and new.status = 'awaiting_client_approval' then
      new.status := 'draft';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.revoke_signing_links_on_edit() from public, anon, authenticated;

create trigger case_studies_revoke_signing_links
  before update on public.case_studies
  for each row execute function public.revoke_signing_links_on_edit();

-- ---------------------------------------------------------------------------
-- request_client_approval: also records the 'sent' event
-- ---------------------------------------------------------------------------

create or replace function public.request_client_approval(study uuid, hash text)
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

  select v.content into stored from public.case_study_versions v
  where v.case_study_id = study and v.version = cs.current_version;
  if stored is distinct from cs.content then
    insert into public.case_study_versions (case_study_id, workspace_id, version, content, created_by)
    values (study, cs.workspace_id, cs.current_version + 1, cs.content, (select auth.uid()));
    update public.case_studies set current_version = cs.current_version + 1 where id = study;
    cs.current_version := cs.current_version + 1;
  end if;

  update public.case_study_approval_tokens set revoked_at = now()
  where case_study_id = study and used_at is null and revoked_at is null;

  insert into public.case_study_approval_tokens (case_study_id, workspace_id, version, token_hash, created_by)
  values (study, cs.workspace_id, cs.current_version, hash, (select auth.uid()));

  update public.case_studies set status = 'awaiting_client_approval' where id = study;
  insert into public.signature_events (workspace_id, case_study_id, event) values (cs.workspace_id, study, 'sent');
  perform public.audit(cs.workspace_id, 'approval.request', study::text);
  return cs.current_version;
end
$$;

-- ---------------------------------------------------------------------------
-- Identity check: the emailed code
-- ---------------------------------------------------------------------------

-- The address is always the one on file for the interview. Returns who to email; the app sends the code.
create function public.issue_signing_code(token_hash text, code_hash text, ip_hash text, ua_hash text)
returns table (client_email text, client_name text)
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

  if (select count(*) from public.signing_challenges c where c.token_id = tok.id and c.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many codes requested' using errcode = '54000';
  end if;
  -- Only the newest code works.
  update public.signing_challenges set expires_at = now() where token_id = tok.id and consumed_at is null and expires_at > now();
  insert into public.signing_challenges (case_study_id, version, token_id, code_hash, expires_at)
  values (cs.id, tok.version, tok.id, code_hash, now() + interval '10 minutes');
  insert into public.signature_events (workspace_id, case_study_id, event, ip_hash, ua_hash) values (cs.workspace_id, cs.id, 'otp_sent', ip_hash, ua_hash);

  return query
    select r.client_email::text, r.client_name::text
    from public.interviews i
    join public.proof_requests r on r.id = i.request_id and r.workspace_id = i.workspace_id
    where i.id = cs.interview_id and i.workspace_id = cs.workspace_id;
end
$$;

-- True when the code is right. At most 5 wrong tries per code, then it is dead.
create function public.verify_signing_code(token_hash text, code_hash text, session_hash text, ip_hash text, ua_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
  ch public.signing_challenges;
  ok boolean;
begin
  tok := public.lock_approval(token_hash);
  select * into cs from public.case_studies where id = tok.case_study_id;

  select * into ch from public.signing_challenges c
  where c.token_id = tok.id and c.consumed_at is null and c.expires_at > now()
  order by c.created_at desc limit 1 for update;
  if ch.id is null or ch.attempts >= 5 then
    return false;
  end if;

  ok := ch.code_hash = code_hash;
  update public.signing_challenges
    set attempts = attempts + 1,
        consumed_at = case when ok then now() else null end,
        session_hash = case when ok then verify_signing_code.session_hash else null end
    where id = ch.id;
  insert into public.signature_events (workspace_id, case_study_id, event, ip_hash, ua_hash)
  values (cs.workspace_id, cs.id, case when ok then 'otp_verified' else 'otp_failed' end, ip_hash, ua_hash);
  return ok;
end
$$;

-- True while this browser's session (from a successful code) is under 30 minutes old and the link is still valid.
create function public.check_signing_session(token_hash text, session_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
begin
  tok := public.lock_approval(token_hash);
  return exists (
    select 1 from public.signing_challenges c
    where c.token_id = tok.id and c.version = tok.version and c.session_hash = check_signing_session.session_hash
      and c.consumed_at is not null and c.consumed_at > now() - interval '30 minutes'
  );
end
$$;

create function public.log_signing_viewed(token_hash text, ip_hash text, ua_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
begin
  tok := public.lock_approval(token_hash);
  insert into public.signature_events (workspace_id, case_study_id, event, ip_hash, ua_hash)
  values (tok.workspace_id, tok.case_study_id, 'viewed', ip_hash, ua_hash);
end
$$;

-- ---------------------------------------------------------------------------
-- sign_case_study
-- ---------------------------------------------------------------------------

-- 40001 = the version changed since the page was shown; P0002 = the link or the code check is not valid.
create function public.sign_case_study(
  token_hash text, session_hash text, expected_version int,
  signer_name text, signer_company text, signer_role text, display_choice text,
  consent_social boolean, consent_media boolean, method text, signature_path text,
  content_hash text, ip_hash text, ua_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok public.case_study_approval_tokens;
  cs public.case_studies;
  ch public.signing_challenges;
  approver text;
  text_version text;
  sig uuid;
begin
  -- A link for an older version says so, instead of the generic "not valid".
  select * into tok from public.case_study_approval_tokens t where t.token_hash = sign_case_study.token_hash;
  if tok.id is not null and tok.used_at is null and tok.revoked_at is null and tok.expires_at > now() then
    select * into cs from public.case_studies where id = tok.case_study_id;
    if cs.id is not null and (cs.current_version <> tok.version or tok.version <> expected_version) then
      raise exception 'This version has changed' using errcode = '40001';
    end if;
  end if;
  tok := public.lock_approval(token_hash);
  select * into cs from public.case_studies where id = tok.case_study_id;

  -- Identity: a code verified by this browser's session within the last 30 minutes.
  select * into ch from public.signing_challenges c
  where c.token_id = tok.id and c.version = tok.version and c.session_hash = sign_case_study.session_hash
    and c.consumed_at is not null and c.consumed_at > now() - interval '30 minutes'
  order by c.consumed_at desc limit 1;
  if ch.id is null then
    raise exception 'Identity not verified' using errcode = 'P0002';
  end if;

  select r.client_email into approver
  from public.interviews i
  join public.proof_requests r on r.id = i.request_id and r.workspace_id = i.workspace_id
  where i.id = cs.interview_id and i.workspace_id = cs.workspace_id;
  if approver is null then
    raise exception 'Approval link is not valid' using errcode = 'P0002';
  end if;

  select t.version into text_version from public.consent_texts t where t.kind = 'testimonial_release' and t.effective_at <= now() order by t.effective_at desc limit 1;
  if text_version is null then
    raise exception 'No consent text' using errcode = '22023';
  end if;

  insert into public.signatures (
    workspace_id, case_study_id, version, signer_name, signer_email, signer_company, signer_role, display_name_choice,
    consent_text_version, esign_disclosure_accepted, consent_web, consent_social, consent_media, method, signature_path,
    content_hash, otp_verified_at, ip_hash, ua_hash
  ) values (
    cs.workspace_id, cs.id, tok.version, btrim(signer_name), approver, nullif(btrim(signer_company), ''), nullif(btrim(signer_role), ''), display_choice,
    text_version, true, true, coalesce(consent_social, false), coalesce(consent_media, false), method, signature_path,
    content_hash, ch.consumed_at, ip_hash, ua_hash
  ) returning id into sig;

  insert into public.signature_events (workspace_id, case_study_id, signature_id, event, ip_hash, ua_hash)
  values (cs.workspace_id, cs.id, sig, 'signed', ip_hash, ua_hash);

  -- The approval record the publish rules and social consent already use.
  insert into public.approvals (case_study_id, workspace_id, version, approver_email, method, ip_hash, social_consent)
  values (cs.id, cs.workspace_id, tok.version, approver, 'e_signature', ip_hash, coalesce(consent_social, false));
  update public.claims set client_confirmed = true where case_study_id = cs.id;
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'approved' where id = cs.id;
  perform public.audit(cs.workspace_id, 'signature.sign', cs.id::text);
  return sig;
end
$$;

-- ---------------------------------------------------------------------------
-- Changes and decline also write the signing trail
-- ---------------------------------------------------------------------------

create or replace function public.request_case_study_changes(token_hash text, note text, ip_hash text)
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
  insert into public.signature_events (workspace_id, case_study_id, event, ip_hash) values (cs.workspace_id, cs.id, 'changes_requested', ip_hash);
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'draft' where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.changes_requested', cs.id::text);
end
$$;

create or replace function public.decline_case_study(token_hash text, ip_hash text)
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
  insert into public.signature_events (workspace_id, case_study_id, event, ip_hash) values (cs.workspace_id, cs.id, 'declined', ip_hash);
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'unpublished', client_declined_at = now() where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.declined', cs.id::text);
end
$$;

-- Server only (the signing endpoints use the service role after their own token checks).
revoke all on function public.issue_signing_code(text, text, text, text) from public, anon, authenticated;
revoke all on function public.verify_signing_code(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.check_signing_session(text, text) from public, anon, authenticated;
revoke all on function public.log_signing_viewed(text, text, text) from public, anon, authenticated;
revoke all on function public.sign_case_study(text, text, int, text, text, text, text, boolean, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.issue_signing_code(text, text, text, text) to service_role;
grant execute on function public.verify_signing_code(text, text, text, text, text) to service_role;
grant execute on function public.check_signing_session(text, text) to service_role;
grant execute on function public.log_signing_viewed(text, text, text) to service_role;
grant execute on function public.sign_case_study(text, text, int, text, text, text, text, boolean, boolean, text, text, text, text, text) to service_role;
