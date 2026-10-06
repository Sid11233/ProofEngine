-- Security guardrails read straight from the catalog. These fail the build if a future migration
-- weakens the access model: a table without RLS, anonymous access, an unpinned SECURITY DEFINER
-- function, an unexpected RPC, or a direct-write path that must stay closed.
-- Run with: npx supabase test db

begin;
select plan(26);

-- Tables and policies ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every public table has row level security enabled');

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  array['ai_daily_usage', 'stripe_events'],
  'the only tables with RLS and no policy are the server-only ai_daily_usage and stripe_events');

select is(
  (select array_agg(distinct polrelid::regclass::text order by polrelid::regclass::text) from pg_policy
   where pg_get_expr(polqual, polrelid) = 'true'),
  array['templates'],
  'only the global template catalogue has a policy that is simply "true"');

select is(
  (select count(*)::int from pg_policy where polcmd = 'w' and polwithcheck is null),
  0, 'every UPDATE policy has a WITH CHECK');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname not in ('public_case_studies', 'public_wall_settings')
     and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') <> 'true'),
  0, 'every public view except the reviewed public one runs with the caller''s privileges (security_invoker)');

select is(
  (select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') <> 'true'),
  array['public_case_studies', 'public_wall_settings'], 'the only views that bypass row-level security are the two reviewed public ones');

select is(
  (select array_agg(c.relname::text) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname in ('public_case_studies', 'public_wall_settings') and c.reloptions::text like '%security_barrier=true%'),
  array['public_case_studies', 'public_wall_settings'], 'the public views are security barriers');

-- No signed-in role can write through a view ----------------------------------------------------
select is(
  (select coalesce(array_agg(g.table_name::text || ':' || g.privilege_type order by g.table_name, g.privilege_type), '{}')
   from information_schema.role_table_grants g
   join information_schema.tables t on t.table_schema = g.table_schema and t.table_name = g.table_name and t.table_type = 'VIEW'
   where g.grantee = 'authenticated' and g.table_schema = 'public' and g.privilege_type <> 'SELECT'),
  '{}'::text[], 'authenticated can only SELECT from views (no insert, update, delete or truncate)');

-- Anonymous access ------------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(table_name::text || ':' || privilege_type order by table_name, privilege_type), '{}')
   from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  array['public_case_studies:SELECT', 'public_wall_settings:SELECT'], 'anon can only SELECT the two reviewed public views and holds nothing else');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'public_case_studies'
     and column_name in ('id', 'workspace_id', 'interview_id', 'client_declined_at', 'current_version', 'status', 'generation_issues')),
  0, 'the public view exposes no internal columns');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon can execute no function in the public schema (no anonymous RPC)');

select is(has_schema_privilege('anon', 'public', 'CREATE') or has_schema_privilege('authenticated', 'public', 'CREATE'),
  false, 'API roles cannot create objects in the public schema');

-- Functions -------------------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""')),
  0, 'every SECURITY DEFINER function pins an empty search_path');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proconfig::text ~ 'search_path=[^"]*public'),
  0, 'no function puts the public schema on its search_path');

select set_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  $$ values ('accept_invite'), ('autosave_case_study'), ('bump_ai_usage'), ('change_member_role'),
            ('create_generated_case_study'), ('create_invite'), ('create_preview_link'), ('create_proof_request'),
            ('create_workspace'), ('get_invite_preview'), ('is_member'), ('is_reserved_slug'), ('list_team_members'),
            ('plan_interview_limit'), ('publish_case_study'), ('remove_member'), ('request_client_approval'), ('revoke_invite'), ('revoke_preview_link'), ('revoke_request'),
            ('role_rank'), ('rotate_request_token'), ('save_case_study_edit'), ('save_notification_preferences'), ('save_push_subscription'), ('save_wall_settings'), ('snapshot_case_study'),
            ('template_allowed'), ('unpublish_case_study'), ('write_audit_log') $$,
  'the RPC surface for signed-in users is exactly the reviewed list (a new function must be added here on purpose)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('start_interview', 'record_client_message', 'record_bot_message', 'finish_interview',
                       'record_upload', 'check_ai_breaker', 'audit', 'handle_new_user',
                       'check_claim_quote', 'guard_last_owner', 'reject_mutation')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0, 'server-only and trigger functions are not callable by signed-in users');

-- Direct-write paths that must stay closed -------------------------------------------------------
select is(has_table_privilege('authenticated', 'public.case_studies', 'INSERT')
       or has_any_column_privilege('authenticated', 'public.case_studies', 'INSERT'),
  false, 'case studies cannot be inserted directly (consent and schema are enforced by the function)');

select is(has_table_privilege('authenticated', 'public.case_study_versions', 'INSERT')
       or has_any_column_privilege('authenticated', 'public.case_study_versions', 'INSERT'),
  false, 'case study versions cannot be inserted directly');

select is(has_table_privilege('authenticated', 'public.claims', 'INSERT')
       or has_any_column_privilege('authenticated', 'public.claims', 'INSERT'),
  false, 'claims cannot be inserted directly');

select is(has_any_column_privilege('authenticated', 'public.claims', 'UPDATE'),
  false, 'claims cannot be updated directly (confirmation is server-only)');

select is(has_any_column_privilege('authenticated', 'public.workspaces', 'UPDATE')
      and has_column_privilege('authenticated', 'public.workspaces', 'plan', 'UPDATE'),
  false, 'the workspace plan cannot be changed by clients');

select is(has_column_privilege('authenticated', 'public.proof_requests', 'token_hash', 'SELECT')
       or has_column_privilege('authenticated', 'public.proof_requests', 'token_hash', 'UPDATE'),
  false, 'proof request token hashes are neither readable nor writable by clients');

select is(has_column_privilege('authenticated', 'public.workspace_invites', 'token_hash', 'SELECT')
       or has_column_privilege('authenticated', 'public.case_study_previews', 'token_hash', 'SELECT'),
  false, 'invite and preview token hashes are not readable by clients');

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name in ('audit_log', 'approvals', 'usage_counters', 'subscriptions', 'interviews', 'interview_messages')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, 'append-only and server-written tables have no client write privilege');

-- Storage ---------------------------------------------------------------------------------------
select is(
  case when to_regclass('storage.buckets') is null then 0
       else (select count(*)::int from storage.buckets where public) end,
  0, 'no storage bucket is public');

select is(
  case when to_regclass('storage.objects') is null then 0
       else (select count(*)::int from pg_policy where polrelid = 'storage.objects'::regclass) end,
  0, 'no storage policy lets a client touch files directly (the server hands out signed URLs)');

select * from finish();
rollback;
