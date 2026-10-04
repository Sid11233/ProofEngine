-- Phase 2.2: one-line description captured during onboarding.
--
-- Rollback (dev only):
--   alter table public.workspaces drop column description;

alter table public.workspaces
  add column description text check (char_length(description) <= 300);

-- Same rule as the other profile columns: admin+ can edit (RLS), plan stays untouchable.
grant update (description) on public.workspaces to authenticated;
