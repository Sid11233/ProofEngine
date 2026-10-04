-- Database-level rules that cannot be proven through the API alone: triggers,
-- constraints and cascades. Runs as the postgres superuser inside a transaction
-- that is rolled back. Run with:  npx supabase test db
--
-- API-level tenant isolation (RLS) lives in supabase/tests/isolation/.

begin;
select plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@test.local');

insert into public.workspaces (id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', 'WS A', 'agency'),
  ('10000000-0000-0000-0000-00000000000b', 'WS B', 'saas'),
  ('10000000-0000-0000-0000-00000000000c', 'WS C (cascade)', 'agency');

insert into public.workspace_members (workspace_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a2', 'owner'),
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a3', 'owner');

-- Workspace A: request -> interview -> messages -> case study -> version
insert into public.proof_requests (id, workspace_id, client_name, client_email, flow_type, token_hash, expires_at)
values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
        'Client', 'client@example.com', 'agency', repeat('a', 64), now() + interval '30 days');

insert into public.interviews (id, request_id, workspace_id) values
  ('30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a');

insert into public.interview_messages (id, interview_id, workspace_id, role, content) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', 'client', 'We cut onboarding time by 40 percent in March.'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', 'bot', 'How much time did you save, exactly?');

insert into public.case_studies (id, workspace_id, interview_id) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
   '30000000-0000-0000-0000-00000000000a');

insert into public.case_study_versions (id, case_study_id, workspace_id, version, content) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000a',
   '10000000-0000-0000-0000-00000000000a', 1, '{}');

insert into public.approvals (id, case_study_id, workspace_id, version, approver_email, method)
values ('70000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000a',
        '10000000-0000-0000-0000-00000000000a', 1, 'client@example.com', 'email_link');

insert into public.audit_log (id, workspace_id, actor, action) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000a1', 'test.event');

-- ---------------------------------------------------------------------------
-- Helpers and constraints
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'signing up creates a profile row via trigger');

select is(public.role_rank('owner'), 4, 'role_rank(owner) = 4');
select is(public.role_rank('adimn'), null, 'role_rank returns NULL for an unknown role (fails closed)');

select throws_ok(
  $$ update public.workspaces set subdomain_slug = 'admin' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'reserved subdomain slug is rejected');
select throws_ok(
  $$ update public.workspaces set subdomain_slug = 'Has-Capitals' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'invalid subdomain slug format is rejected');
select lives_ok(
  $$ update public.workspaces set subdomain_slug = 'acme-agency' where id = '10000000-0000-0000-0000-00000000000a' $$,
  'a normal subdomain slug is accepted');
select throws_ok(
  $$ update public.workspaces set website = 'http://insecure.example.com' where id = '10000000-0000-0000-0000-00000000000a' $$,
  '23514', null, 'non-https website is rejected');

select throws_ok(
  $$ insert into public.proof_requests (workspace_id, client_name, client_email, flow_type, token_hash, expires_at)
     values ('10000000-0000-0000-0000-00000000000a', 'X', 'x@example.com', 'agency', repeat('b', 64), now() + interval '365 days') $$,
  '23514', null, 'a link that lives longer than 90 days is rejected');
select throws_ok(
  $$ insert into public.proof_requests (workspace_id, client_name, client_email, flow_type, token_hash, expires_at)
     values ('10000000-0000-0000-0000-00000000000a', 'X', 'x@example.com', 'agency', 'not-a-sha256-hex', now() + interval '1 day') $$,
  '23514', null, 'token_hash must be a 64-char hex SHA-256');

-- ---------------------------------------------------------------------------
-- Composite foreign keys keep workspace_id consistent with the parent
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.interviews (request_id, workspace_id)
     values ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b') $$,
  '23503', null, 'an interview cannot point at another workspace''s request');
select throws_ok(
  $$ insert into public.interview_messages (interview_id, workspace_id, role, content)
     values ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b', 'client', 'x') $$,
  '23503', null, 'a message cannot be attached to another workspace''s interview');

-- ---------------------------------------------------------------------------
-- Last owner protection
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.workspace_members
     where workspace_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', 'A workspace must keep at least one owner', 'the last owner cannot be removed');
