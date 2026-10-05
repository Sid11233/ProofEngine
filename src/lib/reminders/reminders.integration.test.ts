/** Automatic reminders, do-not-contact and the daily limit against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { unsubscribeToken } from "@/lib/security/unsubscribe";
import { runReminders } from "./run";
import { applyUnsubscribe, describeUnsubscribe } from "./unsubscribe-core";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const SECRET = "test-unsubscribe-secret-0123456789abcdef";
const DAY = 86_400_000;

type Fields = { sentDaysAgo?: number; status?: string; reminders?: number; lastReminderHoursAgo?: number; revoked?: boolean; expiresInDays?: number; dnc?: boolean; workspace?: string };

/** A request in the given state. Requests are created through the real function, then moved into place. */
async function request(f: Fields = {}, email = "client@example.test") {
  const token = generateToken();
  const { data: id, error } = await owner.client.rpc("create_proof_request", { ws: f.workspace ?? ws, client_name: "Dana Doe", client_email: email, project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: token.hash });
  if (error) throw new Error(error.message);
  await admin.from("proof_requests").update({
    status: f.status ?? "sent",
    sent_at: new Date(Date.now() - (f.sentDaysAgo ?? 4) * DAY).toISOString(),
    reminder_count: f.reminders ?? 0,
    last_reminder_at: f.lastReminderHoursAgo === undefined ? null : new Date(Date.now() - f.lastReminderHoursAgo * 3_600_000).toISOString(),
    revoked_at: f.revoked ? new Date().toISOString() : null,
    expires_at: new Date(Date.now() + (f.expiresInDays ?? 20) * DAY).toISOString(),
    do_not_contact_at: f.dnc ? new Date().toISOString() : null,
  }).eq("id", id);
  return { id: String(id), token };
}

const candidates = async () => new Set((((await admin.rpc("auto_remind_candidates", { batch: 100 })).data ?? []) as Array<{ request_id: string }>).map((c) => c.request_id));
const row = async (id: string) => (await admin.from("proof_requests").select("*").eq("id", id).single()).data as Record<string, unknown>;

