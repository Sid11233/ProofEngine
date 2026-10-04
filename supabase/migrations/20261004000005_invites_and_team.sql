-- Phase 2.3: team invitations, role changes and member removal.
--
-- Design: every write that changes who is in a workspace goes through a
-- SECURITY DEFINER function that (1) checks the caller's role, (2) enforces the
-- owner rules, and (3) writes the audit_log entry in the same transaction, so an
-- audit entry can never be skipped. Direct insert/update/delete on
-- workspace_members is therefore revoked from the API roles. This is stricter
-- than the build plan (which allowed admin direct writes) on purpose.
--
-- Rollback (dev only):
--   drop function if exists public.create_invite(uuid, text, text, text),
--     public.accept_invite(text), public.get_invite_preview(text),
--     public.revoke_invite(uuid), public.change_member_role(uuid, uuid, text),
--     public.remove_member(uuid, uuid), public.list_team_members(uuid);
--   drop table if exists public.workspace_invites;
--   (then restore the direct grants/policies on workspace_members from migration 1)

-- ---------------------------------------------------------------------------
-- workspace_invites
-- ---------------------------------------------------------------------------

create table public.workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (char_length(email) <= 320 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  -- Owners are never invited: ownership is granted only by an existing owner.
  role          text not null check (role in ('admin', 'editor', 'viewer')),
  -- SHA-256 hex of the raw 32-byte token. The raw token is shown once and never stored.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (expires_at <= created_at + interval '7 days')
);

create index workspace_invites_workspace_id_idx on public.workspace_invites (workspace_id);
-- One pending invite per person per workspace.
create unique index workspace_invites_pending_email_idx
  on public.workspace_invites (workspace_id, email) where accepted_at is null;

alter table public.workspace_invites enable row level security;

create policy workspace_invites_select_admin on public.workspace_invites
  for select to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy workspace_invites_select_admin on public.workspace_invites is
  'Admin+ can list their workspace''s invites (token_hash is not granted). Nobody else can read them. Writes go through create_invite(), revoke_invite() and accept_invite().';

revoke all on public.workspace_invites from anon, authenticated;
grant select (id, workspace_id, email, role, expires_at, accepted_at, created_by, created_at)
  on public.workspace_invites to authenticated;

-- ---------------------------------------------------------------------------
-- Lock down direct writes on workspace_members (functions below replace them)
-- ---------------------------------------------------------------------------

drop policy members_insert_admin on public.workspace_members;
drop policy members_update_role on public.workspace_members;
drop policy members_delete on public.workspace_members;
revoke insert, update, delete on public.workspace_members from authenticated;

-- ---------------------------------------------------------------------------
-- Internal helper: audit entry attributed to the caller
-- ---------------------------------------------------------------------------