select throws_ok(
  $$ update public.workspace_members set role = 'admin'
     where workspace_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', 'A workspace must keep at least one owner', 'the last owner cannot be demoted');

insert into public.workspace_members (workspace_id, user_id, role)
values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'owner');

select lives_ok(
  $$ delete from public.workspace_members
     where workspace_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'an owner can leave when another owner remains');
select throws_ok(
  $$ delete from public.workspace_members
     where workspace_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000a2' $$,
  '23514', 'A workspace must keep at least one owner', 'the remaining owner is now protected');

-- ---------------------------------------------------------------------------
-- Claims: quotes must appear verbatim in a CLIENT message
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.claims (case_study_id, workspace_id, text, source_message_id, source_quote)
     values ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
             'Onboarding time fell 40 percent', '40000000-0000-0000-0000-000000000001', 'cut onboarding time by 40 percent') $$,
  'a claim with a verbatim client quote is accepted');
select throws_ok(
  $$ insert into public.claims (case_study_id, workspace_id, text, source_message_id, source_quote)
     values ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
             'Onboarding time fell 90 percent', '40000000-0000-0000-0000-000000000001', 'cut onboarding time by 90 percent') $$,
  '23514', null, 'a claim with an invented number is rejected');
select throws_ok(
  $$ insert into public.claims (case_study_id, workspace_id, text, source_message_id, source_quote)
     values ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a',
             'Quote from the bot', '40000000-0000-0000-0000-000000000002', 'How much time did you save') $$,
  '23514', null, 'a claim sourced from a bot message is rejected');

-- ---------------------------------------------------------------------------
-- Append-only tables reject update and delete, even for the superuser
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.case_study_versions set content = '{"x":1}' where id = '60000000-0000-0000-0000-000000000001' $$,
  '42501', 'case_study_versions is append-only', 'case_study_versions rejects update');
select throws_ok(
  $$ delete from public.case_study_versions where id = '60000000-0000-0000-0000-000000000001' $$,
  '42501', 'case_study_versions is append-only', 'case_study_versions rejects delete');
select throws_ok(
  $$ update public.approvals set approver_email = 'evil@example.com' where id = '70000000-0000-0000-0000-000000000001' $$,
  '42501', 'approvals is append-only', 'approvals rejects update');
select throws_ok(
  $$ delete from public.approvals where id = '70000000-0000-0000-0000-000000000001' $$,
  '42501', 'approvals is append-only', 'approvals rejects delete');
select throws_ok(
  $$ update public.audit_log set action = 'tampered' where id = '80000000-0000-0000-0000-000000000001' $$,
  '42501', 'audit_log is append-only', 'audit_log rejects update');
select throws_ok(
  $$ delete from public.audit_log where id = '80000000-0000-0000-0000-000000000001' $$,
  '42501', 'audit_log is append-only', 'audit_log rejects delete');

-- ---------------------------------------------------------------------------
-- Hard-deleting a workspace must still remove everything, append-only included
-- ---------------------------------------------------------------------------
insert into public.proof_requests (id, workspace_id, client_name, client_email, flow_type, token_hash, expires_at)
values ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000c',
        'Client', 'c@example.com', 'agency', repeat('c', 64), now() + interval '30 days');
insert into public.case_studies (id, workspace_id) values
  ('50000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000c');
insert into public.case_study_versions (case_study_id, workspace_id, version, content)
values ('50000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000c', 1, '{}');
insert into public.approvals (case_study_id, workspace_id, version, approver_email, method)
values ('50000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000c', 1, 'c@example.com', 'email_link');
insert into public.audit_log (workspace_id, action) values ('10000000-0000-0000-0000-00000000000c', 'test.event');

select lives_ok(
  $$ delete from public.workspaces where id = '10000000-0000-0000-0000-00000000000c' $$,
  'deleting a workspace (last owner, append-only children) succeeds');
select is(
  (select count(*)::int from public.case_study_versions where workspace_id = '10000000-0000-0000-0000-00000000000c')
  + (select count(*)::int from public.approvals where workspace_id = '10000000-0000-0000-0000-00000000000c')
  + (select count(*)::int from public.audit_log where workspace_id = '10000000-0000-0000-0000-00000000000c')
  + (select count(*)::int from public.workspace_members where workspace_id = '10000000-0000-0000-0000-00000000000c'),
  0, 'no rows remain for the deleted workspace');

select * from finish();
rollback;
