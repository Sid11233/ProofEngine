-- Phase 1.1: identity layer (profiles, workspaces, workspace_members).
--
-- Security model:
--   * RLS is enabled on every table in this file, with explicit policies.
--   * `anon` has no privileges on any of these tables.
--   * `authenticated` gets only the privileges it needs, column-scoped where a
--     column must never be client-writable (workspaces.plan, profiles.email).
--     RLS decides which rows; grants decide which columns.
--   * Privileged writes go through SECURITY DEFINER functions with a pinned
--     search_path.
--
-- Rollback (dev only):
--   drop function if exists public.create_workspace(text, text);
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_user();
--   drop table if exists public.workspace_members, public.workspaces, public.profiles;
--   drop function if exists public.is_member(uuid, text), public.role_rank(text),
--     public.is_reserved_slug(text), public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Returns NULL for an unknown role so that a typo in a min_role argument makes
-- every comparison NULL (false) instead of silently granting access.
create function public.role_rank(role text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case role
    when 'viewer' then 1
    when 'editor' then 2
    when 'admin'  then 3
    when 'owner'  then 4
  end
$$;

-- Slugs that must never be claimed as a workspace subdomain (or a case study slug).
create function public.is_reserved_slug(slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select slug = any (array[
    'www', 'app', 'api', 'admin', 'i', 'mail', 'support', 'billing', 'status', 'docs',
    'auth', 'login', 'logout', 'signup', 'dashboard', 'static', 'assets', 'cdn',
    'embed', 'pages', 'blog', 'help', 'smtp', 'ftp', 'dev', 'staging', 'test',
    'security', 'privacy', 'terms', 'root', 'null', 'undefined'
  ])
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text check (char_length(full_name) <= 200),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Only the owner of a row can read it. Teammates' names are exposed later
-- through a purpose-built function, not by widening this policy.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
comment on policy profiles_select_own on public.profiles is
  'A user can read only their own profile row.';

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
comment on policy profiles_update_own on public.profiles is
  'A user can update only their own profile row. Column grants limit this to full_name; email mirrors auth.users and is not client-writable.';

-- No insert or delete policy: rows are created by the auth.users trigger and
-- removed by the ON DELETE CASCADE from auth.users.

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Create the profile when a user signs up. Runs as the function owner so it is
-- not blocked by RLS. Metadata is user-controlled, so it is length-clamped to
-- keep a long value from failing the check constraint and blocking signup.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(new.raw_user_meta_data ->> 'full_name', 200)
  );
  return new;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill users that existed before this migration.
insert into public.profiles (id, email, full_name)
select u.id, u.email, left(u.raw_user_meta_data ->> 'full_name', 200)
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  type            text not null check (type in ('agency', 'saas')),
  niche           text check (char_length(niche) <= 100),
  audience        text check (char_length(audience) <= 200),
  website         text check (char_length(website) <= 2048 and website ~ '^https://'),
  plan            text not null default 'free' check (plan in ('free', 'pro', 'team')),
  subdomain_slug  text unique
                    check (
                      subdomain_slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
                      and not public.is_reserved_slug(subdomain_slug)
                    ),
  brand           jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(brand) = 'object' and octet_length(brand::text) <= 10000),
  created_at      timestamptz not null default now()
);

alter table public.workspaces enable row level security;

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- user_id lookups (is_member, "my workspaces") use the PK's leading column
-- for workspace_id; this index serves the reverse direction.
create index workspace_members_user_id_idx on public.workspace_members (user_id);

alter table public.workspace_members enable row level security;

-- Membership check used by every tenant policy. SECURITY DEFINER so it can read
-- workspace_members without recursing into that table's own RLS policies.
-- Fails closed: no session -> false; unknown min_role -> false.
create function public.is_member(ws uuid, min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws
      and m.user_id = (select auth.uid())
      and public.role_rank(m.role) >= public.role_rank(min_role)
  )
$$;

revoke all on function public.is_member(uuid, text) from public, anon;
grant execute on function public.is_member(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- workspaces policies
-- ---------------------------------------------------------------------------

create policy workspaces_select_member on public.workspaces
  for select to authenticated
  using (public.is_member(id));
comment on policy workspaces_select_member on public.workspaces is
  'Any member (viewer and up) can read their workspace.';

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.is_member(id, 'admin'))
  with check (public.is_member(id, 'admin'));
