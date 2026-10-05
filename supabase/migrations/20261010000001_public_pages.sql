-- Phase 6.3: the one thing an anonymous visitor may read: published case studies.
--
-- public_case_studies is a view owned by the migration role, so it reads case_studies, workspaces and
-- templates without giving anon any access to those tables. The WHERE clause is the guard: only
-- published rows, and only the columns a public page needs. No ids of people, no claims, no
-- interview, no approval data, no workspace id, no client email. The logo path is replaced by a flag
-- plus the storage path the logo route needs (the bucket stays private).
--
-- Rollback (dev only): drop view public.public_case_studies;

create view public.public_case_studies
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
  t.active                                  as template_active
from public.case_studies cs
join public.workspaces w on w.id = cs.workspace_id
-- No template chosen yet means the free default, so anonymous visitors never need the templates table.
left join public.templates t on t.id = coalesce(
  cs.template_id,
  (select d.id from public.templates d where d.tier = 'free' and d.active order by (d.name = 'Classic') desc, d.name limit 1)
)
where cs.status = 'published'
  and cs.slug is not null
  and w.subdomain_slug is not null;

comment on view public.public_case_studies is
  'The only anonymous read surface: published case studies with public-safe columns. Add columns here deliberately; never expose ids of people, claims, interviews or approvals.';

revoke all on public.public_case_studies from public, anon, authenticated;
grant select on public.public_case_studies to anon, authenticated, service_role;
