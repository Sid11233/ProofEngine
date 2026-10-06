-- Phase 10: the Light finder. A curated, global list of communities plus each workspace's own tracker.
--
--   * communities is global reference data: any signed-in user can read the active rows; nobody can write
--     through the API (it is managed by migrations or an admin script run with the service role). URLs must
--     be https, and the lengths are bounded.
--   * workspace_communities is the tracker: readable and writable only by editor+ members of that workspace,
--     with a bounded notes field. Notes are plain text and are only ever rendered as text.
--   * The 40 seeded rows are PLACEHOLDERS (needs_verification = true, example.com URLs). Replace them with
--     researched entries and set last_verified_at; nothing here scrapes or monitors any platform.
--
-- Rollback (dev only): drop table public.workspace_communities; drop table public.communities;

create table public.communities (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 1 and 150),
  platform            text not null check (platform in ('reddit', 'discord', 'slack', 'linkedin', 'facebook', 'forum', 'other')),
  url                 text not null check (char_length(url) <= 500 and url ~ '^https://[^\s]+$'),
  niches              text[] not null default '{}' check (cardinality(niches) <= 20 and array_to_string(niches, ',') ~ '^[a-z0-9,-]*$'),
  audience            text check (audience is null or char_length(audience) <= 300),
  rules_summary       text check (rules_summary is null or char_length(rules_summary) <= 1000),
  self_promo_policy   text check (self_promo_policy is null or char_length(self_promo_policy) <= 500),
  needs_verification  boolean not null default true,
  last_verified_at    timestamptz,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create index communities_niches_idx on public.communities using gin (niches);

alter table public.communities enable row level security;

create policy communities_select_authenticated on public.communities
  for select to authenticated
  using (active);
comment on policy communities_select_authenticated on public.communities is
  'Any signed-in user can browse the active communities. Nobody can write through the API: the list is managed by migrations or an admin script using the service role.';

revoke all on public.communities from anon, authenticated;
grant select on public.communities to authenticated;

create table public.workspace_communities (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  community_id  uuid not null references public.communities (id) on delete cascade,
  status        text not null default 'saved' check (status in ('saved', 'joined', 'posted', 'dropped')),
  notes         text check (notes is null or char_length(notes) <= 2000),
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, community_id)
);

create index workspace_communities_community_idx on public.workspace_communities (community_id);

alter table public.workspace_communities enable row level security;

create policy workspace_communities_select_editor on public.workspace_communities
  for select to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy workspace_communities_select_editor on public.workspace_communities is
  'Editors and above read their own workspace''s tracker, and no other workspace''s.';

create policy workspace_communities_insert_editor on public.workspace_communities
  for insert to authenticated
  with check (public.is_member(workspace_id, 'editor') and exists (select 1 from public.communities c where c.id = community_id and c.active));
comment on policy workspace_communities_insert_editor on public.workspace_communities is
  'Editors and above add an active community to their own workspace''s tracker.';

create policy workspace_communities_update_editor on public.workspace_communities
  for update to authenticated
  using (public.is_member(workspace_id, 'editor'))
  with check (public.is_member(workspace_id, 'editor'));
comment on policy workspace_communities_update_editor on public.workspace_communities is
  'Editors and above change status and notes (the only updatable columns) in their own workspace.';

create policy workspace_communities_delete_editor on public.workspace_communities
  for delete to authenticated
  using (public.is_member(workspace_id, 'editor'));
comment on policy workspace_communities_delete_editor on public.workspace_communities is
  'Editors and above remove a community from their own workspace''s tracker.';

revoke all on public.workspace_communities from anon, authenticated;
grant select on public.workspace_communities to authenticated;
grant insert (workspace_id, community_id, status, notes) on public.workspace_communities to authenticated;
grant update (status, notes) on public.workspace_communities to authenticated;
grant delete on public.workspace_communities to authenticated;

create function public.touch_workspace_community()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger workspace_communities_touch
  before update on public.workspace_communities
  for each row execute function public.touch_workspace_community();

