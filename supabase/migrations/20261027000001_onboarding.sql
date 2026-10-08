-- Client onboarding interviews. The same link-and-chat engine that collects reviews, with a different purpose:
-- the business asks a new client a short list of its own questions and reads the answers in the app.
--
--   proof_requests.purpose              'review' (default) or 'onboarding'
--   proof_requests.client_id            optional link to a row in clients
--   proof_requests.questions_snapshot   onboarding only: the questions as they were when the link was made, so editing
--                                       the question list later never changes an interview already sent
--   question_flows.purpose              system flows are reviews or onboarding; a workspace may own ONE onboarding flow
--                                       (its "CMS": editors change the questions, admins nobody else)
--   create_onboarding_request()         the only way to create an onboarding request (role, monthly cap, audit)
--
-- Rollback (dev only): drop function public.create_onboarding_request(uuid, uuid, text, text, jsonb, text);
--   drop policy question_flows_insert_editor, question_flows_update_editor, question_flows_delete_editor on public.question_flows;
--   drop index question_flows_one_onboarding_per_workspace; delete from public.question_flows where purpose = 'onboarding';
--   alter table public.question_flows drop column purpose;
--   alter table public.proof_requests drop column purpose, drop column client_id, drop column questions_snapshot;
--   and recreate the proof_requests_safe view without the new columns.

-- ---------------------------------------------------------------------------
-- proof_requests
-- ---------------------------------------------------------------------------

alter table public.proof_requests
  add column purpose text not null default 'review' check (purpose in ('review', 'onboarding')),
  add column client_id uuid,
  add column questions_snapshot jsonb check (
    questions_snapshot is null
    or (jsonb_typeof(questions_snapshot) = 'array' and jsonb_array_length(questions_snapshot) between 1 and 12 and octet_length(questions_snapshot::text) <= 20000)
  ),
  add constraint proof_requests_snapshot_only_onboarding check (questions_snapshot is null or purpose = 'onboarding'),
  add constraint proof_requests_client_fk foreign key (client_id, workspace_id) references public.clients (id, workspace_id) on delete set null (client_id);

-- Column-level grants do not cover new columns. The snapshot is deliberately not readable by clients of the API.
grant select (purpose, client_id) on public.proof_requests to authenticated;

create or replace view public.proof_requests_safe
with (security_invoker = true) as
select
  id, workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, expires_at, revoked_at, status, created_at,
  reminder_count, last_reminder_at, sent_at, do_not_contact_at, purpose, client_id
from public.proof_requests;

-- ---------------------------------------------------------------------------
-- question_flows: system onboarding flows and one workspace-owned onboarding flow
-- ---------------------------------------------------------------------------

alter table public.question_flows add column purpose text not null default 'review' check (purpose in ('review', 'onboarding'));

-- Existing readers look flows up by (workspace_id is null, type); keep their results the same.
create unique index question_flows_one_onboarding_per_workspace on public.question_flows (workspace_id) where workspace_id is not null and purpose = 'onboarding';

create policy question_flows_insert_editor on public.question_flows
  for insert to authenticated
  with check (workspace_id is not null and purpose = 'onboarding' and public.is_member(workspace_id, 'editor'));
comment on policy question_flows_insert_editor on public.question_flows is
  'Editors and above create their workspace''s own onboarding question list. System flows and review flows are never client-writable.';

create policy question_flows_update_editor on public.question_flows
  for update to authenticated
  using (workspace_id is not null and purpose = 'onboarding' and public.is_member(workspace_id, 'editor'))
  with check (workspace_id is not null and purpose = 'onboarding' and public.is_member(workspace_id, 'editor'));
comment on policy question_flows_update_editor on public.question_flows is
  'Editors and above edit their workspace''s onboarding question list (name and questions are the only updatable columns).';

create policy question_flows_delete_editor on public.question_flows
  for delete to authenticated
  using (workspace_id is not null and purpose = 'onboarding' and public.is_member(workspace_id, 'editor'));
comment on policy question_flows_delete_editor on public.question_flows is
  'Editors and above reset to the standard questions by deleting their own onboarding list.';

grant insert (workspace_id, type, name, questions, purpose) on public.question_flows to authenticated;
grant update (name, questions) on public.question_flows to authenticated;
grant delete on public.question_flows to authenticated;

