-- Phase 11.3: privacy. Deletion with a grace period, interview deletion, client erasure, retention.
--
--   * Workspace and account deletion: an owner REQUESTS deletion (30 day grace period, cancellable). From the
--     request on, the workspace's public pages are hidden, every interview, preview and approval link is
--     revoked and nothing new can be created. After 30 days a daily job removes the files, then calls
--     hard_delete_workspace(), and the foreign keys remove every row that belongs to the workspace.
--     The direct DELETE on workspaces is gone: it would skip the grace period.
--   * Append-only tables (versions, approvals, feedback, page events, audit log) refuse deletes, EXCEPT inside
--     the purge functions below, which set the transaction-local flag pe.purge. Only these definer functions
--     set it; no client can (PostgREST exposes only public functions).
--   * delete_interview(): admin+ removes one interview (transcript, upload rows, claims, referrals) and takes the
--     case studies that depended on it offline.
--   * erase_story(): service role only, used by the client's "remove my story" link; deletes the story, the
--     interview and the request (client name and email) for good.
--   * stale_requests() / purge_requests(): retention. Requests that never completed are removed after 90 days.
--   * Storage files are removed by the application BEFORE the rows (the functions return the paths), so a
--     failure leaves rows to retry, never orphaned files.
--
-- Rollback (dev only): drop the functions and triggers below, restore reject_mutation() and the workspaces
-- DELETE grant/policy from migration 20261004000001, drop the new columns.

alter table public.workspaces add column deletion_requested_at timestamptz;
alter table public.profiles add column deletion_requested_at timestamptz;
grant select (deletion_requested_at) on public.profiles to authenticated;

-- Purge functions may delete from append-only tables; nothing else can.
create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('pe.purge', true), '') = 'on' then
    return old;
  end if;
  -- Allow the cascade that runs after a whole workspace has been deleted.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;

-- The grace period is not skippable: no direct delete of a workspace by any client.
drop policy workspaces_delete_owner on public.workspaces;
revoke delete on public.workspaces from authenticated;

-- Nothing new is created for a workspace that is being deleted.
create function public.block_new_requests_during_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.deletion_requested_at is not null) then
    raise exception 'This workspace is scheduled for deletion' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger proof_requests_block_during_deletion
  before insert on public.proof_requests
  for each row execute function public.block_new_requests_during_deletion();

-- Public pages and the widget disappear as soon as deletion is requested.
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
  and w.subdomain_slug is not null
  and w.deletion_requested_at is null;

create or replace view public.public_wall_settings
with (security_barrier = true)
as
select w.subdomain_slug as workspace_slug, s.allowed_origins, s.layout, s.max_items
from public.wall_settings s
join public.workspaces w on w.id = s.workspace_id
where s.enabled and w.subdomain_slug is not null and w.deletion_requested_at is null;

-- ---------------------------------------------------------------------------
-- Workspace and account deletion (owner, authenticated)
-- ---------------------------------------------------------------------------

create function public.request_workspace_deletion(ws uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'owner') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  -- A paid subscription is cancelled first, so nobody is billed for a workspace that is about to disappear.
  if exists (select 1 from public.subscriptions s where s.workspace_id = ws and s.status in ('active', 'trialing', 'past_due')) then
    raise exception 'subscription_active' using errcode = '22023';
  end if;

  update public.workspaces set deletion_requested_at = coalesce(deletion_requested_at, now()) where id = ws returning deletion_requested_at into requested;

  -- Stop all outside activity at once.
  update public.proof_requests
    set revoked_at = coalesce(revoked_at, now()), status = case when status in ('draft', 'sent', 'started') then 'revoked' else status end
    where workspace_id = ws;
  update public.case_study_previews set revoked_at = coalesce(revoked_at, now()) where workspace_id = ws;
  update public.case_study_approval_tokens set revoked_at = coalesce(revoked_at, now()) where workspace_id = ws and used_at is null;

  perform public.audit(ws, 'workspace.deletion_requested', ws::text);
  return requested + interval '30 days';
end
$$;

create function public.cancel_workspace_deletion(ws uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'owner') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.workspaces set deletion_requested_at = null where id = ws;
  perform public.audit(ws, 'workspace.deletion_cancelled', ws::text);
end
$$;

-- Deleting your account removes the workspaces you are the only person in, and is refused while you are the
-- only owner of a workspace that has other members (transfer ownership first).
create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  w record;
  requested timestamptz;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  for w in
    select m.workspace_id from public.workspace_members m
    where m.user_id = me and m.role = 'owner'
      and not exists (select 1 from public.workspace_members o where o.workspace_id = m.workspace_id and o.role = 'owner' and o.user_id <> me)
  loop
    if exists (select 1 from public.workspace_members o where o.workspace_id = w.workspace_id and o.user_id <> me) then
      raise exception 'transfer_ownership' using errcode = '22023';
    end if;
    perform public.request_workspace_deletion(w.workspace_id);
  end loop;
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now()) where id = me returning deletion_requested_at into requested;
  return requested + interval '30 days';
end
$$;

create function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  w record;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  update public.profiles set deletion_requested_at = null where id = me;
  for w in select m.workspace_id from public.workspace_members m join public.workspaces x on x.id = m.workspace_id
           where m.user_id = me and m.role = 'owner' and x.deletion_requested_at is not null loop
    perform public.cancel_workspace_deletion(w.workspace_id);
  end loop;
end
$$;

-- A just-created workspace can be thrown away at once (used when onboarding fails half way).
create function public.discard_new_workspace(ws uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'owner') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = ws and w.created_at > now() - interval '15 minutes')
     or exists (select 1 from public.proof_requests r where r.workspace_id = ws)
     or exists (select 1 from public.case_studies c where c.workspace_id = ws) then
    raise exception 'Only a brand new, empty workspace can be discarded' using errcode = '22023';
  end if;
  delete from public.workspaces where id = ws;
