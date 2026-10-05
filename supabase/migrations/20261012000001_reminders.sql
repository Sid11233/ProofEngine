-- Phase 7.4: automatic client reminders, "do not contact", and the per-workspace sending limit.
--
--   * proof_requests.sent_at: when the request was first sent (reminders are timed from it).
--   * proof_requests.do_not_contact_at: set when the client uses the unsubscribe link. Nothing emails the
--     client again: automatic reminders skip the request and rotate_request_token refuses send/remind.
--   * auto_remind_candidates / auto_remind_request / auto_remind_revert / mark_do_not_contact are
--     service-role only (the cron endpoint and the unsubscribe page call them).
--   Rules enforced in the database, so a bug in the job cannot break them: status 'sent' (not started, not
--   completed), not revoked, not expired, not do-not-contact, at most 2 automatic reminders, the first
--   from day 3 and the second from day 7 after sending, 48 hours apart, and at most 25 automatic
--   reminders per workspace per 24 hours.
--
-- Rollback (dev only): drop the four functions, restore rotate_request_token from migration 20261004000006,
-- recreate proof_requests_safe without the new columns, drop columns sent_at and do_not_contact_at.

alter table public.proof_requests add column sent_at timestamptz, add column do_not_contact_at timestamptz;
update public.proof_requests set sent_at = created_at where status in ('sent', 'started', 'completed') and sent_at is null;
grant select (sent_at, do_not_contact_at) on public.proof_requests to authenticated;

create or replace view public.proof_requests_safe
with (security_invoker = true) as
select
  id, workspace_id, created_by, client_name, client_email, project_type, flow_type,
  focus_outcomes, tone, expires_at, revoked_at, status, created_at,
  reminder_count, last_reminder_at, sent_at, do_not_contact_at
from public.proof_requests;

-- Manual sending respects "do not contact" too, and remembers when the request was first sent.
create or replace function public.rotate_request_token(request_id uuid, new_hash text, purpose text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
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
  if purpose in ('send', 'remind') and req.do_not_contact_at is not null then
    raise exception 'The client asked not to be contacted' using errcode = '22023';
  end if;

  if purpose = 'send' then
    if req.status not in ('draft', 'sent') then
      raise exception 'Request cannot be sent in its current state' using errcode = '22023';
    end if;
    update public.proof_requests
      set token_hash = new_hash, expires_at = new_expiry, revoked_at = null, status = 'sent',
          sent_at = coalesce(sent_at, now())
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

-- Is this request due an automatic reminder right now? One definition, used by the list and the sender.
create function public.reminder_due(req public.proof_requests)
returns boolean
language sql
stable
set search_path = ''
as $$
  select req.status = 'sent'
    and req.revoked_at is null
    and req.expires_at > now()
    and req.do_not_contact_at is null
    and req.sent_at is not null
    and req.reminder_count < 2
    and (req.last_reminder_at is null or req.last_reminder_at <= now() - interval '48 hours')
    and req.sent_at <= now() - case req.reminder_count when 0 then interval '3 days' else interval '7 days' end
$$;

create function public.workspace_reminders_today(ws uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.audit_log a
  where a.workspace_id = ws and a.action = 'request.auto_remind' and a.created_at > now() - interval '24 hours'
$$;

-- Requests due a reminder, oldest first, skipping workspaces that already hit their daily limit.
create function public.auto_remind_candidates(batch int)
returns table (request_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.proof_requests r
  where public.reminder_due(r) and public.workspace_reminders_today(r.workspace_id) < 25
  order by r.sent_at
  limit least(greatest(batch, 1), 100)
$$;

-- Re-checks every rule under a row lock, then rotates the link and counts the reminder. false = not due.
create function public.auto_remind_request(request_id uuid, new_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.proof_requests;
begin
  select * into req from public.proof_requests where id = request_id for update;
  if req.id is null or not public.reminder_due(req) or public.workspace_reminders_today(req.workspace_id) >= 25 then
    return false;
  end if;
  update public.proof_requests
    set token_hash = new_hash, expires_at = now() + interval '30 days',
        reminder_count = req.reminder_count + 1, last_reminder_at = now()
    where id = req.id;
  perform public.audit(req.workspace_id, 'request.auto_remind', req.id::text);
  return true;
end
$$;

-- The email could not be sent: give the reminder back so the next run tries again with a fresh link.
create function public.auto_remind_revert(request_id uuid, previous_last timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.proof_requests
    set reminder_count = greatest(reminder_count - 1, 0), last_reminder_at = previous_last
    where id = request_id and reminder_count > 0 and status = 'sent';
$$;

-- The client used the unsubscribe link. Idempotent.
create function public.mark_do_not_contact(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.proof_requests;
begin
  select * into req from public.proof_requests where id = request_id for update;
  if req.id is null then
    return false;
  end if;
  if req.do_not_contact_at is null then
    update public.proof_requests set do_not_contact_at = now() where id = req.id;
    perform public.audit(req.workspace_id, 'request.do_not_contact', req.id::text);
  end if;
  return true;
end
$$;

revoke all on function public.reminder_due(public.proof_requests) from public, anon, authenticated;
revoke all on function public.workspace_reminders_today(uuid) from public, anon, authenticated;
revoke all on function public.auto_remind_candidates(int) from public, anon, authenticated;
revoke all on function public.auto_remind_request(uuid, text) from public, anon, authenticated;
revoke all on function public.auto_remind_revert(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_do_not_contact(uuid) from public, anon, authenticated;
grant execute on function public.auto_remind_candidates(int) to service_role;
grant execute on function public.auto_remind_request(uuid, text) to service_role;
grant execute on function public.auto_remind_revert(uuid, timestamptz) to service_role;
grant execute on function public.mark_do_not_contact(uuid) to service_role;
grant execute on function public.reminder_due(public.proof_requests) to service_role;
grant execute on function public.workspace_reminders_today(uuid) to service_role;
