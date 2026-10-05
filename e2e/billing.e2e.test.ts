import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { BASE, createUser, newPage, signIn, startStack, stopStack, type Stack } from "./harness";

const WEBHOOK_SECRET = "whsec_e2e_" + randomBytes(24).toString("hex");
const PRICE = "price_e2epro123";
const CRON_SECRET = "e2e-cron-secret-" + randomBytes(24).toString("hex");
let stack: Stack;
const stripe = new Stripe("sk_test_unused");

beforeAll(async () => {
  stack = await startStack({ STRIPE_SECRET_KEY: "sk_test_" + randomBytes(16).toString("hex"), STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PRICE_PRO: PRICE, CRON_SECRET });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

let n = 0;
const body = (type: string, object: unknown) => JSON.stringify({ id: `evt_e2e${Date.now()}${++n}`, object: "event", type, data: { object } });
async function webhook(payload: string, signature?: string) {
  return fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: payload, headers: { "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}`, ...(signature ? { "stripe-signature": signature } : {}) } });
}
const signed = (payload: string) => webhook(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }));

async function ownerOf(label: string) {
  const user = await createUser(stack.admin, label);
  const { data: m } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", user.id).single();
  return { ...user, ws: String(m?.workspace_id) };
}
const subscription = (ws: string, customer: string, status = "active") => ({ id: `sub_${randomBytes(6).toString("hex")}`, customer, status, metadata: { workspace_id: ws }, items: { data: [{ price: { id: PRICE }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] } });

describe("Stripe webhook over HTTP", () => {
  it("rejects unsigned and forged requests, and a signed event upgrades and downgrades the workspace as the billing page shows", async () => {
    const owner = await ownerOf("bill-flow");
    const customer = `cus_${randomBytes(7).toString("hex")}`;
    const payload = body("customer.subscription.created", subscription(owner.ws, customer));

    expect((await webhook(payload)).status, "unsigned").toBe(400);
    expect((await webhook(payload, "t=1,v1=00")).status, "forged").toBe(400);
    expect((await stack.admin.from("workspaces").select("plan").eq("id", owner.ws).single()).data?.plan).toBe("free");

    const page = await newPage(stack);
    await signIn(page, owner.email, owner.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/billing`);
    expect(await page.getByTestId("plan-name").textContent()).toBe("Free");
    await page.getByRole("button", { name: "Upgrade to Pro" }).waitFor();

    const ok = await signed(payload);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true, outcome: "processed" });
    expect(await (await signed(payload)).json(), "replay").toEqual({ received: true, outcome: "duplicate" });

    await page.reload();
    expect(await page.getByTestId("plan-name").textContent()).toBe("Pro");
    expect(await page.getByRole("button", { name: "Upgrade to Pro" }).count()).toBe(0);
    await page.getByRole("button", { name: "Manage billing" }).waitFor();

    await signed(body("invoice.payment_failed", { customer }));
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Your last payment failed" }).waitFor();
    expect(await page.getByTestId("plan-name").textContent(), "access is kept during the grace period").toBe("Pro");

    await signed(body("customer.subscription.deleted", subscription(owner.ws, customer, "canceled")));
    await page.reload();
    expect(await page.getByTestId("plan-name").textContent()).toBe("Free");
  }, 120_000);

  it("only the owner is offered billing actions", async () => {
    const owner = await ownerOf("bill-roles");
    const editor = await createUser(stack.admin, "bill-editor", { withWorkspace: false });
    await stack.admin.from("workspace_members").insert({ workspace_id: owner.ws, user_id: editor.id, role: "editor" });
    const page = await newPage(stack);
    await signIn(page, editor.email, editor.password);
    await page.waitForURL(`${BASE}/app/dashboard`);
    await page.goto(`${BASE}/app/billing`);
    await page.getByText("Only the workspace owner can change the plan").waitFor();
    expect(await page.getByRole("button", { name: /Upgrade|Manage billing/ }).count()).toBe(0);
  }, 120_000);
});

describe("grace period cron", () => {
  it("needs the secret, then drops workspaces whose 7 days ran out", async () => {
    const call = (headers: Record<string, string>) => fetch(`${BASE}/api/cron/billing`, { headers: { "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}`, ...headers } });
    expect((await call({})).status).toBe(401);
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);

    const owner = await ownerOf("bill-grace");
    const customer = `cus_${randomBytes(7).toString("hex")}`;
    await signed(body("customer.subscription.created", subscription(owner.ws, customer)));
    await signed(body("invoice.payment_failed", { customer }));
    await signed(body("customer.subscription.updated", subscription(owner.ws, customer, "past_due")));
    expect((await stack.admin.from("workspaces").select("plan").eq("id", owner.ws).single()).data?.plan).toBe("pro");
    await stack.admin.from("subscriptions").update({ past_due_since: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("workspace_id", owner.ws);

    const ok = await call({ authorization: `Bearer ${CRON_SECRET}` });
    expect(ok.status).toBe(200);
    expect((await ok.json()).downgraded).toBeGreaterThanOrEqual(1);
    expect((await stack.admin.from("workspaces").select("plan").eq("id", owner.ws).single()).data?.plan).toBe("free");
  }, 120_000);
});