comment on policy workspaces_update_admin on public.workspaces is
  'Admins and owners can update workspace settings. Column grants exclude plan and id, so billing state is only writable by the service role (Stripe webhook).';

create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (public.is_member(id, 'owner'));
comment on policy workspaces_delete_owner on public.workspaces is
  'Only an owner can delete a workspace.';

-- No insert policy: workspaces are created only through create_workspace().

revoke all on public.workspaces from anon, authenticated;
grant select, delete on public.workspaces to authenticated;
grant update (name, niche, audience, website, subdomain_slug, brand)
  on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- workspace_members policies
-- ---------------------------------------------------------------------------

create policy members_select_own_workspaces on public.workspace_members
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy members_select_own_workspaces on public.workspace_members is
  'Members can see everyone in workspaces they belong to, and nothing else.';

-- Admins can add members, but only an owner can add an owner.
create policy members_insert_admin on public.workspace_members
  for insert to authenticated
  with check (
    public.is_member(workspace_id, 'admin')
    and (role <> 'owner' or public.is_member(workspace_id, 'owner'))
  );
comment on policy members_insert_admin on public.workspace_members is
  'Admin+ can add members. Only an owner can create an owner. Invitations (Phase 2.3) will replace direct inserts for adding other people.';

-- USING is checked against the existing row, WITH CHECK against the new row:
--   * an admin cannot touch an existing owner row (cannot demote an owner);
--   * an admin cannot promote anyone to owner;
--   * nobody can change their own role.
create policy members_update_role on public.workspace_members
  for update to authenticated
  using (
    public.is_member(workspace_id, 'admin')
    and user_id <> (select auth.uid())
    and (role <> 'owner' or public.is_member(workspace_id, 'owner'))
  )
  with check (
    public.is_member(workspace_id, 'admin')
    and user_id <> (select auth.uid())
    and (role <> 'owner' or public.is_member(workspace_id, 'owner'))
  );
comment on policy members_update_role on public.workspace_members is
  'Admin+ can change other members'' roles. Only an owner can grant or change the owner role. Nobody can change their own role.';

-- Anyone can leave; admins can remove non-owners; owners can remove anyone.
-- The last owner is protected by the guard_last_owner trigger below.
create policy members_delete on public.workspace_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (public.is_member(workspace_id, 'admin') and role <> 'owner')
    or public.is_member(workspace_id, 'owner')
  );
comment on policy members_delete on public.workspace_members is
  'A member can leave. Admin+ can remove non-owners. Only an owner can remove an owner. The last owner can never be removed (trigger).';

revoke all on public.workspace_members from anon, authenticated;
grant select, delete on public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role) on public.workspace_members to authenticated;
-- Only the role can change; moving a row between workspaces or users is never allowed.
grant update (role) on public.workspace_members to authenticated;

-- Backstop for "the last owner cannot be removed or demoted". It also covers
-- service-role writes. Owner rows are locked first so two owners removing each
-- other concurrently cannot both succeed. Skipped while the workspace itself is
-- being deleted (ON DELETE CASCADE).
create function public.guard_last_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return coalesce(new, old);
  end if;

  perform 1
  from public.workspace_members m
  where m.workspace_id = old.workspace_id and m.role = 'owner'
  order by m.user_id
  for update;

  if not exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = old.workspace_id
      and m.role = 'owner'
      and m.user_id <> old.user_id
  ) then
    raise exception 'A workspace must keep at least one owner'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end
$$;

create trigger workspace_members_guard_last_owner
  before update or delete on public.workspace_members
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- create_workspace
-- ---------------------------------------------------------------------------

-- The only way to create a workspace. Creates it and makes the caller its owner
-- in one transaction. Caps owned workspaces per user to limit abuse.
create function public.create_workspace(name text, type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  caller uuid := (select auth.uid());
  new_id uuid;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  name := btrim(name);
  if name is null or char_length(name) not between 1 and 100 then
    raise exception 'Workspace name must be 1 to 100 characters' using errcode = '22023';
  end if;
  if type is null or type not in ('agency', 'saas') then
    raise exception 'Workspace type must be agency or saas' using errcode = '22023';
  end if;

  if (select count(*) from public.workspace_members m
      where m.user_id = caller and m.role = 'owner') >= 5 then
    raise exception 'Workspace limit reached' using errcode = '54000';
  end if;

  insert into public.workspaces (name, type) values (name, type)
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_id, caller, 'owner');

  return new_id;
end
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
