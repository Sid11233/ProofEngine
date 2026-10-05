import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { unsubscribeSecret } from "../src/lib/security/ip-hash";
import { unsubscribeToken } from "../src/lib/security/unsubscribe";
import { BASE, createUser, newPage, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;
const CRON_SECRET = "e2e-cron-secret-" + randomBytes(24).toString("hex");

beforeAll(async () => {
  stack = await startStack({ CRON_SECRET });
}, 120_000);

afterAll(async () => {
  await stopStack(stack);
});

describe("cron endpoint", () => {
  it("rejects anything without the right secret, and answers with counts only", async () => {
    const call = (headers: Record<string, string>, method = "GET") => fetch(`${BASE}/api/cron/reminders`, { method, headers: { "x-forwarded-for": `198.51.100.${(Date.now() % 200) + 1}`, ...headers } });

    expect((await call({})).status, "no header").toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status, "wrong secret").toBe(401);
    expect((await call({ authorization: CRON_SECRET })).status, "no Bearer prefix").toBe(401);
    expect((await call({ authorization: `Bearer ${CRON_SECRET}x` })).status, "almost right").toBe(401);
    expect((await call({ authorization: `Bearer ${CRON_SECRET}` }, "POST")).status, "POST").toBe(405);

    const ok = await call({ authorization: `Bearer ${CRON_SECRET}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("no-store");
    const body = await ok.json();
    expect(Object.keys(body).sort()).toEqual(["considered", "emailConfigured", "failed", "sent", "skipped"]);
    // No email provider is configured in the test stack, so nothing is rotated or sent.
    expect(body).toMatchObject({ sent: 0, emailConfigured: false });
  }, 60_000);
});

describe("unsubscribe page", () => {
  async function dueRequest() {
    const owner = await createUser(stack.admin, "rm-e2e");
    const { data: member } = await stack.admin.from("workspace_members").select("workspace_id").eq("user_id", owner.id).single();
    const { data } = await stack.admin.from("proof_requests").insert({ workspace_id: member?.workspace_id, client_name: "Dana", client_email: "d@example.test", flow_type: "agency", token_hash: randomBytes(32).toString("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "sent", sent_at: new Date(Date.now() - 4 * 86_400_000).toISOString() }).select("id").single();
    return String(data?.id);
  }
  const secret = () => unsubscribeSecret({ SUPABASE_SERVICE_ROLE_KEY: stack.cfg.serviceKey });
  const state = async (id: string) => (await stack.admin.from("proof_requests").select("do_not_contact_at").eq("id", id).single()).data?.do_not_contact_at;

  it("needs a confirming click (opening the link changes nothing), then stops all emails", async () => {
    const id = await dueRequest();
    const page = await newPage(stack);
    const response = await page.goto(`${BASE}/unsubscribe/${unsubscribeToken(secret(), id)}`);
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toContain("no-store");
    await page.getByRole("heading", { name: "Stop reminder emails?" }).waitFor();
    expect(await state(id), "merely opening the link unsubscribed someone").toBeNull();

    await page.getByRole("button", { name: "Yes, stop the emails" }).click();
    await page.getByRole("heading", { name: "You are unsubscribed" }).waitFor();
    expect(await state(id)).not.toBeNull();

    // Opening it again shows it is done.
    await page.goto(`${BASE}/unsubscribe/${unsubscribeToken(secret(), id)}`);
    await page.getByRole("heading", { name: "You are unsubscribed" }).waitFor();
    const due = ((await stack.admin.rpc("auto_remind_candidates", { batch: 100 })).data ?? []) as Array<{ request_id: string }>;
    expect(due.some((c) => c.request_id === id)).toBe(false);
  }, 120_000);

  it("looks the same for forged, tampered and malformed links", async () => {
    const id = await dueRequest();
    const page = await newPage(stack);
    for (const token of [unsubscribeToken("some-other-secret", id), `${id}.AAAA`, "not-a-token", `${id}`, "x".repeat(60)]) {
      expect((await page.goto(`${BASE}/unsubscribe/${encodeURIComponent(token)}`))?.status(), token).toBe(404);
    }
    expect(await state(id)).toBeNull();
  }, 60_000);
});
