-- Phase 3.1: proof request lifecycle (create, send, remind, revoke, regenerate)
-- and the system question flows.
--
-- As with team management, every state change goes through a SECURITY DEFINER
-- function that checks the caller's role, enforces plan limits and writes the
-- audit_log entry in the same transaction. Direct insert, and direct updates to
-- status, revoked_at and token_hash, are revoked from the API roles.
--
-- Rollback (dev only):
--   drop function if exists public.create_proof_request(uuid, text, text, text, text, text[], text, text),
--     public.rotate_request_token(uuid, text, text), public.revoke_request(uuid), public.plan_interview_limit(text);
--   delete from public.question_flows where workspace_id is null;
--   alter table public.proof_requests drop column reminder_count, drop column last_reminder_at;
--   (then restore the direct insert policy and grants from migration 2)

alter table public.proof_requests
  add column reminder_count   int not null default 0 check (reminder_count between 0 and 3),
  add column last_reminder_at timestamptz;

-- Column-level select grants do not cover new columns automatically.
grant select (reminder_count, last_reminder_at) on public.proof_requests to authenticated;
create or replace view public.proof_requests_safe
with (security_invoker = true) as
select
  id, workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, expires_at, revoked_at, status, created_at,
  reminder_count, last_reminder_at
from public.proof_requests;

drop policy proof_requests_insert_editor on public.proof_requests;
revoke insert on public.proof_requests from authenticated;
-- Descriptive fields stay editable; lifecycle fields do not.
revoke update on public.proof_requests from authenticated;
grant update (client_name, client_email, project_type, focus_outcomes, tone)
  on public.proof_requests to authenticated;

