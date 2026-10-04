-- Invite rules that need a database session impersonating a specific user,
-- notably the verified-email requirement (an unconfirmed account cannot hold an
-- API session, so this cannot be tested through the REST API).
begin;
select plan(9);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner@t.local', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'unverified@t.local', null),
  ('00000000-0000-0000-0000-0000000000b3', 'verified@t.local', now());

insert into public.workspaces (id, name, type) values ('11000000-0000-0000-0000-00000000000a', 'Invite WS', 'agency');
insert into public.workspace_members (workspace_id, user_id, role)
values ('11000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'owner');

insert into public.workspace_invites (workspace_id, email, role, token_hash, created_by) values
  ('11000000-0000-0000-0000-00000000000a', 'unverified@t.local', 'viewer', repeat('a', 64), '00000000-0000-0000-0000-0000000000b1'),
  ('11000000-0000-0000-0000-00000000000a', 'verified@t.local', 'editor', repeat('b', 64), '00000000-0000-0000-0000-0000000000b1');

-- Act as the unverified user.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select throws_ok(
  $$ select public.accept_invite(repeat('a', 64)) $$,
  'P0002', 'Invitation is not valid', 'an unverified email cannot accept an invite');
select is((select count(*)::int from public.get_invite_preview(repeat('a', 64))), 0,
  'an unverified email cannot preview an invite');

-- Act as the verified user.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);

select throws_ok(
  $$ select public.accept_invite(repeat('a', 64)) $$,
  'P0002', 'Invitation is not valid', 'an invite addressed to someone else cannot be accepted');
select lives_ok($$ select public.accept_invite(repeat('b', 64)) $$, 'the addressed, verified user can accept');
select throws_ok(
  $$ select public.accept_invite(repeat('b', 64)) $$,
  'P0002', 'Invitation is not valid', 'an invite cannot be accepted twice');

reset role;
select is((select role from public.workspace_members
           where workspace_id = '11000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000b3'),
          'editor', 'the member got the invited role');
select is((select count(*)::int from public.workspace_members
           where workspace_id = '11000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000b2'),
          0, 'the unverified user was not added');

-- Constraints
select throws_ok(
  $$ insert into public.workspace_invites (workspace_id, email, role, token_hash)
     values ('11000000-0000-0000-0000-00000000000a', 'x@t.local', 'owner', repeat('c', 64)) $$,
  '23514', null, 'an invite can never carry the owner role');
select throws_ok(
  $$ insert into public.workspace_invites (workspace_id, email, role, token_hash, expires_at)
     values ('11000000-0000-0000-0000-00000000000a', 'y@t.local', 'viewer', repeat('d', 64), now() + interval '30 days') $$,
  '23514', null, 'an invite cannot live longer than 7 days');

select * from finish();
rollback;
