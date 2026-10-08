-- Clients and projects: the agency's own record of who it works for and what it built.
--
--   clients           A company or person the workspace works for (contact details are personal data).
--   projects          One piece of work for a client: summary, status, website and repository links, notes.
--   project_links     Extra labelled https links for a project (design files, docs, staging site, ...).
--   project_feedback  What the client (or the team) said about the project, pasted or typed by the owner.
--
-- Nothing here is public and nothing here is sent to the AI by itself. Later features (posts, carousels, demos)
-- read these rows through the owner's own session.
--
-- Access: any member reads; editors and above create and edit; admins delete. Children reference
-- (parent_id, workspace_id) so a row can never point at another workspace's parent.
--
-- Rollback (dev only): drop table public.project_feedback; drop table public.project_links;
--   drop table public.projects; drop table public.clients; drop function public.limit_project_children();

create function public.limit_project_children()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap int := tg_argv[0]::int;
  n int;
begin
  execute format('select count(*) from public.%I where project_id = $1', tg_table_name) into n using new.project_id;
  if n >= cap then
    raise exception 'Too many rows for this project' using errcode = '54000';
  end if;
  return new;
end
$$;
revoke all on function public.limit_project_children() from public, anon, authenticated;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------

create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  created_by     uuid references auth.users (id) on delete set null,
  name           text not null check (char_length(btrim(name)) between 1 and 200),
  contact_name   text check (contact_name is null or char_length(contact_name) <= 200),
  contact_email  text check (contact_email is null or (char_length(contact_email) <= 320 and contact_email ~ '^[^@\s]+@[^@\s]+$')),
  website_url    text check (website_url is null or (char_length(website_url) <= 300 and website_url ~* '^https://[^\s/]+\.[^\s/]+(/[^\s]*)?$')),
  status         text not null default 'active' check (status in ('active', 'paused', 'finished')),
  notes          text check (notes is null or char_length(notes) <= 2000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, workspace_id)
);
create index clients_workspace_idx on public.clients (workspace_id, created_at desc);

create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

alter table public.clients enable row level security;

create policy clients_select_member on public.clients
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy clients_select_member on public.clients is
  'Members read their own workspace''s clients, and no other workspace''s.';

create policy clients_insert_editor on public.clients
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and created_by = (select auth.uid()));
comment on policy clients_insert_editor on public.clients is
  'Editors and above add a client to their own workspace, recorded as the creator.';

create policy clients_update_editor on public.clients
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy clients_update_editor on public.clients is
  'Editors and above edit a client of their own workspace (workspace and creator are not updatable columns).';

create policy clients_delete_admin on public.clients
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy clients_delete_admin on public.clients is
  'Admins and above delete a client (and with it the client''s projects, links and feedback).';

revoke all on public.clients from anon, authenticated;
grant select on public.clients to authenticated;
grant insert (workspace_id, created_by, name, contact_name, contact_email, website_url, status, notes) on public.clients to authenticated;
grant update (name, contact_name, contact_email, website_url, status, notes) on public.clients to authenticated;
grant delete on public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  client_id     uuid not null,
  created_by    uuid references auth.users (id) on delete set null,
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  summary       text check (summary is null or char_length(summary) <= 2000),
  status        text not null default 'in_progress' check (status in ('planning', 'in_progress', 'delivered')),
  website_url   text check (website_url is null or (char_length(website_url) <= 300 and website_url ~* '^https://[^\s/]+\.[^\s/]+(/[^\s]*)?$')),
  -- A link to the repository, never a clone of it: we hold no code and no repository credentials.
  repo_url      text check (repo_url is null or (char_length(repo_url) <= 300 and repo_url ~* '^https://(www\.)?(github\.com|gitlab\.com|bitbucket\.org)/[^\s]+$')),
  notes         text check (notes is null or char_length(notes) <= 4000),
  started_on    date,
  delivered_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete cascade,
  check (delivered_on is null or started_on is null or delivered_on >= started_on)
);
create index projects_workspace_idx on public.projects (workspace_id, created_at desc);
create index projects_client_idx on public.projects (client_id);

create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;

create policy projects_select_member on public.projects
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy projects_select_member on public.projects is
  'Members read their own workspace''s projects, and no other workspace''s.';

