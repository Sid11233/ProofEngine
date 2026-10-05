-- Security audit fixes (see docs/security-audit.md).
--
--   H3  Case studies, versions and claims can only be created by the server-side functions that
--       enforce consent, schema validation, version numbering and verbatim claim quotes. Direct
--       INSERT is revoked from API roles. A claim's quote must now come from the interview the
--       case study was generated from, not from any message in the workspace.
--   M1  write_audit_log() accepts only a fixed list of actions, so editors cannot forge entries
--       such as member.remove or token.revoke.
--   M3  Every function pins an empty search_path (all object names are schema-qualified), and
--       helper and trigger functions are no longer executable by anon.
--
-- Rollback (dev only): re-grant insert on case_studies/case_study_versions/claims to authenticated,
-- recreate the dropped insert policies from migrations 3 and the earlier check_claim_quote body.

-- ---------------------------------------------------------------------------
-- H3: no direct inserts
-- ---------------------------------------------------------------------------

revoke insert on public.case_studies from authenticated;
revoke insert on public.case_study_versions from authenticated;
revoke insert on public.claims from authenticated;

drop policy if exists case_studies_insert_editor on public.case_studies;
drop policy if exists case_study_versions_insert_editor on public.case_study_versions;
drop policy if exists claims_insert_editor on public.claims;

-- A claim must quote the interview this case study was generated from.
create or replace function public.check_claim_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.interview_messages m
    join public.case_studies cs
      on cs.id = new.case_study_id
     and cs.workspace_id = new.workspace_id
     and cs.interview_id = m.interview_id
    where m.id = new.source_message_id
      and m.workspace_id = new.workspace_id
      and m.role = 'client'
      and position(new.source_quote in m.content) > 0
  ) then
    raise exception 'claim quote must appear verbatim in a client message of the same interview'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- M1: audit log writes through the UI are limited to known actions
-- ---------------------------------------------------------------------------

create or replace function public.write_audit_log(ws uuid, action text, target text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  -- Security-relevant entries (member changes, token revocation, publishing) are written only by
  -- the functions that perform those actions. This one is for low-risk UI events.
  if action is null or action <> all (array['case_study.template']) then
    raise exception 'Unknown audit action' using errcode = '22023';
  end if;
  insert into public.audit_log (workspace_id, actor, action, target)
  values (ws, (select auth.uid()), action, target);
end
$$;

-- ---------------------------------------------------------------------------
-- M3: empty search_path everywhere, narrower execute grants
-- ---------------------------------------------------------------------------

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%public%')
  loop
    execute format('alter function %s set search_path = ''''', f.sig);
  end loop;
end
$$;

-- Trigger functions run only as triggers (privilege is checked when the trigger is created).
revoke all on function public.check_claim_quote() from public, anon, authenticated;
revoke all on function public.guard_last_owner() from public, anon, authenticated;
revoke all on function public.reject_mutation() from public, anon, authenticated;

-- Pure helpers: no reason for anonymous callers to reach them through the REST API.
revoke all on function public.role_rank(text) from public, anon;
revoke all on function public.is_reserved_slug(text) from public, anon;
revoke all on function public.plan_interview_limit(text) from public, anon;
grant execute on function public.role_rank(text) to authenticated, service_role;
grant execute on function public.is_reserved_slug(text) to authenticated, service_role;
grant execute on function public.plan_interview_limit(text) to authenticated, service_role;
