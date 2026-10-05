/** Checkout and portal creation with a fake Stripe, against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { billingUrls, createCheckout, createPortal, isStripeUrl, type StripeLike } from "./checkout";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const APP = "https://app.example.com";

function fakeStripe(overrides: { sessionUrl?: string | null; fail?: boolean } = {}) {
  const calls = { customers: [] as unknown[], sessions: [] as Array<Record<string, unknown>>, portals: [] as unknown[] };
  const stripe: StripeLike = {
    customers: { async create(p) { calls.customers.push(p); return { id: `cus_${hex64().slice(0, 14)}` }; } },
    checkout: { sessions: { async create(p) { if (overrides.fail) throw new Error("network"); calls.sessions.push(p); return { url: overrides.sessionUrl === undefined ? "https://checkout.stripe.com/c/pay/cs_test_123" : overrides.sessionUrl }; } } },
    billingPortal: { sessions: { async create(p) { calls.portals.push(p); return { url: "https://billing.stripe.com/p/session/test_123" }; } } },
  };
  return { stripe, calls };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "co-owner");
  ws = String((await owner.client.rpc("create_workspace", { name: "Checkout Co", type: "agency" })).data);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.auth.admin.deleteUser(owner.id);
}, 120_000);

describe("isStripeUrl", () => {
  it("accepts only Stripe's checkout and billing pages over https", () => {
    expect(isStripeUrl("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(isStripeUrl("https://billing.stripe.com/p/session/x")).toBe(true);
    for (const bad of ["http://checkout.stripe.com/x", "https://evil.example/checkout.stripe.com", "https://checkout.stripe.com.evil.example/", "javascript:alert(1)", "", null, undefined, "https://stripe.com/"]) expect(isStripeUrl(bad), String(bad)).toBe(false);
  });
});

describe("createCheckout", () => {
  it("creates the customer once, takes the price from the caller's server config, and builds fixed URLs", async () => {
    const { stripe, calls } = fakeStripe();
    const ctx = { stripe, admin, appUrl: APP };
    const first = await createCheckout(ctx, { id: ws, name: "Checkout Co", plan: "free" }, "price_serverconfig1");
    expect(first).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_123" });
    expect(calls.customers).toHaveLength(1);
    expect(calls.sessions[0]).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_serverconfig1", quantity: 1 }],
      client_reference_id: ws,
      metadata: { workspace_id: ws },
      subscription_data: { metadata: { workspace_id: ws } },
      success_url: `${APP}/app/billing?checkout=success`,
      cancel_url: `${APP}/app/billing?checkout=cancelled`,
    });
    const stored = (await admin.from("subscriptions").select("stripe_customer_id").eq("workspace_id", ws).single()).data?.stripe_customer_id;
    expect(calls.sessions[0].customer).toBe(stored);

    await createCheckout(ctx, { id: ws, name: "Checkout Co", plan: "free" }, "price_serverconfig1");
    expect(calls.customers, "a second customer was created").toHaveLength(1);
    expect(calls.sessions[1].customer).toBe(stored);
  });

  it("refuses a workspace that already pays, and an unexpected checkout URL, and survives a provider error", async () => {
    const paid = fakeStripe();
    expect(await createCheckout({ stripe: paid.stripe, admin, appUrl: APP }, { id: ws, name: "x", plan: "pro" }, "price_a1")).toEqual({ ok: false, reason: "already_subscribed" });
    expect(paid.calls.sessions).toHaveLength(0);
    expect(await createCheckout({ stripe: fakeStripe({ sessionUrl: "https://evil.example/pay" }).stripe, admin, appUrl: APP }, { id: ws, name: "x", plan: "free" }, "price_a1")).toEqual({ ok: false, reason: "failed" });
    expect(await createCheckout({ stripe: fakeStripe({ sessionUrl: null }).stripe, admin, appUrl: APP }, { id: ws, name: "x", plan: "free" }, "price_a1")).toEqual({ ok: false, reason: "failed" });
    expect(await createCheckout({ stripe: fakeStripe({ fail: true }).stripe, admin, appUrl: APP }, { id: ws, name: "x", plan: "free" }, "price_a1")).toEqual({ ok: false, reason: "failed" });
  });
});

describe("createPortal", () => {
  it("opens the portal for the stored customer with a fixed return URL, and needs a customer first", async () => {
    const { stripe, calls } = fakeStripe();
    const stored = (await admin.from("subscriptions").select("stripe_customer_id").eq("workspace_id", ws).single()).data?.stripe_customer_id;
    expect(await createPortal({ stripe, admin, appUrl: APP }, { id: ws })).toEqual({ ok: true, url: "https://billing.stripe.com/p/session/test_123" });
    expect(calls.portals[0]).toEqual({ customer: stored, return_url: billingUrls(APP).portalReturn });

    const other = await createTestUser(loadLocalConfig(), admin, "co-other");
    const ws2 = String((await other.client.rpc("create_workspace", { name: "No Customer", type: "agency" })).data);
    expect(await createPortal({ stripe, admin, appUrl: APP }, { id: ws2 })).toEqual({ ok: false, reason: "no_customer" });
    await admin.from("workspaces").delete().eq("id", ws2);
    await admin.auth.admin.deleteUser(other.id);
  });
});
