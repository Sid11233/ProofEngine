/** The team service against a LOCAL Supabase, with a fake email sender (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type LocalConfig, type TestUser } from "../../../supabase/tests/isolation/harness";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { acceptInvite, changeMemberRole, inviteMember, listPendingInvites, listTeam, previewInvite, removeMember, revokeInvite } from "./service";

let cfg: LocalConfig;
let admin: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let invitee: TestUser;
let ws: string;
const users: string[] = [];
const APP = "https://app.example.test";

const recorder = (accepts = true) => {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = { async send(message) { sent.push(message); return accepts; } };
  return { sent, sender };
};

beforeAll(async () => {
  cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, editor, viewer, invitee] = await Promise.all(["svc-owner", "svc-editor", "svc-viewer", "svc-invitee"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, editor.id, viewer.id, invitee.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Service WS", type: "agency" })).data);
  await admin.from("workspace_members").insert([
    { workspace_id: ws, user_id: editor.id, role: "editor" },
    { workspace_id: ws, user_id: viewer.id, role: "viewer" },
  ]);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60_000);

describe("team service", () => {
  it("invites by email, never stores the raw token, and the emailed link works once", async () => {
    const { sent, sender } = recorder();
    const result = await inviteMember(owner.client, { workspaceId: ws, workspaceName: "Service WS", email: invitee.email, role: "editor" }, { appUrl: APP, sender });
    expect(result).toMatchObject({ ok: true, emailSent: true });
    if (!result.ok) return;

    const rawToken = new URL(result.link).pathname.split("/").pop()!;
    expect(rawToken).toHaveLength(43);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(invitee.email);
    expect(sent[0].text).toContain(result.link);
    expect(sent[0].text).not.toMatch(/<[a-z]/i);

    const { data } = await admin.from("workspace_invites").select("*").eq("workspace_id", ws);
    expect(JSON.stringify(data)).not.toContain(rawToken);

    expect(await previewInvite(invitee.client, rawToken)).toEqual({ workspaceName: "Service WS", role: "editor" });
    expect(await previewInvite(viewer.client, rawToken), "preview visible to a different account").toBeNull();
    expect(await acceptInvite(viewer.client, rawToken), "wrong account accepted").toBe(false);
    expect(await acceptInvite(invitee.client, rawToken)).toBe(true);
    expect(await acceptInvite(invitee.client, rawToken), "single-use invite accepted twice").toBe(false);
    expect((await listTeam(owner.client, ws)).map((m) => m.userId)).toContain(invitee.id);
  });

  it("reports an email failure without losing the invite, and refuses malformed tokens", async () => {
    const { sender } = recorder(false);
    const result = await inviteMember(owner.client, { workspaceId: ws, workspaceName: "Service WS", email: "nobody@example.test", role: "viewer" }, { appUrl: APP, sender });
    expect(result).toMatchObject({ ok: true, emailSent: false });
    expect(await inviteMember(owner.client, { workspaceId: ws, workspaceName: "x", email: "none2@example.test", role: "viewer" }, { appUrl: APP, sender: null })).toMatchObject({ ok: true, emailSent: false });
    expect(await previewInvite(owner.client, "short")).toBeNull();
    expect(await acceptInvite(owner.client, "../../etc/passwd")).toBe(false);
  });

  it("editors and viewers get 'forbidden' for every management call", async () => {
    for (const user of [editor, viewer]) {
      const invite = await inviteMember(user.client, { workspaceId: ws, workspaceName: "x", email: "x@example.test", role: "viewer" }, { appUrl: APP, sender: null });
      expect(invite).toEqual({ ok: false, error: "forbidden" });
      expect(await changeMemberRole(user.client, ws, owner.id, "viewer")).toEqual({ ok: false, error: "forbidden" });
      expect(await removeMember(user.client, ws, owner.id)).toEqual({ ok: false, error: "forbidden" });
      expect(await listPendingInvites(user.client), "non-admin can list invites").toEqual([]);
    }
    expect((await listTeam(owner.client, ws)).find((m) => m.userId === owner.id)?.role).toBe("owner");
  });

  it("reports duplicates, and lets an admin list and revoke pending invites", async () => {
    const again = await inviteMember(owner.client, { workspaceId: ws, workspaceName: "x", email: "nobody@example.test", role: "viewer" }, { appUrl: APP, sender: null });
    expect(again).toEqual({ ok: false, error: "conflict" });

    const pending = await listPendingInvites(owner.client);
    const target = pending.find((p) => p.email === "nobody@example.test");
    expect(target).toBeDefined();
    expect(await revokeInvite(editor.client, target!.id)).toEqual({ ok: false, error: "forbidden" });
    expect(await revokeInvite(owner.client, target!.id)).toEqual({ ok: true });
    expect((await listPendingInvites(owner.client)).some((p) => p.id === target!.id)).toBe(false);
    expect(await revokeInvite(owner.client, target!.id)).toEqual({ ok: false, error: "forbidden" });
  });
});