-- Placeholder limits until plans are decided (Phase 8): interviews per calendar month.
create function public.plan_interview_limit(plan text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case plan when 'free' then 3 when 'pro' then 100 when 'team' then 1000 else 0 end
$$;

-- ---------------------------------------------------------------------------
-- create_proof_request
-- ---------------------------------------------------------------------------

create function public.create_proof_request(
  ws uuid,
  client_name text,
  client_email text,
  project_type text,
  flow_type text,
  focus_outcomes text[],
  tone text,
  hash text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := (select auth.uid());
  ws_plan text;
  new_id uuid;
  used int;
begin
  if caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if flow_type is null or flow_type not in ('agency', 'saas') then
    raise exception 'Invalid flow type' using errcode = '22023';
  end if;

  select w.plan into ws_plan from public.workspaces w where w.id = ws;

  -- Atomic monthly cap: the counter only moves while it is below the plan limit.
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
    workspace_id, created_by, client_name, client_email, project_type, flow_type,
    focus_outcomes, tone, token_hash, expires_at, status
  ) values (
    ws, caller, btrim(client_name), btrim(client_email), project_type, flow_type,
    coalesce(focus_outcomes, '{}'), tone, hash, now() + interval '30 days', 'draft'
  )
  returning id into new_id;

  perform public.audit(ws, 'request.create', new_id::text);
  return new_id;
end
$$;
revoke all on function public.create_proof_request(uuid, text, text, text, text, text[], text, text) from public, anon;
grant execute on function public.create_proof_request(uuid, text, text, text, text, text[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- rotate_request_token: send, remind and regenerate
-- ---------------------------------------------------------------------------

-- The raw token is never stored, so every email that carries a link needs a fresh
-- token. Rotating invalidates the previous link immediately.
--   send        draft or sent        -> status sent
--   remind      sent only, max 3, at least 48 hours apart
--   regenerate  anything not completed; revives revoked and expired requests
create function public.rotate_request_token(request_id uuid, new_hash text, purpose text)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req public.proof_requests;
  new_expiry timestamptz := now() + interval '30 days';
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if purpose is null or purpose not in ('send', 'remind', 'regenerate') then
    raise exception 'Invalid purpose' using errcode = '22023';
  end if;

  select * into req from public.proof_requests where id = request_id for update;
  if req.id is null or not public.is_member(req.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if req.status = 'completed' then
    raise exception 'Interview already completed' using errcode = '22023';
  end if;

  if purpose = 'send' then
    if req.status not in ('draft', 'sent') then
      raise exception 'Request cannot be sent in its current state' using errcode = '22023';
    end if;
    update public.proof_requests
      set token_hash = new_hash, expires_at = new_expiry, revoked_at = null, status = 'sent'
      where id = req.id;
    perform public.audit(req.workspace_id, 'request.send', req.id::text);

  elsif purpose = 'remind' then
    if req.status <> 'sent' or req.revoked_at is not null or req.expires_at <= now() then
      raise exception 'Reminders only go to active, unanswered requests' using errcode = '22023';
    end if;
    if req.reminder_count >= 3 then
      raise exception 'Reminder limit reached' using errcode = '54000';
    end if;
    if req.last_reminder_at is not null and req.last_reminder_at > now() - interval '48 hours' then
      raise exception 'Reminders must be at least 48 hours apart' using errcode = '54000';
    end if;
    update public.proof_requests
      set token_hash = new_hash, expires_at = new_expiry,
          reminder_count = req.reminder_count + 1, last_reminder_at = now()
      where id = req.id;
    perform public.audit(req.workspace_id, 'request.remind', req.id::text);

  else
    update public.proof_requests
      set token_hash = new_hash, expires_at = new_expiry, revoked_at = null,
          status = case when req.status in ('revoked', 'expired') then 'draft' else req.status end
      where id = req.id;
    perform public.audit(req.workspace_id, 'token.regenerate', req.id::text);
  end if;

  return new_expiry;
end
$$;
revoke all on function public.rotate_request_token(uuid, text, text) from public, anon;
grant execute on function public.rotate_request_token(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_request
-- ---------------------------------------------------------------------------

create function public.revoke_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req public.proof_requests;
begin
  select * into req from public.proof_requests where id = request_id for update;
  if req.id is null or not public.is_member(req.workspace_id, 'editor') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if req.status = 'completed' then
    raise exception 'Interview already completed' using errcode = '22023';
  end if;
  update public.proof_requests set revoked_at = now(), status = 'revoked' where id = req.id;
  perform public.audit(req.workspace_id, 'token.revoke', req.id::text);
end
$$;
revoke all on function public.revoke_request(uuid) from public, anon;
grant execute on function public.revoke_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- System question flows (workspace_id is null)
-- ---------------------------------------------------------------------------

-- {{workspace}} is replaced with the workspace's display name when served.
insert into public.question_flows (workspace_id, type, name, questions) values
  (null, 'agency', 'Agency client story', jsonb_build_array(
    jsonb_build_object('id', 'q1', 'key', 'challenge', 'text', 'Before you worked with {{workspace}}, what problem or goal were you trying to deal with?'),
    jsonb_build_object('id', 'q2', 'key', 'trigger',   'text', 'What made you decide to get help at that moment?'),
    jsonb_build_object('id', 'q3', 'key', 'solution',  'text', 'In your own words, what did {{workspace}} do for you?'),
    jsonb_build_object('id', 'q4', 'key', 'results',   'text', 'What has changed since? Please share any numbers you are comfortable with, such as time saved, revenue or leads.'),
    jsonb_build_object('id', 'q5', 'key', 'quote',     'text', 'How would you describe working with {{workspace}} to a colleague?'),
    jsonb_build_object('id', 'q6', 'key', 'audience',  'text', 'Who do you think would benefit most from working with {{workspace}}, and why?')
  )),
  (null, 'saas', 'SaaS customer story', jsonb_build_array(
    jsonb_build_object('id', 'q1', 'key', 'challenge', 'text', 'What problem were you trying to solve before you found {{workspace}}?'),
    jsonb_build_object('id', 'q2', 'key', 'trigger',   'text', 'What were you using before, and what made you look for something new?'),
    jsonb_build_object('id', 'q3', 'key', 'solution',  'text', 'What made you choose {{workspace}}, and how did getting started go?'),
    jsonb_build_object('id', 'q4', 'key', 'results',   'text', 'What changed after you started using it? Please include numbers if you can, such as time saved or growth.'),
    jsonb_build_object('id', 'q5', 'key', 'quote',     'text', 'What is the one thing you would tell someone who is considering {{workspace}}?'),
    jsonb_build_object('id', 'q6', 'key', 'audience',  'text', 'Who do you think gets the most value from {{workspace}}?')
  ));