end
$$;

-- ---------------------------------------------------------------------------
-- Delete one interview (admin+)
-- ---------------------------------------------------------------------------

create function public.delete_interview(ws uuid, interview uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  perform 1 from public.interviews i where i.id = interview and i.workspace_id = ws for update;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;

  -- Case studies built on this transcript go offline: live ones are unpublished, ones waiting for approval
  -- go back to draft (their approval links stop working), approved ones are unpublished.
  update public.case_study_approval_tokens set revoked_at = coalesce(revoked_at, now())
    where used_at is null and case_study_id in (select c.id from public.case_studies c where c.interview_id = interview and c.workspace_id = ws);
  update public.case_studies
    set status = case status when 'awaiting_client_approval' then 'draft' else 'unpublished' end
    where interview_id = interview and workspace_id = ws and status in ('published', 'approved', 'awaiting_client_approval');

  -- Messages, upload rows, claims (they quote the messages) and referrals go with the interview.
  delete from public.interviews where id = interview and workspace_id = ws;
  perform public.audit(ws, 'interview.delete', interview::text);
end
$$;

-- ---------------------------------------------------------------------------
-- Service-role only: the purge job and the client's removal link
-- ---------------------------------------------------------------------------

create function public.due_workspace_deletions()
returns table (workspace_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workspaces w where w.deletion_requested_at is not null and w.deletion_requested_at <= now() - interval '30 days'
$$;

create function public.due_account_deletions()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.deletion_requested_at is not null and p.deletion_requested_at <= now() - interval '30 days'
$$;

-- Deletes the workspace and, through the foreign keys, everything in it. false = not due (or already gone).
create function public.hard_delete_workspace(ws uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('pe.purge', 'on', true);
  delete from public.workspaces where id = ws and deletion_requested_at is not null and deletion_requested_at <= now() - interval '30 days';
  return found;
end
$$;

-- Upload paths of the interviews behind one case study (to remove the files before the rows).
create function public.story_upload_paths(study uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(u.file_path), '{}')
  from public.case_studies c
  join public.interview_uploads u on u.interview_id = c.interview_id and u.workspace_id = c.workspace_id
  where c.id = study
$$;

-- The client asked for their story to be removed: the story, its interview and the request (their name and
-- email) are deleted for good. Returns false when there is nothing to erase.
create function public.erase_story(study uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.case_studies;
  req uuid;
begin
  select * into cs from public.case_studies where id = study for update;
  if cs.id is null then
    return false;
  end if;
  perform set_config('pe.purge', 'on', true);
  if cs.interview_id is not null then
    select i.request_id into req from public.interviews i where i.id = cs.interview_id;
  end if;
  delete from public.case_studies where id = study;
  if req is not null then
    delete from public.proof_requests where id = req and workspace_id = cs.workspace_id;
  end if;
  perform public.audit(cs.workspace_id, 'client.erase', study::text);
  return true;
end
$$;

-- Retention: requests that never completed and have been idle for 90 days.
create function public.stale_requests()
returns table (request_id uuid, paths text[])
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         coalesce((select array_agg(u.file_path) from public.interview_uploads u join public.interviews i on i.id = u.interview_id and i.workspace_id = u.workspace_id where i.request_id = r.id), '{}')
  from public.proof_requests r
  where r.status <> 'completed'
    and not exists (select 1 from public.interviews i where i.request_id = r.id and i.status = 'completed')
    and greatest(r.created_at, coalesce(r.last_reminder_at, r.created_at), coalesce((select max(i.started_at) from public.interviews i where i.request_id = r.id), r.created_at)) < now() - interval '90 days'
$$;

create function public.purge_requests(ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform set_config('pe.purge', 'on', true);
  -- Re-check staleness here: only what stale_requests() would list can be deleted.
  delete from public.proof_requests r
    where r.id = any (ids) and r.id in (select s.request_id from public.stale_requests() s);
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.block_new_requests_during_deletion() from public, anon, authenticated;
revoke all on function public.request_workspace_deletion(uuid) from public, anon;
revoke all on function public.cancel_workspace_deletion(uuid) from public, anon;
revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
revoke all on function public.discard_new_workspace(uuid) from public, anon;
revoke all on function public.delete_interview(uuid, uuid) from public, anon;
grant execute on function public.request_workspace_deletion(uuid) to authenticated;
grant execute on function public.cancel_workspace_deletion(uuid) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
grant execute on function public.discard_new_workspace(uuid) to authenticated;
grant execute on function public.delete_interview(uuid, uuid) to authenticated;

revoke all on function public.due_workspace_deletions() from public, anon, authenticated;
revoke all on function public.due_account_deletions() from public, anon, authenticated;
revoke all on function public.hard_delete_workspace(uuid) from public, anon, authenticated;
revoke all on function public.story_upload_paths(uuid) from public, anon, authenticated;
revoke all on function public.erase_story(uuid) from public, anon, authenticated;
revoke all on function public.stale_requests() from public, anon, authenticated;
revoke all on function public.purge_requests(uuid[]) from public, anon, authenticated;
grant execute on function public.due_workspace_deletions() to service_role;
grant execute on function public.due_account_deletions() to service_role;
grant execute on function public.hard_delete_workspace(uuid) to service_role;
grant execute on function public.story_upload_paths(uuid) to service_role;
grant execute on function public.erase_story(uuid) to service_role;
grant execute on function public.stale_requests() to service_role;
grant execute on function public.purge_requests(uuid[]) to service_role;
