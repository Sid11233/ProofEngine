-- Phase 11 audit M1: the four dashboard views (migration 20261011000001) were created with the project's
-- default privileges, which gave the signed-in role INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER
-- on them. The underlying tables still blocked every write (grouped views are not updatable and the tables
-- have no write policy), but a view should never advertise write access. Only SELECT is granted.
--
-- Rollback (dev only): none needed; re-granting these privileges would only be a regression.

revoke all on public.page_event_daily, public.case_study_status_counts, public.referral_status_counts, public.request_funnel from authenticated;
grant select on public.page_event_daily, public.case_study_status_counts, public.referral_status_counts, public.request_funnel to authenticated;
