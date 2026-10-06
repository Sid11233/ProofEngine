-- Social post drafts. The app never posts anywhere and holds no social account tokens:
-- it writes drafts from a published case study's verified claims, and the owner copies one
-- into the network's own app.
--
--   * approvals.social_consent: the client ticks a separate, unticked-by-default box when approving.
--   * social_profiles: optional links to the workspace's own profiles (admin+).
--   * social_posts: drafts. Rows are created only by create_social_drafts(), which refuses unless the
--     case study is published and its approval for the current version carries social_consent.
--
-- Rollback (dev only): drop table public.social_posts; drop table public.social_profiles;
--   drop function public.create_social_drafts(uuid, jsonb); alter table public.approvals drop column social_consent;
--   and recreate approve_case_study(text, text) from 20261009000001_approval_and_publish.sql.

alter table public.approvals add column social_consent boolean not null default false;

-- ---------------------------------------------------------------------------
-- approve_case_study: records the client's social consent with the approval
-- ---------------------------------------------------------------------------

drop function public.approve_case_study(text, text);

create function public.approve_case_study(token_hash text, ip_hash text, social boolean default false)
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

  insert into public.approvals (case_study_id, workspace_id, version, approver_email, method, ip_hash, social_consent)
  values (cs.id, cs.workspace_id, tok.version, approver, 'email_link', ip_hash, coalesce(social, false));

  update public.claims set client_confirmed = true where case_study_id = cs.id;
  update public.case_study_approval_tokens set used_at = now() where id = tok.id;
  update public.case_studies set status = 'approved' where id = cs.id;
  perform public.audit(cs.workspace_id, 'approval.approve', cs.id::text);
end
$$;

revoke all on function public.approve_case_study(text, text, boolean) from public, anon, authenticated;
grant execute on function public.approve_case_study(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- social_profiles
-- ---------------------------------------------------------------------------

create table public.social_profiles (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  network       text not null check (network in ('linkedin', 'x', 'facebook', 'instagram', 'tiktok')),
  url           text not null check (
    char_length(url) <= 300
    and url ~* '^https://([a-z0-9-]+\.)*(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com)/[^\s]*$'
  ),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, network)
);

alter table public.social_profiles enable row level security;

create policy social_profiles_select_member on public.social_profiles
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy social_profiles_select_member on public.social_profiles is
  'Members read their own workspace''s optional profile links, and no other workspace''s.';

create policy social_profiles_insert_admin on public.social_profiles
  for insert to authenticated
  with check (public.is_member(workspace_id, 'admin'));
comment on policy social_profiles_insert_admin on public.social_profiles is
  'Admins and above add a profile link to their own workspace. The URL host is checked by a table constraint.';

create policy social_profiles_update_admin on public.social_profiles
  for update to authenticated
  using (public.is_member(workspace_id, 'admin'))
  with check (public.is_member(workspace_id, 'admin'));
comment on policy social_profiles_update_admin on public.social_profiles is
  'Admins and above change the link (the only updatable column) in their own workspace.';

create policy social_profiles_delete_admin on public.social_profiles
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy social_profiles_delete_admin on public.social_profiles is
  'Admins and above remove a profile link from their own workspace.';

revoke all on public.social_profiles from anon, authenticated;
grant select on public.social_profiles to authenticated;
grant insert (workspace_id, network, url) on public.social_profiles to authenticated;
grant update (url) on public.social_profiles to authenticated;
grant delete on public.social_profiles to authenticated;

create function public.touch_social_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.touch_social_row() from public, anon, authenticated;

create trigger social_profiles_touch before update on public.social_profiles
  for each row execute function public.touch_social_row();

-- ---------------------------------------------------------------------------
-- social_posts
-- ---------------------------------------------------------------------------

create table public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  case_study_id  uuid not null,
  network        text not null check (network in ('linkedin', 'x', 'facebook', 'instagram', 'tiktok')),
  variant        int not null check (variant between 1 and 50),
  body           text not null check (char_length(body) between 1 and 3000),
  status         text not null default 'draft' check (status in ('draft', 'saved', 'posted')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (case_study_id, network, variant),
  foreign key (case_study_id, workspace_id)
    references public.case_studies (id, workspace_id) on delete cascade
);

create index social_posts_workspace_idx on public.social_posts (workspace_id);

alter table public.social_posts enable row level security;

create policy social_posts_select_editor on public.social_posts
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy social_posts_select_editor on public.social_posts is
  'Editors and above read their own workspace''s drafts, and no other workspace''s.';

create policy social_posts_update_editor on public.social_posts
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy social_posts_update_editor on public.social_posts is
  'Editors and above mark a draft saved or posted (status is the only updatable column).';

create policy social_posts_delete_editor on public.social_posts
  for delete to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy social_posts_delete_editor on public.social_posts is
  'Editors and above discard a draft in their own workspace.';

-- No INSERT policy or grant: drafts are created only by create_social_drafts().
revoke all on public.social_posts from anon, authenticated;
grant select on public.social_posts to authenticated;
grant update (status) on public.social_posts to authenticated;
grant delete on public.social_posts to authenticated;

create trigger social_posts_touch before update on public.social_posts
  for each row execute function public.touch_social_row();

-- ---------------------------------------------------------------------------
-- create_social_drafts
-- ---------------------------------------------------------------------------

create function public.create_social_drafts(study uuid, drafts jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  cs public.case_studies;
  item jsonb;
  net text;
  txt text;
  made int := 0;
  existing int;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  select * into cs from public.case_studies where id = study;
  if cs.id is null or not public.is_member(cs.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  -- Only a published case study, and only when the client agreed to social posts for this version.
  if cs.status <> 'published' then
    raise exception 'The case study is not published' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.approvals a
    where a.case_study_id = cs.id and a.version = cs.current_version and a.social_consent
  ) then
    raise exception 'The client has not agreed to social posts' using errcode = '22023';
  end if;
  if drafts is null or jsonb_typeof(drafts) <> 'array' or jsonb_array_length(drafts) not between 1 and 20 then
    raise exception 'Invalid drafts' using errcode = '22023';
  end if;

  -- New drafts replace old unsaved ones; saved and posted versions are kept.
  delete from public.social_posts where case_study_id = cs.id and status = 'draft';
  select count(*) into existing from public.social_posts where case_study_id = cs.id;
  if existing + jsonb_array_length(drafts) > 50 then
    raise exception 'Too many drafts' using errcode = '53400';
  end if;

  for item in select * from jsonb_array_elements(drafts) loop
    net := item ->> 'network';
    txt := item ->> 'body';
    if net is null or txt is null or char_length(btrim(txt)) not between 1 and 3000 then
      raise exception 'Invalid draft' using errcode = '22023';
    end if;
    insert into public.social_posts (workspace_id, case_study_id, network, variant, body)
    values (
      cs.workspace_id, cs.id, net,
      (select coalesce(max(p.variant), 0) + 1 from public.social_posts p where p.case_study_id = cs.id and p.network = net),
      btrim(txt)
    );
    made := made + 1;
  end loop;

  perform public.audit(cs.workspace_id, 'social.drafts', cs.id::text);
  return made;
end
$$;

revoke all on function public.create_social_drafts(uuid, jsonb) from public, anon;
grant execute on function public.create_social_drafts(uuid, jsonb) to authenticated;