-- Standard onboarding questions. {{workspace}} is replaced with the business name when served.
-- key 'short' marks a question that wants a brief fact, so the interviewer does not ask follow-ups for it.
insert into public.question_flows (workspace_id, type, name, purpose, questions) values
  (null, 'agency', 'Agency client onboarding', 'onboarding', jsonb_build_array(
    jsonb_build_object('id', 'o1', 'key', 'about',    'text', 'Welcome! In a few sentences, what does your business do and who are your customers?'),
    jsonb_build_object('id', 'o2', 'key', 'goals',    'text', 'What do you most want to achieve by working with {{workspace}}?'),
    jsonb_build_object('id', 'o3', 'key', 'success',  'text', 'How will you know the project has been a success?'),
    jsonb_build_object('id', 'o4', 'key', 'brand',    'text', 'How would you describe your brand and the tone you like to use? Please mention any examples you admire.'),
    jsonb_build_object('id', 'o5', 'key', 'short',    'text', 'Which websites, accounts or tools should we know about? Please paste the links.'),
    jsonb_build_object('id', 'o6', 'key', 'short',    'text', 'Who will be our main contact on your side, and what is the best way and time to reach them?'),
    jsonb_build_object('id', 'o7', 'key', 'timeline', 'text', 'Is there a date or event this work needs to be ready for?'),
    jsonb_build_object('id', 'o8', 'key', 'anything', 'text', 'Is there anything else we should know before we start?')
  )),
  (null, 'saas', 'SaaS customer onboarding', 'onboarding', jsonb_build_array(
    jsonb_build_object('id', 'o1', 'key', 'about',    'text', 'Welcome! In a few sentences, what does your team do and what do you want to use {{workspace}} for?'),
    jsonb_build_object('id', 'o2', 'key', 'goals',    'text', 'What would a great first month with {{workspace}} look like for you?'),
    jsonb_build_object('id', 'o3', 'key', 'success',  'text', 'What are you using today for this, and what is not working?'),
    jsonb_build_object('id', 'o4', 'key', 'short',    'text', 'Who on your team will use it, and who should we contact with questions?'),
    jsonb_build_object('id', 'o5', 'key', 'short',    'text', 'Which other tools should it work with?'),
    jsonb_build_object('id', 'o6', 'key', 'anything', 'text', 'Is there anything else we should know before you start?')
  ));

-- ---------------------------------------------------------------------------
-- create_onboarding_request
-- ---------------------------------------------------------------------------

create function public.create_onboarding_request(
  ws uuid,
  client uuid,
  client_name text,
  client_email text,
  questions jsonb,
  hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  ws_plan text;
  ws_type text;
  new_id uuid;
  used int;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if questions is null or jsonb_typeof(questions) <> 'array' or jsonb_array_length(questions) not between 1 and 12 then
    raise exception 'Invalid questions' using errcode = '22023';
  end if;
  if client is not null and not exists (select 1 from public.clients c where c.id = client and c.workspace_id = ws) then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  select w.plan, w.type into ws_plan, ws_type from public.workspaces w where w.id = ws;

  -- Onboarding links count against the same monthly interview cap as review links.
  insert into public.usage_counters as u (workspace_id, period, interviews)
  values (ws, date_trunc('month', now())::date, 1)
  on conflict (workspace_id, period) do update
    set interviews = u.interviews + 1
    where u.interviews < public.plan_interview_limit(ws_plan)
  returning u.interviews into used;
  if used is null then
    raise exception 'Monthly interview limit reached' using errcode = '54000';
  end if;

  insert into public.proof_requests (
    workspace_id, created_by, client_name, client_email, flow_type, token_hash, expires_at, status,
    purpose, client_id, questions_snapshot
  ) values (
    ws, caller, btrim(client_name), btrim(client_email), case when ws_type = 'saas' then 'saas' else 'agency' end, hash,
    now() + interval '30 days', 'draft', 'onboarding', client, questions
  )
  returning id into new_id;

  perform public.audit(ws, 'request.create', new_id::text);
  return new_id;
end
$$;
revoke all on function public.create_onboarding_request(uuid, uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.create_onboarding_request(uuid, uuid, text, text, jsonb, text) to authenticated;
