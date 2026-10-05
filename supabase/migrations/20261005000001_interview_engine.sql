-- Phase 3.3-3.4: interview state machine.
--
-- Interview rows, transcripts and counters are written only by the server (service
-- role) through these functions, which run the caps and the state transitions
-- atomically under a row lock. They are NOT callable by anon or authenticated:
-- the client never talks to them, only the token-authenticated interview endpoints do.
--
-- Rollback (dev only):
--   drop function if exists public.start_interview(uuid, uuid, text),
--     public.record_client_message(uuid, uuid, text, int, int, int),
--     public.record_bot_message(uuid, uuid, text, text, int, boolean),
--     public.finish_interview(uuid, uuid, text, int);
--   alter table public.interviews drop column question_index, drop column probe_count,
--     drop column tokens_used, drop column awaiting_since, drop column publish_permission;

alter table public.interviews
  add column question_index     int not null default 0 check (question_index >= 0),
  add column probe_count        int not null default 0 check (probe_count between 0 and 2),
  add column tokens_used        int not null default 0 check (tokens_used >= 0),
  -- Set while a reply is being produced, so two concurrent answers cannot both advance the interview.
  add column awaiting_since     timestamptz,
  add column publish_permission text check (publish_permission in ('full', 'first_name', 'anonymous'));

-- ---------------------------------------------------------------------------
-- start_interview: idempotent; records consent and opens the request
-- ---------------------------------------------------------------------------

create function public.start_interview(req uuid, ws uuid, consent_version text)
returns table (interview_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing uuid;
  new_id uuid;
begin
  if consent_version is null or char_length(consent_version) not between 1 and 50 then
    raise exception 'Consent version required' using errcode = '22023';
  end if;

  perform 1 from public.proof_requests
    where id = req and workspace_id = ws and revoked_at is null and expires_at > now()
      and status in ('draft', 'sent', 'started')
    for update;
  if not found then
    raise exception 'Request is not open' using errcode = 'P0002';
  end if;

  select i.id into existing from public.interviews i where i.request_id = req and i.workspace_id = ws
    order by i.started_at desc limit 1;
  if existing is not null then
    return query select existing, false;
    return;
  end if;

  insert into public.interviews (request_id, workspace_id, status, consent_given, consent_text_version)
  values (req, ws, 'started', true, consent_version)
  returning id into new_id;

  update public.proof_requests set status = 'started' where id = req;
  perform public.audit(ws, 'interview.start', req::text);
  return query select new_id, true;
end
$$;

-- ---------------------------------------------------------------------------
-- record_client_message: saves an answer, enforcing the per-interview caps
-- ---------------------------------------------------------------------------

-- Returns the state the reply must be built from, read under the lock.
-- Errors: P0002 unknown/closed interview, 54000 message or token cap reached,
--         55006 a reply is already being produced, 22023 interview already answered in full.
create function public.record_client_message(
  intr uuid, ws uuid, body text, total_questions int default 6, max_messages int default 40, max_tokens int default 100000
)
returns table (message_id uuid, question_index int, probe_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
  new_id uuid;
begin
  if body is null or char_length(btrim(body)) = 0 or char_length(body) > 1000 then
    raise exception 'Invalid message' using errcode = '22023';
  end if;

  select * into i from public.interviews where id = intr and workspace_id = ws for update;
  if i.id is null or i.status <> 'started' or not i.consent_given then
    raise exception 'Interview is not open' using errcode = 'P0002';
  end if;
  if i.question_index >= total_questions then
    raise exception 'Interview already answered in full' using errcode = '22023';
  end if;
  if i.message_count >= max_messages or i.tokens_used >= max_tokens then
    raise exception 'Interview limit reached' using errcode = '54000';
  end if;
  -- A stale flag (a crashed request) is ignored after a minute.
  if i.awaiting_since is not null and i.awaiting_since > now() - interval '60 seconds' then
    raise exception 'A reply is already being produced' using errcode = '55006';
  end if;

  insert into public.interview_messages (interview_id, workspace_id, role, content)
  values (intr, ws, 'client', body)
  returning id into new_id;

  update public.interviews set message_count = message_count + 1, awaiting_since = now() where id = intr;
  return query select new_id, i.question_index, i.probe_count;
end
$$;

-- ---------------------------------------------------------------------------
-- record_bot_message: saves the reply and moves the interview along
-- ---------------------------------------------------------------------------

--   kind 'intro'   first question, no state change
--   kind 'probe'   follow-up on the same question (probe_count + 1)
--   kind 'advance' moves to the next question (question_index + 1, probes reset)
create function public.record_bot_message(
  intr uuid, ws uuid, body text, kind text, tokens int default 0, ai_used boolean default false
)
returns table (question_index int, probe_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
begin
  if kind is null or kind not in ('intro', 'probe', 'advance') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if body is null or char_length(body) not between 1 and 4000 then
    raise exception 'Invalid message' using errcode = '22023';
  end if;

  select * into i from public.interviews where id = intr and workspace_id = ws for update;
  if i.id is null or i.status <> 'started' then
    raise exception 'Interview is not open' using errcode = 'P0002';
  end if;

  insert into public.interview_messages (interview_id, workspace_id, role, content)
  values (intr, ws, 'bot', body);

  update public.interviews
    set message_count = message_count + 1,
        tokens_used = tokens_used + greatest(coalesce(tokens, 0), 0),
        awaiting_since = null,
        question_index = case when kind = 'advance' then public.interviews.question_index + 1 else public.interviews.question_index end,
        probe_count = case when kind = 'advance' then 0 when kind = 'probe' then public.interviews.probe_count + 1 else public.interviews.probe_count end
    where id = intr
    returning public.interviews.question_index, public.interviews.probe_count into question_index, probe_count;

  if ai_used then
    insert into public.usage_counters as u (workspace_id, period, ai_messages)
    values (ws, date_trunc('month', now())::date, 1)
    on conflict (workspace_id, period) do update set ai_messages = u.ai_messages + 1;
  end if;

  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- finish_interview
-- ---------------------------------------------------------------------------

create function public.finish_interview(intr uuid, ws uuid, permission text, total_questions int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
begin
  if permission is null or permission not in ('full', 'first_name', 'anonymous') then
    raise exception 'Invalid permission' using errcode = '22023';
  end if;

  select * into i from public.interviews where id = intr and workspace_id = ws for update;
  if i.id is null or i.status <> 'started' then
    raise exception 'Interview is not open' using errcode = 'P0002';
  end if;
  if i.question_index < total_questions then
    raise exception 'Interview is not finished' using errcode = '22023';
  end if;

  update public.interviews
    set status = 'completed', completed_at = now(), publish_permission = permission, awaiting_since = null
    where id = intr;
  update public.proof_requests set status = 'completed' where id = i.request_id and workspace_id = ws;
  perform public.audit(ws, 'interview.complete', i.request_id::text);
end
$$;

-- Server only.
revoke all on function public.start_interview(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_client_message(uuid, uuid, text, int, int, int) from public, anon, authenticated;
revoke all on function public.record_bot_message(uuid, uuid, text, text, int, boolean) from public, anon, authenticated;
revoke all on function public.finish_interview(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_interview(uuid, uuid, text) to service_role;
grant execute on function public.record_client_message(uuid, uuid, text, int, int, int) to service_role;
grant execute on function public.record_bot_message(uuid, uuid, text, text, int, boolean) to service_role;
grant execute on function public.finish_interview(uuid, uuid, text, int) to service_role;
