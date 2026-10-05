-- Phase 8: billing state that cannot be faked from the browser.
--
--   * workspaces.plan and public.subscriptions are written ONLY by apply_billing_state() /
--     apply_invoice_state() / expire_billing_grace(), which are service-role only and are called by the
--     signature-verified Stripe webhook (and the daily cron). Clients have no write path at all.
--   * The access rules live here, not in app code: active and trialing give the plan; past_due keeps it for
--     7 days from the first failure; everything else (canceled, unpaid, incomplete, paused) is free.
--   * stripe_events makes webhook handling idempotent: an event id is claimed once; a failed handler releases
--     the claim so Stripe's retry is processed.
--   * link_stripe_customer() stores a workspace's Stripe customer once; a second, different customer for the
--     same workspace is refused, and so is one customer shared by two workspaces.
--
-- Rollback (dev only): drop the functions below, drop table public.stripe_events, drop columns
-- subscriptions.past_due_since and subscriptions.cancel_at_period_end.

alter table public.subscriptions
  add column past_due_since timestamptz,
  add column cancel_at_period_end boolean not null default false;
grant select (past_due_since, cancel_at_period_end) on public.subscriptions to authenticated;

create table public.stripe_events (
  id            text primary key check (char_length(id) between 1 and 255),
  type          text not null check (char_length(type) <= 100),
  processed_at  timestamptz not null default now()
);

-- RLS on and deliberately no policy and no grant: nobody but the service role can touch this table.
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- Claim an event id. true = first time (go ahead and process), false = already handled (skip).
create function public.claim_stripe_event(event_id text, event_type text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with ins as (
    insert into public.stripe_events (id, type) values (event_id, left(event_type, 100))
    on conflict (id) do nothing
    returning 1
  )
  select exists (select 1 from ins)
$$;

create function public.release_stripe_event(event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.stripe_events where id = event_id
$$;

-- The one place a workspace gets its Stripe customer. Returns the customer now on file.
create function public.link_stripe_customer(ws uuid, customer text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing text;
begin
  if customer is null or customer !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'Invalid customer' using errcode = '22023';
  end if;
  if exists (select 1 from public.subscriptions s where s.stripe_customer_id = customer and s.workspace_id <> ws) then
    raise exception 'Customer belongs to another workspace' using errcode = '22023';
  end if;
  insert into public.subscriptions (workspace_id, stripe_customer_id) values (ws, customer)
  on conflict (workspace_id) do update
    set stripe_customer_id = coalesce(public.subscriptions.stripe_customer_id, excluded.stripe_customer_id);
  select s.stripe_customer_id into existing from public.subscriptions s where s.workspace_id = ws;
  return existing;
end
$$;

-- What a Stripe status means for access. The single definition of the rules.
create function public.billing_effective_plan(paid_plan text, sub_status text, since timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when sub_status in ('active', 'trialing') then paid_plan
    when sub_status = 'past_due' and since is not null and since > now() - interval '7 days' then paid_plan
    else 'free'
  end
$$;

-- Apply one subscription's state. ws may be null: the workspace is then found through the customer.
-- Raises P0002 when no workspace can be found and 22023 when the customer does not match the workspace.
create function public.apply_billing_state(
  ws uuid, customer text, subscription text, paid_plan text, sub_status text, period_end timestamptz, cancels_at_end boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := ws;
  on_file text;
  since timestamptz;
  effective text;
begin
  if paid_plan not in ('pro', 'team') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if target is null then
    select s.workspace_id into target from public.subscriptions s where s.stripe_customer_id = customer;
  end if;
  if target is null or not exists (select 1 from public.workspaces w where w.id = target) then
    raise exception 'No workspace for this subscription' using errcode = 'P0002';
  end if;

  -- The customer must be the workspace's customer (linked on first sight; never replaced).
  on_file := public.link_stripe_customer(target, customer);
  if on_file is distinct from customer then
    raise exception 'Customer does not match the workspace' using errcode = '22023';
  end if;

  select s.past_due_since into since from public.subscriptions s where s.workspace_id = target for update;
  if sub_status = 'past_due' then
    since := coalesce(since, now());
  elsif sub_status in ('active', 'trialing') then
    since := null;
  end if;
  effective := public.billing_effective_plan(paid_plan, sub_status, since);

  update public.subscriptions
    set stripe_subscription_id = subscription, plan = effective, status = sub_status,
        current_period_end = period_end, past_due_since = since, cancel_at_period_end = coalesce(cancels_at_end, false)
    where workspace_id = target;
  update public.workspaces set plan = effective where id = target and plan is distinct from effective;
  perform public.audit(target, 'billing.' || sub_status, effective);
  return effective;
end
$$;

-- invoice.payment_failed / invoice.paid: start or clear the 7 day grace period. Plan changes only via
-- the subscription events and the grace expiry below.
create function public.apply_invoice_state(customer text, paid boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  select s.workspace_id into target from public.subscriptions s where s.stripe_customer_id = customer for update;
  if target is null then
    return false;
  end if;
  if paid then
    update public.subscriptions
      set past_due_since = null, status = case when status = 'past_due' then 'active' else status end
      where workspace_id = target;
    update public.workspaces w set plan = s.plan from public.subscriptions s
      where s.workspace_id = target and w.id = target and s.status in ('active', 'trialing') and w.plan is distinct from s.plan;
  else
    update public.subscriptions set past_due_since = coalesce(past_due_since, now()) where workspace_id = target;
  end if;
  perform public.audit(target, case when paid then 'billing.invoice_paid' else 'billing.payment_failed' end, null);
  return true;
end
$$;

-- Daily: end grace periods that ran out. Returns how many workspaces dropped to free.
create function public.expire_billing_grace()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  r record;
begin
  for r in
    select s.workspace_id from public.subscriptions s
    where s.status = 'past_due' and s.past_due_since is not null and s.past_due_since <= now() - interval '7 days'
      and s.plan <> 'free'
    for update
  loop
    update public.subscriptions set plan = 'free' where workspace_id = r.workspace_id;
    update public.workspaces set plan = 'free' where id = r.workspace_id;
    perform public.audit(r.workspace_id, 'billing.grace_expired', 'free');
    n := n + 1;
  end loop;
  return n;
end
$$;

revoke all on function public.claim_stripe_event(text, text) from public, anon, authenticated;
revoke all on function public.release_stripe_event(text) from public, anon, authenticated;
revoke all on function public.link_stripe_customer(uuid, text) from public, anon, authenticated;
revoke all on function public.billing_effective_plan(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.apply_invoice_state(text, boolean) from public, anon, authenticated;
revoke all on function public.expire_billing_grace() from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text, text) to service_role;
grant execute on function public.release_stripe_event(text) to service_role;
grant execute on function public.link_stripe_customer(uuid, text) to service_role;
grant execute on function public.billing_effective_plan(text, text, timestamptz) to service_role;
grant execute on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.apply_invoice_state(text, boolean) to service_role;
grant execute on function public.expire_billing_grace() to service_role;