function sender(ok = true) {
  const sent: EmailMessage[] = [];
  const s: EmailSender = { async send(m) { sent.push(m); return ok; } };
  return { s, sent };
}
const run = (s: EmailSender | null) => runReminders({ admin, sender: s, appUrl: "https://app.example.com", unsubscribeSecret: SECRET });

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "rm-owner");
  ws = String((await owner.client.rpc("create_workspace", { name: "Reminder Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "team" }).eq("id", ws);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  await admin.auth.admin.deleteUser(owner.id);
}, 120_000);

describe("who is due a reminder", () => {
  it("follows day 3 and day 7, at most twice, 48 hours apart", async () => {
    const early = await request({ sentDaysAgo: 2 });
    const first = await request({ sentDaysAgo: 3.1 });
    const secondTooSoon = await request({ sentDaysAgo: 5, reminders: 1, lastReminderHoursAgo: 40 });
    const secondNotYet = await request({ sentDaysAgo: 6, reminders: 1, lastReminderHoursAgo: 72 });
    const second = await request({ sentDaysAgo: 7.2, reminders: 1, lastReminderHoursAgo: 72 });
    const done = await request({ sentDaysAgo: 20, reminders: 2, lastReminderHoursAgo: 200 });
    const due = await candidates();
    expect(due.has(first.id)).toBe(true);
    expect(due.has(second.id)).toBe(true);
    for (const [name, r] of Object.entries({ early, secondTooSoon, secondNotYet, done })) expect(due.has(r.id), name).toBe(false);
  });

  it("never includes revoked, expired, started, completed, draft or do-not-contact requests", async () => {
    const bad = {
      revoked: await request({ revoked: true }),
      expired: await request({ expiresInDays: -1 }),
      started: await request({ status: "started" }),
      completed: await request({ status: "completed" }),
      draft: await request({ status: "draft" }),
      dnc: await request({ dnc: true }),
    };
    const due = await candidates();
    for (const [name, r] of Object.entries(bad)) expect(due.has(r.id), name).toBe(false);
  });
});

describe("runReminders", () => {
  it("sends a fresh link and an unsubscribe link, rotates the token and counts the reminder", async () => {
    const r = await request({ sentDaysAgo: 3.5 }, "first@example.test");
    const { s, sent } = sender();
    const summary = await run(s);
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const mail = sent.find((m) => m.to === "first@example.test");
    expect(mail?.subject).toContain("Reminder");
    const link = /https:\/\/app\.example\.com\/i\/([A-Za-z0-9_-]{43})/.exec(mail?.text ?? "")?.[1];
    expect(link, "the email has no interview link").toBeTruthy();
    const after = await row(r.id);
    expect(after.token_hash).toBe(hashToken(String(link)));
    expect(after.token_hash).not.toBe(r.token.hash);
    expect(after).toMatchObject({ reminder_count: 1, status: "sent" });
    expect(mail?.text).toContain(`https://app.example.com/unsubscribe/${unsubscribeToken(SECRET, r.id)}`);

    // Not again until day 7.
    expect((await candidates()).has(r.id)).toBe(false);
  });

  it("gives the reminder back, and a later run tries again, when the email fails", async () => {
    const r = await request({ sentDaysAgo: 3.5 }, "flaky@example.test");
    const failing = sender(false);
    const summary = await run(failing.s);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(await row(r.id)).toMatchObject({ reminder_count: 0, last_reminder_at: null });
    expect((await candidates()).has(r.id)).toBe(true);
    const ok = sender();
    await run(ok.s);
    expect(ok.sent.some((m) => m.to === "flaky@example.test")).toBe(true);
    expect((await row(r.id)).reminder_count).toBe(1);
  });

  it("does nothing at all when email is not configured", async () => {
    const r = await request({ sentDaysAgo: 3.5 });
    const before = await row(r.id);
    expect(await run(null)).toMatchObject({ sent: 0, emailConfigured: false });
    expect(await row(r.id)).toEqual(before);
  });

  it("respects the per-workspace daily limit of 25", async () => {
    const other = await createTestUser(loadLocalConfig(), admin, "rm-cap");
    const wsCap = String((await other.client.rpc("create_workspace", { name: "Cap Co", type: "agency" })).data);
    await admin.from("workspaces").update({ plan: "team" }).eq("id", wsCap);
    const asOther = { ...owner, client: other.client } as TestUser;
    const save = owner;
    owner = asOther;
    try {
      for (let i = 0; i < 27; i++) await request({ sentDaysAgo: 3.5, workspace: wsCap }, `cap${i}@example.test`);
    } finally {
      owner = save;
    }
    const { s, sent } = sender();
    await run(s);
    await run(s);
    const toCap = sent.filter((m) => /cap\d+@example\.test/.test(m.to));
    expect(toCap).toHaveLength(25);
    await admin.from("workspaces").delete().eq("id", wsCap);
    await admin.auth.admin.deleteUser(other.id);
  }, 120_000);
});

describe("do not contact", () => {
  it("stops reminders and manual sending, and the unsubscribe token is verified", async () => {
    const r = await request({ sentDaysAgo: 3.5 }, "stop@example.test");
    expect(await describeUnsubscribe(admin, SECRET, "garbage")).toEqual({ ok: false });
    expect(await describeUnsubscribe(admin, SECRET, unsubscribeToken("another-secret", r.id))).toEqual({ ok: false });
    expect(await applyUnsubscribe(admin, SECRET, unsubscribeToken("another-secret", r.id))).toBe(false);
    expect((await row(r.id)).do_not_contact_at).toBeNull();

    const token = unsubscribeToken(SECRET, r.id);
    expect(await describeUnsubscribe(admin, SECRET, token)).toEqual({ ok: true, workspaceName: "Reminder Co", alreadyDone: false });
    expect(await applyUnsubscribe(admin, SECRET, token)).toBe(true);
    expect(await applyUnsubscribe(admin, SECRET, token), "idempotent").toBe(true);
    expect(await describeUnsubscribe(admin, SECRET, token)).toMatchObject({ ok: true, alreadyDone: true });

    expect((await candidates()).has(r.id)).toBe(false);
    for (const purpose of ["send", "remind"]) {
      expect((await owner.client.rpc("rotate_request_token", { request_id: r.id, new_hash: generateToken().hash, purpose })).error, purpose).not.toBeNull();
    }
    // Copying a fresh link by hand is still allowed: that sends nothing.
    expect((await owner.client.rpc("rotate_request_token", { request_id: r.id, new_hash: generateToken().hash, purpose: "regenerate" })).error).toBeNull();
  });

  it("is a server-only surface", async () => {
    const r = await request();
    const anon = makeClient(loadLocalConfig(), "anon");
    for (const client of [anon, owner.client]) {
      expect(wasBlocked(await client.rpc("mark_do_not_contact", { request_id: r.id }))).toBe(true);
      expect(wasBlocked(await client.rpc("auto_remind_request", { request_id: r.id, new_hash: generateToken().hash }))).toBe(true);
      expect(wasBlocked(await client.rpc("auto_remind_candidates", { batch: 5 }))).toBe(true);
    }
    expect(wasBlocked(await owner.client.from("proof_requests").update({ do_not_contact_at: null }).eq("id", r.id).select())).toBe(true);
  });
});
