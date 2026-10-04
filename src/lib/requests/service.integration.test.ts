/** Request service against the real database with a fake email sender (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { createResolver } from "@/lib/interview-access-core";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { createRequest, getRequest, listRequests, regenerateLink, revokeRequest, sendInvite, sendReminder, type Context } from "./service";
import type { CreateRequestInput } from "./schemas";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let ws: string;
const users: string[] = [];

const recorder = () => {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = { async send(m) { sent.push(m); return true; } };
  return { sent, ctx: { appUrl: "https://app.example.test", workspaceName: "Svc Co", sender } as Context };
};

const resolve = (raw: string) =>
  createResolver({ admin, ipLimiter: createMemoryLimiter({ limit: 999, windowMs: 60_000 }), tokenLimiter: createMemoryLimiter({ limit: 999, windowMs: 60_000 }) })(raw, { ip: "t" });

const input = (overrides: Partial<CreateRequestInput> = {}): CreateRequestInput => ({
  clientName: "Robin Client",
  clientEmail: "robin@example.test",
  flowType: "saas",
  tone: "friendly",
  ...overrides,
});

const tokenOf = (link: string) => new URL(link).pathname.split("/").pop()!;

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, viewer] = await Promise.all(["rq-owner", "rq-viewer"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Svc Co", type: "saas" })).data);
  await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
}, 60_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("request service", () => {
  it("creates a request whose link works, and never stores the raw token", async () => {
    const { sent, ctx } = recorder();
    const result = await createRequest(owner.client, ws, input({ outcome1: "faster onboarding" }), ctx);
    expect(result).toMatchObject({ ok: true, emailSent: false });
    if (!result.ok) return;
    const raw = tokenOf(result.link);
    expect(sent).toHaveLength(0);

    const { data } = await admin.from("proof_requests").select("*").eq("id", result.requestId).single();
    expect(JSON.stringify(data)).not.toContain(raw);
    expect(data?.focus_outcomes).toEqual(["faster onboarding"]);
    expect((await admin.from("audit_log").select("*").eq("workspace_id", ws)).data?.some((a) => JSON.stringify(a).includes(raw))).toBe(false);
    expect((await resolve(raw)).ok).toBe(true);
  });

  it("send now emails the same link it returns, to the stored address, as plain text", async () => {
    const { sent, ctx } = recorder();
    const result = await createRequest(owner.client, ws, input({ sendNow: "on", clientName: "<b>Robin</b> Client" }), ctx);
    expect(result).toMatchObject({ ok: true, emailSent: true });
    if (!result.ok) return;
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("robin@example.test");
    expect(sent[0].text).toContain(result.link);
    expect(sent[0].text.startsWith("Hi <b>Robin</b>,")).toBe(true); // text only: nothing is interpreted as HTML
    expect((await getRequest(owner.client, result.requestId))?.status).toBe("sent");
    expect((await resolve(tokenOf(result.link))).ok).toBe(true);
  });

  it("each send, reminder and regeneration kills the previous link", async () => {
    const { sent, ctx } = recorder();
    const created = await createRequest(owner.client, ws, input(), ctx);
    if (!created.ok) throw new Error("setup");
    const first = tokenOf(created.link);

    const sentResult = await sendInvite(owner.client, created.requestId, ctx);
    if (!sentResult.ok) throw new Error("send failed");
    expect((await resolve(first)).ok, "link survived send").toBe(false);
    const second = tokenOf(sentResult.link);
    expect((await resolve(second)).ok).toBe(true);

    const reminder = await sendReminder(owner.client, created.requestId, ctx);
    if (!reminder.ok) throw new Error("remind failed");
    expect((await resolve(second)).ok, "link survived reminder").toBe(false);
    expect(sent.at(-1)?.text).toContain("replaces the one in our earlier email");

    expect(await sendReminder(owner.client, created.requestId, ctx), "second reminder inside 48h").toEqual({ ok: false, error: "limit" });

    const regenerated = await regenerateLink(owner.client, created.requestId, ctx);
    if (!regenerated.ok) throw new Error("regen failed");
    expect(regenerated.emailSent).toBe(false);
    expect((await resolve(tokenOf(reminder.link))).ok).toBe(false);
    expect((await resolve(tokenOf(regenerated.link))).ok).toBe(true);
  });

  it("revoking stops the link at once; revoking twice or a stranger's id fails cleanly", async () => {
    const { ctx } = recorder();
    const created = await createRequest(owner.client, ws, input(), ctx);
    if (!created.ok) throw new Error("setup");
    expect((await resolve(tokenOf(created.link))).ok).toBe(true);
    expect(await revokeRequest(owner.client, created.requestId)).toEqual({ ok: true });
    expect((await resolve(tokenOf(created.link))).ok).toBe(false);
    expect(await revokeRequest(owner.client, crypto.randomUUID())).toEqual({ ok: false, error: "forbidden" });
  });

  it("viewers can list and read but cannot create, send, remind, regenerate or revoke", async () => {
    const { sent, ctx } = recorder();
    const created = await createRequest(owner.client, ws, input(), ctx);
    if (!created.ok) throw new Error("setup");

    expect((await listRequests(viewer.client)).some((r) => r.id === created.requestId)).toBe(true);
    expect(await createRequest(viewer.client, ws, input(), ctx)).toEqual({ ok: false, error: "forbidden" });
    expect(await sendInvite(viewer.client, created.requestId, ctx)).toEqual({ ok: false, error: "forbidden" });
    expect(await sendReminder(viewer.client, created.requestId, ctx)).toEqual({ ok: false, error: "forbidden" });
    expect(await regenerateLink(viewer.client, created.requestId, ctx)).toEqual({ ok: false, error: "forbidden" });
    expect(await revokeRequest(viewer.client, created.requestId)).toEqual({ ok: false, error: "forbidden" });
    expect(sent).toHaveLength(0);
  });

  it("never exposes token_hash through the listing", async () => {
    const rows = await listRequests(owner.client);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/token_hash|tokenHash/);
  });
});
