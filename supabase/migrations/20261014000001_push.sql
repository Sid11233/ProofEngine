-- Phase 9.3: web push subscriptions and per-event notification preferences.
--
--   * push_subscriptions: one row per user and browser endpoint, tied to the user's membership of the
--     workspace (a composite foreign key: leaving the workspace removes the subscription). A user can see
--     and delete only their own rows. Rows are written by save_push_subscription(), which checks
--     membership, the endpoint's shape and a cap of 10 per user. The sender (service role) removes
--     subscriptions the push service reports gone (404/410).
--   * notification_preferences: per user and workspace, one switch per event. Written only by
--     save_notification_preferences(). Everything is off until the user turns it on.
--   * The server-side sender uses push_targets() (service role only): the subscriptions of members who
--     switched that event on. Payloads are generic; nothing about a client or a transcript is stored or sent.
--
-- Rollback (dev only): drop the functions below, drop tables notification_preferences and push_subscriptions.

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  workspace_id  uuid not null,
  endpoint      text not null check (char_length(endpoint) between 20 and 500 and endpoint ~ '^https://[^\s]+$'),
  p256dh        text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth          text not null check (auth ~ '^[A-Za-z0-9_-]{20,30}$'),
  created_at    timestamptz not null default now(),
  unique (user_id, endpoint),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);

create index push_subscriptions_workspace_idx on public.push_subscriptions (workspace_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));
comment on policy push_subscriptions_select_own on public.push_subscriptions is
  'A user sees only their own push subscriptions (never a teammate''s). Rows are created by save_push_subscription().';

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));
comment on policy push_subscriptions_delete_own on public.push_subscriptions is
  'A user can remove their own subscriptions (turn notifications off, sign out).';

revoke all on public.push_subscriptions from anon, authenticated;
-- The keys (p256dh, auth) are secrets of the subscription: the browser has them, the user never needs them back.
grant select (id, user_id, workspace_id, endpoint, created_at) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

create table public.notification_preferences (
  user_id             uuid not null references auth.users (id) on delete cascade,
  workspace_id        uuid not null,
  client_completed    boolean not null default false,
  approval_received   boolean not null default false,
  referral_received   boolean not null default false,
  updated_at          timestamptz not null default now(),
  primary key (user_id, workspace_id),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);

alter table public.notification_preferences enable row level security;

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));
comment on policy notification_preferences_select_own on public.notification_preferences is
  'A user reads only their own preferences. Writes go through save_notification_preferences().';

revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;

create function public.save_push_subscription(ws uuid, push_endpoint text, push_p256dh text, push_auth text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  new_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'viewer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if (select count(*) from public.push_subscriptions p where p.user_id = me and p.endpoint <> push_endpoint) >= 10 then
    raise exception 'Too many devices' using errcode = '54000';
  end if;
  insert into public.push_subscriptions (user_id, workspace_id, endpoint, p256dh, auth)
  values (me, ws, push_endpoint, push_p256dh, push_auth)
  on conflict (user_id, endpoint) do update
    set workspace_id = excluded.workspace_id, p256dh = excluded.p256dh, auth = excluded.auth
  returning id into new_id;
  return new_id;
end
$$;

create function public.save_notification_preferences(ws uuid, on_client_completed boolean, on_approval_received boolean, on_referral_received boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(ws, 'viewer') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, workspace_id, client_completed, approval_received, referral_received, updated_at)
  values (me, ws, coalesce(on_client_completed, false), coalesce(on_approval_received, false), coalesce(on_referral_received, false), now())
  on conflict (user_id, workspace_id) do update
    set client_completed = excluded.client_completed, approval_received = excluded.approval_received,
        referral_received = excluded.referral_received, updated_at = now();
end
$$;

-- Server only: who should be told about this event in this workspace.
create function public.push_targets(ws uuid, event text)
returns table (id uuid, endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  join public.notification_preferences p on p.user_id = s.user_id and p.workspace_id = s.workspace_id
  where s.workspace_id = ws
    and case event
          when 'client_completed' then p.client_completed
          when 'approval_received' then p.approval_received
          when 'referral_received' then p.referral_received
          else false
        end
$$;

-- Server only: the push service said the subscription no longer exists.
create function public.remove_push_subscription(sub uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where id = sub
$$;

revoke all on function public.save_push_subscription(uuid, text, text, text) from public, anon;
revoke all on function public.save_notification_preferences(uuid, boolean, boolean, boolean) from public, anon;
revoke all on function public.push_targets(uuid, text) from public, anon, authenticated;
revoke all on function public.remove_push_subscription(uuid) from public, anon, authenticated;
grant execute on function public.save_push_subscription(uuid, text, text, text) to authenticated;
grant execute on function public.save_notification_preferences(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.push_targets(uuid, text) to service_role;
grant execute on function public.remove_push_subscription(uuid) to service_role;