revoke all on function public.touch_workspace_community() from public, anon, authenticated;

-- PLACEHOLDER SEED: 40 entries across 8 niches. Replace with researched, verified communities.
insert into public.communities (id, name, platform, url, niches, audience, rules_summary, self_promo_policy) values
  ('b0000000-0000-4000-8000-000000000001', '[Placeholder] SaaS founders on Reddit', 'reddit', 'https://example.com/placeholder/saas-reddit', array['saas','startups'], 'Founders and operators building subscription software', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000002', '[Placeholder] SaaS founders on Discord', 'discord', 'https://example.com/placeholder/saas-discord', array['saas'], 'Founders and operators building subscription software', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000003', '[Placeholder] SaaS founders on Slack', 'slack', 'https://example.com/placeholder/saas-slack', array['saas','startups'], 'Founders and operators building subscription software', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000004', '[Placeholder] SaaS founders on Linkedin', 'linkedin', 'https://example.com/placeholder/saas-linkedin', array['saas'], 'Founders and operators building subscription software', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000005', '[Placeholder] SaaS founders on Facebook', 'facebook', 'https://example.com/placeholder/saas-facebook', array['saas','startups'], 'Founders and operators building subscription software', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000006', '[Placeholder] Agency owners on Reddit', 'reddit', 'https://example.com/placeholder/agency-reddit', array['agency','marketing'], 'Owners and heads of small digital agencies', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000007', '[Placeholder] Agency owners on Discord', 'discord', 'https://example.com/placeholder/agency-discord', array['agency'], 'Owners and heads of small digital agencies', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000008', '[Placeholder] Agency owners on Slack', 'slack', 'https://example.com/placeholder/agency-slack', array['agency','marketing'], 'Owners and heads of small digital agencies', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000009', '[Placeholder] Agency owners on Linkedin', 'linkedin', 'https://example.com/placeholder/agency-linkedin', array['agency'], 'Owners and heads of small digital agencies', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000010', '[Placeholder] Agency owners on Facebook', 'facebook', 'https://example.com/placeholder/agency-facebook', array['agency','marketing'], 'Owners and heads of small digital agencies', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000011', '[Placeholder] Marketers on Reddit', 'reddit', 'https://example.com/placeholder/marketing-reddit', array['marketing','agency'], 'Content, growth and demand generation marketers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000012', '[Placeholder] Marketers on Discord', 'discord', 'https://example.com/placeholder/marketing-discord', array['marketing'], 'Content, growth and demand generation marketers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000013', '[Placeholder] Marketers on Slack', 'slack', 'https://example.com/placeholder/marketing-slack', array['marketing','agency'], 'Content, growth and demand generation marketers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000014', '[Placeholder] Marketers on Linkedin', 'linkedin', 'https://example.com/placeholder/marketing-linkedin', array['marketing'], 'Content, growth and demand generation marketers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000015', '[Placeholder] Marketers on Facebook', 'facebook', 'https://example.com/placeholder/marketing-facebook', array['marketing','agency'], 'Content, growth and demand generation marketers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000016', '[Placeholder] Designers on Reddit', 'reddit', 'https://example.com/placeholder/design-reddit', array['design','agency'], 'Product, brand and web designers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000017', '[Placeholder] Designers on Discord', 'discord', 'https://example.com/placeholder/design-discord', array['design'], 'Product, brand and web designers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000018', '[Placeholder] Designers on Slack', 'slack', 'https://example.com/placeholder/design-slack', array['design','agency'], 'Product, brand and web designers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000019', '[Placeholder] Designers on Linkedin', 'linkedin', 'https://example.com/placeholder/design-linkedin', array['design'], 'Product, brand and web designers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000020', '[Placeholder] Designers on Facebook', 'facebook', 'https://example.com/placeholder/design-facebook', array['design','agency'], 'Product, brand and web designers', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000021', '[Placeholder] Developers on Reddit', 'reddit', 'https://example.com/placeholder/development-reddit', array['development','saas'], 'Software engineers and technical founders', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000022', '[Placeholder] Developers on Discord', 'discord', 'https://example.com/placeholder/development-discord', array['development'], 'Software engineers and technical founders', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000023', '[Placeholder] Developers on Slack', 'slack', 'https://example.com/placeholder/development-slack', array['development','saas'], 'Software engineers and technical founders', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000024', '[Placeholder] Developers on Linkedin', 'linkedin', 'https://example.com/placeholder/development-linkedin', array['development'], 'Software engineers and technical founders', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000025', '[Placeholder] Developers on Facebook', 'facebook', 'https://example.com/placeholder/development-facebook', array['development','saas'], 'Software engineers and technical founders', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000026', '[Placeholder] E-commerce on Reddit', 'reddit', 'https://example.com/placeholder/ecommerce-reddit', array['ecommerce','marketing'], 'Online store owners and e-commerce operators', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000027', '[Placeholder] E-commerce on Discord', 'discord', 'https://example.com/placeholder/ecommerce-discord', array['ecommerce'], 'Online store owners and e-commerce operators', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000028', '[Placeholder] E-commerce on Slack', 'slack', 'https://example.com/placeholder/ecommerce-slack', array['ecommerce','marketing'], 'Online store owners and e-commerce operators', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000029', '[Placeholder] E-commerce on Linkedin', 'linkedin', 'https://example.com/placeholder/ecommerce-linkedin', array['ecommerce'], 'Online store owners and e-commerce operators', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000030', '[Placeholder] E-commerce on Facebook', 'facebook', 'https://example.com/placeholder/ecommerce-facebook', array['ecommerce','marketing'], 'Online store owners and e-commerce operators', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000031', '[Placeholder] Consultants on Reddit', 'reddit', 'https://example.com/placeholder/consulting-reddit', array['consulting','agency'], 'Independent consultants and fractional executives', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000032', '[Placeholder] Consultants on Discord', 'discord', 'https://example.com/placeholder/consulting-discord', array['consulting'], 'Independent consultants and fractional executives', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000033', '[Placeholder] Consultants on Slack', 'slack', 'https://example.com/placeholder/consulting-slack', array['consulting','agency'], 'Independent consultants and fractional executives', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000034', '[Placeholder] Consultants on Linkedin', 'linkedin', 'https://example.com/placeholder/consulting-linkedin', array['consulting'], 'Independent consultants and fractional executives', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000035', '[Placeholder] Consultants on Facebook', 'facebook', 'https://example.com/placeholder/consulting-facebook', array['consulting','agency'], 'Independent consultants and fractional executives', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)'),
  ('b0000000-0000-4000-8000-000000000036', '[Placeholder] AI builders on Reddit', 'reddit', 'https://example.com/placeholder/ai-reddit', array['ai','saas'], 'People building with or selling AI services', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Case studies allowed if they teach something (unverified)'),
  ('b0000000-0000-4000-8000-000000000037', '[Placeholder] AI builders on Discord', 'discord', 'https://example.com/placeholder/ai-discord', array['ai'], 'People building with or selling AI services', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Ask a moderator before posting links (unverified)'),
  ('b0000000-0000-4000-8000-000000000038', '[Placeholder] AI builders on Slack', 'slack', 'https://example.com/placeholder/ai-slack', array['ai','saas'], 'People building with or selling AI services', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Self-promotion forbidden (unverified)'),
  ('b0000000-0000-4000-8000-000000000039', '[Placeholder] AI builders on Linkedin', 'linkedin', 'https://example.com/placeholder/ai-linkedin', array['ai'], 'People building with or selling AI services', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'Unknown: read the pinned rules (unverified)'),
  ('b0000000-0000-4000-8000-000000000040', '[Placeholder] AI builders on Facebook', 'facebook', 'https://example.com/placeholder/ai-facebook', array['ai','saas'], 'People building with or selling AI services', 'PLACEHOLDER: replace with the real rules summary after reading the community''s rules.', 'No self-promotion outside a weekly thread (unverified)');
