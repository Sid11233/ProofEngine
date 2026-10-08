-- Social posts and carousels written from a project (what the agency typed about it plus the client feedback it recorded).
--
-- Different from social_posts (which come from a published, client-approved case study): here the facts are what the
-- owner typed, so every set is stored with the owner's attestation that the client agreed to be quoted and shown. The
-- app checks quotes and numbers against those typed sources before saving; the database holds the rows and the rules
-- about who may change them.
--
-- One row per post or carousel: a caption (body) and, for a carousel, 2 to 10 slides of short text. Nothing is posted
-- anywhere by the app. Up to 60 rows per project.
--
-- Also adds projects.key_facts: the owner's own list of results and facts to highlight. It is a typed source for posts,
-- like the summary and the client feedback.
--
-- Rollback (dev only): drop table public.project_posts; alter table public.projects drop column key_facts;

alter table public.projects add column key_facts text check (key_facts is null or char_length(key_facts) <= 1500);
grant insert (key_facts) on public.projects to authenticated;
grant update (key_facts) on public.projects to authenticated;

create table public.project_posts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  project_id    uuid not null,
  created_by    uuid references auth.users (id) on delete set null,
  network       text not null check (network in ('linkedin', 'x', 'facebook', 'instagram', 'tiktok')),
  kind          text not null check (kind in ('post', 'carousel')),
  body          text not null check (char_length(btrim(body)) between 1 and 3000),
  slides        jsonb check (
    slides is null
    or (jsonb_typeof(slides) = 'array' and jsonb_array_length(slides) between 2 and 10 and octet_length(slides::text) <= 20000)
  ),
  attested      boolean not null check (attested),
  status        text not null default 'draft' check (status in ('draft', 'saved', 'posted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'carousel') = (slides is not null)),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_posts_project_idx on public.project_posts (project_id, created_at desc);
create index project_posts_workspace_idx on public.project_posts (workspace_id);

create trigger project_posts_limit before insert on public.project_posts
  for each row execute function public.limit_project_children('60');
create trigger project_posts_touch before update on public.project_posts
  for each row execute function public.touch_updated_at();

alter table public.project_posts enable row level security;

create policy project_posts_select_member on public.project_posts
  for select to authenticated
  using (public.is_member(workspace_id));
comment on policy project_posts_select_member on public.project_posts is
  'Members read their own workspace''s project posts, and no other workspace''s.';

create policy project_posts_insert_editor on public.project_posts
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and created_by = (select auth.uid()));
comment on policy project_posts_insert_editor on public.project_posts is
  'Editors and above save posts for a project of their own workspace, as themselves. The attestation column must be true (table constraint).';

create policy project_posts_update_editor on public.project_posts
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy project_posts_update_editor on public.project_posts is
  'Editors and above edit the caption, slides or status of a post in their own workspace (nothing else is an updatable column).';

create policy project_posts_delete_editor on public.project_posts
  for delete to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy project_posts_delete_editor on public.project_posts is
  'Editors and above discard a post in their own workspace.';

revoke all on public.project_posts from anon, authenticated;
grant select on public.project_posts to authenticated;
grant insert (workspace_id, project_id, created_by, network, kind, body, slides, attested) on public.project_posts to authenticated;
grant update (body, slides, status) on public.project_posts to authenticated;
grant delete on public.project_posts to authenticated;
