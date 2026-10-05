-- Phase 5.2: templates as configuration, and the single plan/entitlement check.
--
-- A template is data: the section types it allows, a default theme and the NAME of a layout
-- variant that is implemented in code. Nothing in this table is ever rendered as HTML.
--
-- Rollback (dev only):
--   drop function if exists public.template_allowed(uuid, uuid);
--   delete from public.templates where id::text like 'a0000000-0000-4000-8000-00000000000_';

insert into public.templates (id, name, category, tier, sections, default_theme, active) values
  ('a0000000-0000-4000-8000-000000000001', 'Classic', 'general', 'free',
   '["challenge","solution","results","quote","cta"]',
   '{"layout":"classic","primary":"#1d4ed8","fontPair":"inter","radius":"md","spacing":"comfortable","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000002', 'Minimal', 'general', 'free',
   '["challenge","results","quote"]',
   '{"layout":"minimal","primary":"#111827","fontPair":"lora-inter","radius":"none","spacing":"spacious","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000003', 'Before and After', 'story', 'pro',
   '["challenge","solution","results","quote","cta"]',
   '{"layout":"before-after","primary":"#047857","fontPair":"poppins-inter","radius":"lg","spacing":"comfortable","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000004', 'Timeline Story', 'story', 'pro',
   '["challenge","trigger","solution","results","quote","cta"]',
   '{"layout":"timeline","primary":"#7c3aed","fontPair":"space-grotesk-inter","radius":"md","spacing":"comfortable","mode":"light"}', true),
  ('a0000000-0000-4000-8000-000000000005', 'SaaS Switch Story', 'saas', 'pro',
   '["challenge","trigger","solution","results","quote","audience","cta"]',
   '{"layout":"saas-switch","primary":"#0ea5e9","fontPair":"inter","radius":"xl","spacing":"comfortable","mode":"dark"}', true)
on conflict (id) do update
  set name = excluded.name, category = excluded.category, tier = excluded.tier,
      sections = excluded.sections, default_theme = excluded.default_theme, active = excluded.active;

-- ---------------------------------------------------------------------------
-- template_allowed
-- ---------------------------------------------------------------------------

-- The one rule for "may this workspace use this template", used by the app and (Phase 6.2)
-- by the publish trigger, so the two can never disagree.
--   free  -> any active template
--   pro   -> a pro or team plan, or a purchased entitlement
--   pack  -> a purchased entitlement only
-- Only members of the workspace (or the server) get an answer; everyone else gets false.
create function public.template_allowed(ws uuid, tpl uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select
      t.active
      and (public.is_member(ws) or (select auth.role()) = 'service_role')
      and (
        t.tier = 'free'
        or (t.tier = 'pro' and exists (select 1 from public.workspaces w where w.id = ws and w.plan in ('pro', 'team')))
        or exists (select 1 from public.template_entitlements e where e.workspace_id = ws and e.template_id = t.id)
      )
    from public.templates t
    where t.id = tpl
  ), false)
$$;

revoke all on function public.template_allowed(uuid, uuid) from public, anon;
grant execute on function public.template_allowed(uuid, uuid) to authenticated, service_role;