create policy projects_insert_editor on public.projects
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and created_by = (select auth.uid()));
comment on policy projects_insert_editor on public.projects is
  'Editors and above add a project to a client of their own workspace (the composite foreign key ties it to that workspace).';

create policy projects_update_editor on public.projects
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy projects_update_editor on public.projects is
  'Editors and above edit a project of their own workspace (workspace, client and creator are not updatable columns).';

create policy projects_delete_admin on public.projects
  for delete to authenticated
  using (public.is_member(workspace_id, 'admin'));
comment on policy projects_delete_admin on public.projects is
  'Admins and above delete a project and its links and feedback.';

revoke all on public.projects from anon, authenticated;
grant select on public.projects to authenticated;
grant insert (workspace_id, client_id, created_by, name, summary, status, website_url, repo_url, notes, started_on, delivered_on) on public.projects to authenticated;
grant update (name, summary, status, website_url, repo_url, notes, started_on, delivered_on) on public.projects to authenticated;
grant delete on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- project_links (up to 20 per project)
-- ---------------------------------------------------------------------------

create table public.project_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null,
  label         text not null check (char_length(btrim(label)) between 1 and 80),
  url           text not null check (char_length(url) <= 300 and url ~* '^https://[^\s/]+\.[^\s/]+(/[^\s]*)?$'),
  kind          text not null default 'other' check (kind in ('website', 'repo', 'design', 'docs', 'other')),
  created_at    timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_links_project_idx on public.project_links (project_id);
create trigger project_links_limit before insert on public.project_links
  for each row execute function public.limit_project_children('20');

alter table public.project_links enable row level security;

create policy project_links_select_member on public.project_links
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy project_links_select_member on public.project_links is
  'Members read their own workspace''s project links, and no other workspace''s.';

create policy project_links_insert_editor on public.project_links
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor'));
comment on policy project_links_insert_editor on public.project_links is
  'Editors and above add a link to a project of their own workspace (https only, checked by the table constraint).';

create policy project_links_update_editor on public.project_links
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy project_links_update_editor on public.project_links is
  'Editors and above edit a link''s label, address or kind in their own workspace.';

create policy project_links_delete_editor on public.project_links
  for delete to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy project_links_delete_editor on public.project_links is
  'Editors and above remove a link from a project of their own workspace.';

revoke all on public.project_links from anon, authenticated;
grant select on public.project_links to authenticated;
grant insert (workspace_id, project_id, label, url, kind) on public.project_links to authenticated;
grant update (label, url, kind) on public.project_links to authenticated;
grant delete on public.project_links to authenticated;

-- ---------------------------------------------------------------------------
-- project_feedback (up to 100 per project)
-- ---------------------------------------------------------------------------

create table public.project_feedback (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null,
  created_by    uuid references auth.users (id) on delete set null,
  source        text not null default 'client' check (source in ('client', 'team')),
  author_name   text check (author_name is null or char_length(author_name) <= 120),
  body          text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at    timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_feedback_project_idx on public.project_feedback (project_id, created_at desc);
create trigger project_feedback_limit before insert on public.project_feedback
  for each row execute function public.limit_project_children('100');

alter table public.project_feedback enable row level security;

create policy project_feedback_select_member on public.project_feedback
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy project_feedback_select_member on public.project_feedback is
  'Members read their own workspace''s project feedback, and no other workspace''s.';

create policy project_feedback_insert_editor on public.project_feedback
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and created_by = (select auth.uid()));
comment on policy project_feedback_insert_editor on public.project_feedback is
  'Editors and above record feedback on a project of their own workspace, as themselves.';

create policy project_feedback_update_editor on public.project_feedback
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy project_feedback_update_editor on public.project_feedback is
  'Editors and above correct the wording, author or source of feedback in their own workspace.';

create policy project_feedback_delete_editor on public.project_feedback
  for delete to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy project_feedback_delete_editor on public.project_feedback is
  'Editors and above remove feedback from a project of their own workspace.';

revoke all on public.project_feedback from anon, authenticated;
grant select on public.project_feedback to authenticated;
grant insert (workspace_id, project_id, created_by, source, author_name, body) on public.project_feedback to authenticated;
grant update (source, author_name, body) on public.project_feedback to authenticated;
grant delete on public.project_feedback to authenticated;
