-- Phase 3.5-3.6: private upload buckets, capped upload recording, and the global daily
-- AI spend tracker behind the circuit breaker.
--
-- Rollback (dev only):
--   drop function if exists public.record_upload(uuid, uuid, text, text, int), public.check_ai_breaker(bigint);
--   drop table if exists public.ai_daily_usage;
--   delete from storage.buckets where id in ('uploads', 'exports');
--   (then restore record_bot_message from migration 20261005000001)

-- ---------------------------------------------------------------------------
-- Private buckets. No public bucket is allowed in V1, and no storage policies are
-- created: with RLS on storage.objects and no policy, only the service role can touch
-- files. Users receive short-lived signed URLs from the server. The block is skipped
-- where the storage schema is not installed (a bare local Postgres).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
      ('uploads', 'uploads', false, 2097152, array['image/webp']),
      ('exports', 'exports', false, 10485760, array['application/pdf', 'image/png'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- record_upload: at most 4 files per interview, logo and headshot only
-- ---------------------------------------------------------------------------

create function public.record_upload(intr uuid, ws uuid, path text, upload_kind text, size int)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
  new_id uuid;
begin
  if upload_kind is null or upload_kind not in ('logo', 'headshot') then
    raise exception 'Invalid kind' using errcode = '22023';
  end if;
  if size is null or size < 1 or size > 2097152 then
    raise exception 'Invalid size' using errcode = '22023';
  end if;
  -- The object must live under this workspace and interview.
  if path is null or path !~ ('^' || ws::text || '/' || intr::text || '/[0-9a-f-]{36}\.webp$') then
    raise exception 'Invalid path' using errcode = '22023';
  end if;

  select * into i from public.interviews where id = intr and workspace_id = ws for update;
  if i.id is null or i.status <> 'started' then
    raise exception 'Interview is not open' using errcode = 'P0002';
  end if;
  if (select count(*) from public.interview_uploads u where u.interview_id = intr) >= 4 then
    raise exception 'Upload limit reached' using errcode = '54000';
  end if;

  insert into public.interview_uploads (interview_id, workspace_id, file_path, kind, size_bytes)
  values (intr, ws, path, upload_kind, size)
  returning id into new_id;
  return new_id;
end
$$;

-- ---------------------------------------------------------------------------
-- ai_daily_usage: total AI tokens per UTC day, across all workspaces
-- ---------------------------------------------------------------------------

create table public.ai_daily_usage (
  day      date primary key,
  tokens   bigint not null default 0 check (tokens >= 0),
  -- True once the breaker alert for that day has been sent, so it fires once.
  alerted  boolean not null default false
);

alter table public.ai_daily_usage enable row level security;

-- Deliberately no policy and no grant: this is platform-wide operational data that only the
-- server (service role) reads and writes. Clients, including signed-in workspace owners, see nothing.
comment on table public.ai_daily_usage is
  'Platform-wide AI token totals per UTC day. RLS on with no policies: service role only.';

revoke all on public.ai_daily_usage from anon, authenticated;

-- Reply recorder, now also feeding the daily total.
create or replace function public.record_bot_message(
  intr uuid, ws uuid, body text, kind text, tokens int default 0, ai_used boolean default false
)
returns table (question_index int, probe_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i public.interviews;
  used int := greatest(coalesce(tokens, 0), 0);
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
        tokens_used = tokens_used + used,
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
  if used > 0 then
    insert into public.ai_daily_usage as d (day, tokens)
    values ((now() at time zone 'utc')::date, used)
    on conflict (day) do update set tokens = d.tokens + excluded.tokens;
  end if;

  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- check_ai_breaker: has today's total passed the limit, and is this the first time?
-- ---------------------------------------------------------------------------

create function public.check_ai_breaker(token_limit bigint)
returns table (tripped boolean, newly_tripped boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today date := (now() at time zone 'utc')::date;
  row_ public.ai_daily_usage;
begin
  select * into row_ from public.ai_daily_usage where day = today for update;
  if row_.day is null or token_limit is null or row_.tokens < token_limit then
    return query select false, false;
    return;
  end if;
  if row_.alerted then
    return query select true, false;
    return;
  end if;
  update public.ai_daily_usage set alerted = true where day = today;
  return query select true, true;
end
$$;

revoke all on function public.record_upload(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.check_ai_breaker(bigint) from public, anon, authenticated;
grant execute on function public.record_upload(uuid, uuid, text, text, int) to service_role;
grant execute on function public.check_ai_breaker(bigint) to service_role;
grant select, insert, update on public.ai_daily_usage to service_role;
