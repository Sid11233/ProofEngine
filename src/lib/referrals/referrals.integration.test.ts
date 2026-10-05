/** Referral capture, notification and status changes against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { notifyReferrals } from "./notify";

let admin: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let referralId: string;

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, editor, viewer, outsider] = await Promise.all(["rf-owner", "rf-editor", "rf-viewer", "rf-out"].map((l) => createTestUser(cfg, admin, l)));
  ws = String((await owner.client.rpc("create_workspace", { name: "Referral Co", type: "agency" })).data);
  await admin.from("workspace_members").insert([{ workspace_id: ws, user_id: editor.id, role: "editor" }, { workspace_id: ws, user_id: viewer.id, role: "viewer" }]);
  const { data } = await admin.from("referrals").insert({ workspace_id: ws, referred_name: "Sam Lee", referred_contact: "sam@example.com" }).select("id").single();
  referralId = String(data?.id);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [owner, editor, viewer, outsider]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("referral visibility and status", () => {
  it("is visible to every member of the workspace and nobody else", async () => {
    for (const u of [owner, editor, viewer]) expect(rowsOf(await u.client.from("referrals").select("id, referred_contact").eq("id", referralId))).toHaveLength(1);
    expect(rowsOf(await outsider.client.from("referrals").select("id").eq("id", referralId))).toHaveLength(0);
    expect(rowsOf(await makeClient(loadLocalConfig(), "anon").from("referrals").select("id"))).toHaveLength(0);
  });

  it("can be moved along by editors and above, not by viewers or other workspaces, and only the status changes", async () => {
    expect(rowsOf(await editor.client.from("referrals").update({ status: "contacted" }).eq("id", referralId).select("id"))).toHaveLength(1);
    expect(rowsOf(await owner.client.from("referrals").update({ status: "won" }).eq("id", referralId).select("id"))).toHaveLength(1);
    expect(rowsOf(await viewer.client.from("referrals").update({ status: "dismissed" }).eq("id", referralId).select("id"))).toHaveLength(0);
    expect(rowsOf(await outsider.client.from("referrals").update({ status: "dismissed" }).eq("id", referralId).select("id"))).toHaveLength(0);
    expect(wasBlocked(await owner.client.from("referrals").update({ referred_contact: "evil@example.com" }).eq("id", referralId).select())).toBe(true);
    expect(rowsOf(await owner.client.from("referrals").update({ status: "bogus" }).eq("id", referralId).select())).toHaveLength(0);
    const { data } = await admin.from("referrals").select("status, referred_contact").eq("id", referralId).single();
    expect(data).toEqual({ status: "won", referred_contact: "sam@example.com" });
  });
});

describe("notifyReferrals", () => {
  it("emails the workspace owners and admins only, never the person referred", async () => {
    const sent: EmailMessage[] = [];
    const sender: EmailSender = { async send(m) { sent.push(m); return true; } };
    const n = await notifyReferrals({ admin, sender, appUrl: "https://app.example.com" }, ws, [{ name: "Sam Lee", contact: "sam@example.com" }]);
    expect(n).toBe(1);
    expect(sent.map((m) => m.to)).toEqual([owner.email.toLowerCase()]);
    expect(sent.some((m) => m.to === "sam@example.com")).toBe(false);
    expect(sent[0].text).toContain("Sam Lee (sam@example.com)");
  });

  it("does nothing without a sender or without referrals", async () => {
    expect(await notifyReferrals({ admin, sender: null, appUrl: "https://app.example.com" }, ws, [{ name: "A", contact: "a@example.com" }])).toBe(0);
    const sender: EmailSender = { async send() { throw new Error("must not send"); } };
    expect(await notifyReferrals({ admin, sender, appUrl: "https://app.example.com" }, ws, [])).toBe(0);
  });
});
