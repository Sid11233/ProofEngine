/** Push subscriptions, preferences and sending against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { notifyWorkspace, PUSH_MESSAGES, type PushSender, type PushTarget } from "./notify";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let outsider: TestUser;
let ws: string;

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const endpoint = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}${hex64().slice(0, 12)}xxxx`;
const save = (user: TestUser, args: { ws?: string; endpoint?: string; p256dh?: string; auth?: string } = {}) =>
  user.client.rpc("save_push_subscription", { ws: args.ws ?? ws, push_endpoint: args.endpoint ?? endpoint("a"), push_p256dh: args.p256dh ?? P256DH, push_auth: args.auth ?? AUTH });
const prefs = (user: TestUser, on: { c?: boolean; a?: boolean; r?: boolean }) =>
  user.client.rpc("save_notification_preferences", { ws, on_client_completed: on.c ?? false, on_approval_received: on.a ?? false, on_referral_received: on.r ?? false });

function recorder(status: (t: PushTarget) => number = () => 201) {
  const calls: Array<{ endpoint: string; payload: string }> = [];
  const sender: PushSender = { async send(t, payload) { calls.push({ endpoint: t.endpoint, payload }); return { statusCode: status(t) }; } };
  return { sender, calls };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, editor, outsider] = await Promise.all(["pu-owner", "pu-editor", "pu-out"].map((l) => createTestUser(cfg, admin, l)));
  ws = String((await owner.client.rpc("create_workspace", { name: "Push Co", type: "agency" })).data);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: editor.id, role: "editor" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [owner, editor, outsider]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("subscriptions", () => {
  it("are visible and deletable only by their own user, and the keys are never readable", async () => {
    const e1 = endpoint("own");
    expect((await save(owner, { endpoint: e1 })).error).toBeNull();
    expect((await save(editor, { endpoint: endpoint("ed") })).error).toBeNull();

    const mine = rowsOf(await owner.client.from("push_subscriptions").select("endpoint, user_id"));
    expect(mine.every((r) => r.user_id === owner.id)).toBe(true);
    expect(mine.map((r) => r.endpoint)).toContain(e1);
    expect(rowsOf(await editor.client.from("push_subscriptions").select("endpoint").eq("endpoint", e1))).toHaveLength(0);
    expect(rowsOf(await outsider.client.from("push_subscriptions").select("id"))).toHaveLength(0);
    expect(rowsOf(await anon.from("push_subscriptions").select("id"))).toHaveLength(0);
    expect((await owner.client.from("push_subscriptions").select("p256dh")).error, "the keys were readable").not.toBeNull();
    expect((await owner.client.from("push_subscriptions").select("auth")).error).not.toBeNull();

    // Teammates cannot delete each other's, the owner can delete their own.
    await editor.client.from("push_subscriptions").delete().eq("endpoint", e1);
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", e1)).data).toHaveLength(1);
    await owner.client.from("push_subscriptions").delete().eq("endpoint", e1);
    expect((await admin.from("push_subscriptions").select("id").eq("endpoint", e1)).data).toHaveLength(0);
  });

  it("can be created only through the function, by members, with valid data and at most 10 devices", async () => {
    expect(wasBlocked(await owner.client.from("push_subscriptions").insert({ user_id: owner.id, workspace_id: ws, endpoint: endpoint("d"), p256dh: P256DH, auth: AUTH }).select())).toBe(true);
    expect((await save(outsider)).error, "a non-member subscribed").not.toBeNull();
    expect(wasBlocked(await anon.rpc("save_push_subscription", { ws, push_endpoint: endpoint("n"), push_p256dh: P256DH, push_auth: AUTH }))).toBe(true);
    for (const bad of [{ endpoint: "http://fcm.googleapis.com/x/xxxxxxxxxxxxxxxx" }, { endpoint: "javascript:alert(1)//xxxxxxxxxxxxx" }, { p256dh: "short" }, { auth: "x".repeat(60) }]) {
      expect((await save(owner, bad)).error, JSON.stringify(bad)).not.toBeNull();
    }
    const again = endpoint("same");
    const first = await save(owner, { endpoint: again });
    const second = await save(owner, { endpoint: again });
    expect(first.data, "saving twice must update, not duplicate").toBe(second.data);

    await admin.from("push_subscriptions").delete().eq("user_id", owner.id);
    for (let i = 0; i < 10; i++) expect((await save(owner, { endpoint: endpoint(`cap${i}`) })).error).toBeNull();
    expect((await save(owner, { endpoint: endpoint("cap-over") })).error?.code).toBe("54000");
    await admin.from("push_subscriptions").delete().eq("user_id", owner.id);
  });

  it("disappear when the user leaves the workspace", async () => {
    const temp = await createTestUser(loadLocalConfig(), admin, "pu-temp");
    await admin.from("workspace_members").insert({ workspace_id: ws, user_id: temp.id, role: "viewer" });
    expect((await save(temp, { endpoint: endpoint("tmp") })).error).toBeNull();
    await admin.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", temp.id);
    expect((await admin.from("push_subscriptions").select("id").eq("user_id", temp.id)).data).toHaveLength(0);
    await admin.auth.admin.deleteUser(temp.id);
  });
});

describe("preferences and targets", () => {
  it("start off, are per user, and only the server can ask who to notify", async () => {
    expect(rowsOf(await owner.client.from("notification_preferences").select("*"))).toHaveLength(0);
    expect((await prefs(owner, { c: true, r: true })).error).toBeNull();
    expect((await prefs(editor, { a: true })).error).toBeNull();
    const own = rowsOf(await owner.client.from("notification_preferences").select("client_completed, approval_received, referral_received"));
    expect(own).toEqual([{ client_completed: true, approval_received: false, referral_received: true }]);
    expect(wasBlocked(await owner.client.from("notification_preferences").update({ approval_received: true }).eq("user_id", owner.id).select())).toBe(true);
    expect((await prefs(outsider, { c: true })).error).not.toBeNull();

    for (const client of [anon, owner.client]) expect(wasBlocked(await client.rpc("push_targets", { ws, event: "client_completed" }))).toBe(true);
    expect(wasBlocked(await owner.client.rpc("remove_push_subscription", { sub: "00000000-0000-4000-8000-000000000000" }))).toBe(true);
  });
});

describe("notifyWorkspace", () => {
  async function setup() {
    await admin.from("push_subscriptions").delete().in("user_id", [owner.id, editor.id]);
    expect((await save(owner, { endpoint: endpoint("o") })).error).toBeNull();
    expect((await save(editor, { endpoint: endpoint("e") })).error).toBeNull();
  }

  it("sends only to members who switched the event on, with the generic message", async () => {
    await setup();
    await prefs(owner, { c: true });
    await prefs(editor, { a: true });
    const { sender, calls } = recorder();
    const summary = await notifyWorkspace({ admin, sender, title: "Proof Engine" }, ws, "client_completed");
    expect(summary).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].payload)).toEqual({ title: "Proof Engine", body: PUSH_MESSAGES.client_completed.body, url: "/app/requests" });
    const { data: ownerSub } = await admin.from("push_subscriptions").select("endpoint").eq("user_id", owner.id);
    expect(calls[0].endpoint).toBe(ownerSub?.[0].endpoint);

    expect((await notifyWorkspace({ admin, sender: recorder().sender, title: "x" }, ws, "referral_received")).sent).toBe(0);
    expect((await notifyWorkspace({ admin, sender: null, title: "x" }, ws, "client_completed")).sent).toBe(0);
  });

  it("deletes subscriptions the push service reports gone (404, 410), keeps ones that merely failed", async () => {
    await setup();
    await prefs(owner, { c: true });
    await prefs(editor, { c: true });
    const { data: subs } = await admin.from("push_subscriptions").select("id, user_id").in("user_id", [owner.id, editor.id]);
    const ownerSubId = String(subs?.find((s) => s.user_id === owner.id)?.id);
    const gone = recorder((t) => (t.id === ownerSubId ? 410 : 503));
    const summary = await notifyWorkspace({ admin, sender: gone.sender, title: "x" }, ws, "client_completed");
    expect(summary).toEqual({ sent: 0, removed: 1, failed: 1 });
    expect((await admin.from("push_subscriptions").select("id").eq("id", ownerSubId)).data).toHaveLength(0);
    expect((await admin.from("push_subscriptions").select("id").eq("user_id", editor.id)).data).toHaveLength(1);
    const notFound = recorder(() => 404);
    expect((await notifyWorkspace({ admin, sender: notFound.sender, title: "x" }, ws, "client_completed")).removed).toBe(1);
  });

  it("never contacts an endpoint outside the push services, even if one got into the table", async () => {
    await setup();
    await prefs(owner, { c: true });
    await admin.from("push_subscriptions").update({ endpoint: "https://169.254.169.254/latest/meta-data/xxxx" }).eq("user_id", owner.id);
    const { sender, calls } = recorder();
    const summary = await notifyWorkspace({ admin, sender, title: "x" }, ws, "client_completed");
    expect(calls.map((c) => c.endpoint)).not.toContain("https://169.254.169.254/latest/meta-data/xxxx");
    expect(summary.removed).toBeGreaterThanOrEqual(1);
  });

  it("never throws when the sender or database misbehaves", async () => {
    await setup();
    await prefs(owner, { c: true });
    const exploding: PushSender = { async send() { throw new Error("network"); } };
    await expect(notifyWorkspace({ admin, sender: exploding, title: "x" }, ws, "client_completed")).resolves.toMatchObject({ failed: 1 });
  });
});