create function public.audit(ws uuid, action text, target text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (workspace_id, actor, action, target)
  values (ws, (select auth.uid()), action, target)
$$;
revoke all on function public.audit(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_invite
-- ---------------------------------------------------------------------------

create function public.create_invite(ws uuid, invite_email text, invite_role text, hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  normalized text := lower(btrim(invite_email));
  new_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if invite_role is null or invite_role not in ('admin', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  -- Only an owner can hand out admin, which can in turn add people.
  if invite_role = 'admin' and not public.is_member(ws, 'owner') then
    raise exception 'Only an owner can invite an admin' using errcode = '42501';
  end if;
  if (select count(*) from public.workspace_invites i
      where i.workspace_id = ws and i.accepted_at is null and i.expires_at > now()) >= 50 then
    raise exception 'Too many pending invitations' using errcode = '54000';
  end if;
  if exists (
    select 1 from public.workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = ws and lower(u.email) = normalized
  ) then
    raise exception 'Already a member' using errcode = '23505';
  end if;

  -- Replace an expired, unaccepted invite to the same address.
  delete from public.workspace_invites
  where workspace_id = ws and email = normalized and accepted_at is null and expires_at <= now();

  insert into public.workspace_invites (workspace_id, email, role, token_hash, created_by)
  values (ws, normalized, invite_role, hash, caller)
  returning id into new_id;

  perform public.audit(ws, 'invite.create', invite_role);
  return new_id;
end
$$;
revoke all on function public.create_invite(uuid, text, text, text) from public, anon;
grant execute on function public.create_invite(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_invite
-- ---------------------------------------------------------------------------

create function public.revoke_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws uuid;
begin
  select workspace_id into ws from public.workspace_invites where id = invite_id and accepted_at is null;
  if ws is null or not public.is_member(ws, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  delete from public.workspace_invites where id = invite_id;
  perform public.audit(ws, 'invite.revoke');
end
$$;
revoke all on function public.revoke_invite(uuid) from public, anon;
grant execute on function public.revoke_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_invite_preview / accept_invite
-- ---------------------------------------------------------------------------

-- What the invitee sees before accepting. Returns a row only when the invite is
-- valid AND addressed to the caller's verified email; everything else is
-- indistinguishable "nothing", so tokens cannot be probed.
create function public.get_invite_preview(hash text)
returns table (workspace_name text, role text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w.name, i.role
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  join auth.users u on u.id = (select auth.uid())
  where i.token_hash = hash
    and i.accepted_at is null
    and i.expires_at > now()
    and u.email_confirmed_at is not null
    and lower(u.email) = i.email
$$;
revoke all on function public.get_invite_preview(text) from public, anon;
grant execute on function public.get_invite_preview(text) to authenticated;

create function public.accept_invite(hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  invite public.workspace_invites;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Single use: the row is claimed atomically, and the verified-email check is
  -- part of the same statement so a wrong account cannot burn the invite.
  update public.workspace_invites i
  set accepted_at = now()
  from auth.users u
  where i.token_hash = hash
    and i.accepted_at is null
    and i.expires_at > now()
    and u.id = caller
    and u.email_confirmed_at is not null
    and lower(u.email) = i.email
  returning i.* into invite;

  if invite.id is null then
    raise exception 'Invitation is not valid' using errcode = 'P0002';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (invite.workspace_id, caller, invite.role)
  on conflict (workspace_id, user_id) do nothing;

  perform public.audit(invite.workspace_id, 'invite.accept', invite.role);
  return invite.workspace_id;
end
$$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- change_member_role / remove_member
-- ---------------------------------------------------------------------------

create function public.change_member_role(ws uuid, member uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  current_role_ text;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if new_role is null or new_role not in ('owner', 'admin', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  if member = caller then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  select role into current_role_ from public.workspace_members where workspace_id = ws and user_id = member;
  if current_role_ is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  -- Only an owner can create an owner or change one. Last-owner protection is the trigger's job.
  if (new_role = 'owner' or current_role_ = 'owner') and not public.is_member(ws, 'owner') then
    raise exception 'Only an owner can do that' using errcode = '42501';
  end if;

  update public.workspace_members set role = new_role where workspace_id = ws and user_id = member;
  perform public.audit(ws, 'member.role_change', current_role_ || '->' || new_role);
end
$$;
revoke all on function public.change_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;

-- Removing yourself is leaving. Admins remove non-owners; owners remove anyone.
-- The last owner can never go (guard_last_owner trigger).
create function public.remove_member(ws uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  target_role text;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select role into target_role from public.workspace_members where workspace_id = ws and user_id = member;
  if target_role is null then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if member <> caller then
    if not public.is_member(ws, 'admin') then
      raise exception 'Not permitted' using errcode = '42501';
    end if;
    if target_role = 'owner' and not public.is_member(ws, 'owner') then
      raise exception 'Only an owner can remove an owner' using errcode = '42501';
    end if;
  elsif not public.is_member(ws) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;

  delete from public.workspace_members where workspace_id = ws and user_id = member;
  perform public.audit(ws, case when member = caller then 'member.leave' else 'member.remove' end, target_role);
end
$$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- list_team_members: names and emails of teammates, for members only
-- ---------------------------------------------------------------------------

-- profiles is own-row-only under RLS, so teammates are exposed through this
-- narrow function instead of widening that policy.
create function public.list_team_members(ws uuid)
returns table (user_id uuid, email text, full_name text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id, p.email, p.full_name, m.role, m.created_at
  from public.workspace_members m
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = ws
    and public.is_member(ws)
  order by public.role_rank(m.role) desc, m.created_at
$$;
revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;
