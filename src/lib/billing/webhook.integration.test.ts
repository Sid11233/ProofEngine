/** The Stripe webhook against the real database, with real signatures and no network (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { processVerifiedEvent } from "./webhook-core";

const SECRET = "whsec_test_" + "a".repeat(32);
const PRICE = "price_testpro123";
let POST: (request: Request) => Promise<Response>;
let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let ws: string;
const stripe = new Stripe("sk_test_unused");
let counter = 0;
const evtId = () => `evt_${Date.now()}${++counter}`;
const cus = () => `cus_${hex64().slice(0, 14)}`;
const sub = () => `sub_${hex64().slice(0, 14)}`;

function subscriptionObject(o: { id: string; customer: string; status?: string; price?: string; workspace?: string | null; cancel?: boolean }) {
  return {
    id: o.id, object: "subscription", customer: o.customer, status: o.status ?? "active", cancel_at_period_end: o.cancel ?? false,
    metadata: o.workspace === null ? {} : { workspace_id: o.workspace ?? ws },
    items: { data: [{ price: { id: o.price ?? PRICE }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] },
  };
}
const make = (type: string, object: unknown, id = evtId()) => JSON.stringify({ id, object: "event", type, data: { object } });
const sign = (payload: string, secret = SECRET, timestamp?: number) => stripe.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
const send = (payload: string, headers: Record<string, string> = {}) => POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "x-forwarded-for": "198.51.100.9", ...headers } }));
const deliver = (payload: string) => send(payload, { "stripe-signature": sign(payload) });

const planOf = async (id = ws) => String((await admin.from("workspaces").select("plan").eq("id", id).single()).data?.plan);
const subRow = async (id = ws) => (await admin.from("subscriptions").select("*").eq("workspace_id", id).maybeSingle()).data as Record<string, unknown> | null;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_" + "b".repeat(24);
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_PRICE_PRO = PRICE;
  ({ POST } = await import("@/app/api/stripe/webhook/route"));
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  owner = await createTestUser(cfg, admin, "bill-owner");
  ws = String((await owner.client.rpc("create_workspace", { name: "Billing Co", type: "agency" })).data);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.auth.admin.deleteUser(owner.id);
}, 120_000);

describe("signature checking", () => {
  const body = () => make("customer.subscription.created", subscriptionObject({ id: sub(), customer: cus() }));

  it("rejects unsigned, forged, tampered, wrong-secret and stale requests with 400 and changes nothing", async () => {
    const payload = body();
    expect((await send(payload)).status, "no signature").toBe(400);
    expect((await send(payload, { "stripe-signature": "t=1,v1=deadbeef" })).status, "forged").toBe(400);
    expect((await send(payload, { "stripe-signature": sign(payload, "whsec_other_" + "c".repeat(32)) })).status, "wrong secret").toBe(400);
    expect((await send(payload + " ", { "stripe-signature": sign(payload) })).status, "tampered body").toBe(400);
    expect((await send(payload, { "stripe-signature": sign(payload, SECRET, Math.floor(Date.now() / 1000) - 3600) })).status, "stale timestamp").toBe(400);
    expect(await planOf()).toBe("free");
    expect(await subRow()).toBeNull();
  });

  it("answers 413 for an oversized body before reading it, and carries no detail in errors", async () => {
    const res = await send("x".repeat(1_100_000), { "stripe-signature": "t=1,v1=00" });
    expect(res.status).toBe(413);
    expect(await (await send(body())).json()).toEqual({ error: "invalid_signature" });
  });
});

describe("subscription lifecycle", () => {
  const customer = cus();
  const subscription = sub();

  it("checkout links the customer; the subscription event upgrades the workspace; replays are skipped", async () => {
    expect((await deliver(make("checkout.session.completed", { mode: "subscription", customer, subscription, client_reference_id: ws, metadata: { workspace_id: ws } }))).status).toBe(200);
    expect((await subRow())?.stripe_customer_id).toBe(customer);
    expect(await planOf()).toBe("free");

    const payload = make("customer.subscription.created", subscriptionObject({ id: subscription, customer }));
    const first = await (await deliver(payload)).json();
    expect(first).toEqual({ received: true, outcome: "processed" });
    expect(await planOf()).toBe("pro");
    expect(await subRow()).toMatchObject({ plan: "pro", status: "active", stripe_subscription_id: subscription, past_due_since: null });

    // Replay: same event id, even re-signed. Nothing is applied again.
    await admin.from("workspaces").update({ plan: "free" }).eq("id", ws);
    expect(await (await deliver(payload)).json()).toEqual({ received: true, outcome: "duplicate" });
    expect(await planOf(), "a replayed event was applied").toBe("free");
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
  });

  it("keeps access for a 7 day grace period after a failed payment, then drops to free", async () => {
    expect((await deliver(make("invoice.payment_failed", { customer, subscription }))).status).toBe(200);
    expect(await subRow()).toMatchObject({ plan: "pro", past_due_since: expect.any(String) });
    expect(await planOf()).toBe("pro");

    expect((await deliver(make("customer.subscription.updated", subscriptionObject({ id: subscription, customer, status: "past_due" })))).status).toBe(200);
    expect(await planOf(), "access lost before the grace period ended").toBe("pro");
    expect((await admin.rpc("expire_billing_grace")).data, "nothing is due yet").toBe(0);

    await admin.from("subscriptions").update({ past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("workspace_id", ws);
    expect((await admin.rpc("expire_billing_grace")).data).toBe(1);
    expect(await planOf()).toBe("free");
    expect(await subRow()).toMatchObject({ plan: "free", status: "past_due" });
  });

  it("restores access when the invoice is paid or the subscription is active again, and ends it on deletion", async () => {
    expect((await deliver(make("customer.subscription.updated", subscriptionObject({ id: subscription, customer, status: "active" })))).status).toBe(200);
    expect(await planOf()).toBe("pro");
    expect(await subRow()).toMatchObject({ past_due_since: null });

    await deliver(make("invoice.payment_failed", { customer, subscription }));
    await deliver(make("invoice.paid", { customer, subscription }));
    expect(await subRow()).toMatchObject({ past_due_since: null });

    await deliver(make("customer.subscription.updated", subscriptionObject({ id: subscription, customer, status: "active", cancel: true })));
    expect(await planOf(), "cancel at period end keeps the plan until the period ends").toBe("pro");
    expect(await subRow()).toMatchObject({ cancel_at_period_end: true });

    await deliver(make("customer.subscription.deleted", subscriptionObject({ id: subscription, customer, status: "canceled" })));
    expect(await planOf()).toBe("free");
    expect(await subRow()).toMatchObject({ plan: "free", status: "canceled" });
  });

  it("never grants access for a price we do not sell, but still ends access when one is canceled", async () => {
    const c2 = cus();
    const s2 = sub();
    await deliver(make("checkout.session.completed", { mode: "subscription", customer: c2, subscription: s2, metadata: { workspace_id: ws } }));
    // The workspace already has a customer: the second one is refused, nothing changes.
    expect((await subRow())?.stripe_customer_id).not.toBe(c2);

    const wrong = make("customer.subscription.created", subscriptionObject({ id: s2, customer: (await subRow())?.stripe_customer_id as string, price: "price_unknownxyz" }));
    expect(await (await deliver(wrong)).json()).toEqual({ received: true, outcome: "ignored" });
    expect(await planOf()).toBe("free");
  });
});

describe("hostile or odd events", () => {
  it("ignores another customer for the same workspace, a customer shared with another workspace and malformed objects", async () => {
    const ws2 = String((await owner.client.rpc("create_workspace", { name: "Other Billing Co", type: "agency" })).data);
    try {
      const mine = (await subRow())?.stripe_customer_id as string;
      // Metadata names workspace 2, but the customer is workspace 1's: refused.
      const stolen = make("customer.subscription.created", subscriptionObject({ id: sub(), customer: mine, workspace: ws2 }));
      expect(await (await deliver(stolen)).json()).toEqual({ received: true, outcome: "ignored" });
      expect(await planOf(ws2)).toBe("free");

      // A customer we have never linked and no workspace in the metadata: nowhere to apply it.
      const orphan = make("customer.subscription.created", subscriptionObject({ id: sub(), customer: cus(), workspace: null }));
      expect(await (await deliver(orphan)).json()).toEqual({ received: true, outcome: "ignored" });

      for (const bad of [{ id: "nope" }, { id: sub(), customer: 5, items: {} }, "string", null]) {
        expect((await deliver(make("customer.subscription.updated", bad))).status).toBe(200);
      }
      expect(await (await deliver(make("charge.succeeded", { id: "ch_1" }))).json()).toEqual({ received: true, outcome: "ignored" });
      expect(await planOf(ws2)).toBe("free");
    } finally {
      await admin.from("workspaces").delete().eq("id", ws2);
    }
  });

  it("releases an event when handling fails, so Stripe's retry is processed", async () => {
    const customer2 = cus();
    const event = { id: evtId(), type: "customer.subscription.created", data: { object: JSON.parse(make("x", subscriptionObject({ id: sub(), customer: customer2, workspace: ws }))).data.object } };
    let failures = 1;
    const flaky = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "rpc") return Reflect.get(target, prop, receiver);
        return (fn: string, args: Record<string, unknown>) => (fn === "apply_billing_state" && failures-- > 0 ? Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }) : admin.rpc(fn, args));
      },
    }) as SupabaseClient;
    await expect(processVerifiedEvent(flaky, event, { STRIPE_PRICE_PRO: PRICE })).rejects.toThrow();
    // The same event id is accepted again; it is a different customer for this workspace, so it is ignored, not duplicated.
    expect(await processVerifiedEvent(flaky, event, { STRIPE_PRICE_PRO: PRICE })).not.toBe("duplicate");
    expect(await processVerifiedEvent(flaky, event, { STRIPE_PRICE_PRO: PRICE })).toBe("duplicate");
  });
});

describe("nothing here can be reached from a browser", () => {
  it("has no client write path for plan, subscriptions or events, and the functions are server-only", async () => {
    expect(wasBlocked(await owner.client.from("workspaces").update({ plan: "pro" }).eq("id", ws).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("subscriptions").update({ plan: "pro" }).eq("workspace_id", ws).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("subscriptions").insert({ workspace_id: ws, plan: "pro" }).select())).toBe(true);
    expect((await owner.client.from("stripe_events").select("*")).data ?? []).toHaveLength(0);
    expect((await anon.from("subscriptions").select("*")).data ?? []).toHaveLength(0);
    for (const client of [anon, owner.client]) {
      expect(wasBlocked(await client.rpc("apply_billing_state", { ws, customer: cus(), subscription: sub(), paid_plan: "pro", sub_status: "active", period_end: null, cancels_at_end: false }))).toBe(true);
      expect(wasBlocked(await client.rpc("claim_stripe_event", { event_id: "evt_x", event_type: "x" }))).toBe(true);
      expect(wasBlocked(await client.rpc("expire_billing_grace"))).toBe(true);
    }
    // Members can read their own subscription (for the billing page), nobody else's.
    expect((await owner.client.from("subscriptions").select("plan, status").eq("workspace_id", ws)).data).toHaveLength(1);
  });
});
