/**
 * Invitations, role changes and removal (Phase 2.3), through the real REST API.
 * Every rule is checked for the roles that must NOT be able to do it, as well as
 * the ones that must.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, rowsOf, wasBlocked, type LocalConfig, type TestUser } from "./harness";

let cfg: LocalConfig;
let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let owner2: TestUser;
let adm: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let otherWs: string;
const workspaces: string[] = [];
const users: string[] = [];

const newToken = () => {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: createHash("sha256").update(raw).digest("hex") };
};

const invite = (who: TestUser, email: string, role: string, hash = newToken().hash, workspace = ws) =>
  who.client.rpc("create_invite", { ws: workspace, invite_email: email, invite_role: role, hash });

const roleOf = async (id: string, workspace = ws) =>
  (await admin.from("workspace_members").select("role").eq("workspace_id", workspace).eq("user_id", id).maybeSingle()).data?.role ?? null;

const auditActions = async (workspace = ws) =>
  ((await admin.from("audit_log").select("action,actor").eq("workspace_id", workspace)).data ?? []) as Array<{ action: string; actor: string }>;

beforeAll(async () => {
  cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, owner2, adm, editor, viewer, outsider] = await Promise.all(
    ["t-owner", "t-owner2", "t-admin", "t-editor", "t-viewer", "t-outsider"].map((l) => createTestUser(cfg, admin, l)),
  );
  users.push(owner.id, owner2.id, adm.id, editor.id, viewer.id, outsider.id);

  ws = String((await owner.client.rpc("create_workspace", { name: "Team WS", type: "agency" })).data);
  otherWs = String((await outsider.client.rpc("create_workspace", { name: "Other WS", type: "agency" })).data);
  workspaces.push(ws, otherWs);

  await admin.from("workspace_members").insert([
    { workspace_id: ws, user_id: adm.id, role: "admin" },
    { workspace_id: ws, user_id: editor.id, role: "editor" },
    { workspace_id: ws, user_id: viewer.id, role: "viewer" },
  ]);
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const id of workspaces) await admin.from("workspaces").delete().eq("id", id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("create_invite", () => {
  it("lets an owner and an admin invite; blocks editor, viewer, outsider and anonymous", async () => {
    expect((await invite(owner, "new1@example.test", "editor")).error).toBeNull();
    expect((await invite(adm, "new2@example.test", "viewer")).error).toBeNull();
    for (const [who, label] of [[editor, "editor"], [viewer, "viewer"], [outsider, "outsider"]] as const) {
      const res = await invite(who, `blocked-${label}@example.test`, "viewer");
      expect(res.error, `workspace_invites: ${label} could create an invite`).not.toBeNull();
    }
    expect((await anon.rpc("create_invite", { ws, invite_email: "x@example.test", invite_role: "viewer", hash: newToken().hash })).error).not.toBeNull();
  });

  it("never invites an owner, and only an owner can invite an admin", async () => {
    expect((await invite(owner, "o@example.test", "owner")).error, "owner invites are possible").not.toBeNull();
    expect((await invite(adm, "a@example.test", "admin")).error, "an admin invited an admin").not.toBeNull();
    expect((await invite(owner, "a2@example.test", "admin")).error).toBeNull();
    expect((await invite(owner, "bogus@example.test", "superuser")).error).not.toBeNull();
  });

  it("rejects a malformed token hash, a duplicate pending invite and an existing member", async () => {
    expect((await invite(owner, "bad@example.test", "viewer", "not-a-hash")).error).not.toBeNull();
    expect((await invite(owner, "dup@example.test", "viewer")).error).toBeNull();
    expect((await invite(owner, "DUP@example.test", "viewer")).error, "duplicate pending invite allowed").not.toBeNull();
    const member = await invite(owner, viewer.email.toUpperCase(), "viewer");
    expect(member.error, "an existing member can be invited").not.toBeNull();
  });

  it("writes an audit entry attributed to the caller", async () => {
    await invite(adm, "audited@example.test", "viewer");
    const entry = (await auditActions()).find((e) => e.action === "invite.create" && e.actor === adm.id);
    expect(entry, "audit_log: invite.create missing").toBeDefined();
  });

  it("only admin+ can list invites, and never sees token hashes", async () => {
    // Column grants exclude token_hash, so callers must name their columns: `select *` is refused.
    const asAdmin = await adm.client.from("workspace_invites").select("id,email,role,expires_at,accepted_at");
    expect(rowsOf(asAdmin).length).toBeGreaterThan(0);
    expect((await adm.client.from("workspace_invites").select("*")).error, "workspace_invites: select * exposes token_hash").not.toBeNull();
    expect((await adm.client.from("workspace_invites").select("token_hash")).error).not.toBeNull();
    for (const [who, label] of [[editor, "editor"], [viewer, "viewer"], [outsider, "outsider"]] as const) {
      expect(rowsOf(await who.client.from("workspace_invites").select("id")), `workspace_invites: ${label} can read`).toHaveLength(0);
    }
    expect(rowsOf(await anon.from("workspace_invites").select("id"))).toHaveLength(0);
  });

  it("cannot be written directly by anyone", async () => {
    const t = newToken();
    for (const who of [owner, adm, editor]) {
      const ins = await who.client.from("workspace_invites").insert({ workspace_id: ws, email: "direct@example.test", role: "viewer", token_hash: t.hash }).select();
      expect(wasBlocked(ins), "workspace_invites: direct insert possible").toBe(true);
      const del = await who.client.from("workspace_invites").delete().eq("workspace_id", ws).select();
      expect(wasBlocked(del), "workspace_invites: direct delete possible").toBe(true);
      const upd = await who.client.from("workspace_invites").update({ role: "admin" }).eq("workspace_id", ws).select();
      expect(wasBlocked(upd), "workspace_invites: direct update possible").toBe(true);
    }
  });
});

describe("accept_invite", () => {
  async function makeInvitee(label: string, role: string) {
    const user = await createTestUser(cfg, admin, label);
    users.push(user.id);
    const token = newToken();
    const created = await invite(owner, user.email, role, token.hash);
    expect(created.error).toBeNull();
    return { user, token };
  }

  it("adds the invitee with the invited role, exactly once", async () => {
    const { user, token } = await makeInvitee("acc-ok", "editor");

    const preview = await user.client.rpc("get_invite_preview", { hash: token.hash });
    expect(rowsOf(preview)).toEqual([{ workspace_name: "Team WS", role: "editor" }]);

    expect((await user.client.rpc("accept_invite", { hash: token.hash })).error).toBeNull();
    expect(await roleOf(user.id)).toBe("editor");
    expect((await auditActions()).some((e) => e.action === "invite.accept" && e.actor === user.id)).toBe(true);

    // Single use: a second attempt (even by the same person) fails.
    expect((await user.client.rpc("accept_invite", { hash: token.hash })).error, "invite accepted twice").not.toBeNull();
    expect(rowsOf(await user.client.rpc("get_invite_preview", { hash: token.hash }))).toHaveLength(0);
  });

  it("refuses a different account, and does not burn the invite", async () => {
    const { user, token } = await makeInvitee("acc-wrong", "viewer");
    expect((await outsider.client.rpc("accept_invite", { hash: token.hash })).error, "wrong account accepted").not.toBeNull();
    expect(await roleOf(outsider.id)).toBeNull();
    expect(rowsOf(await outsider.client.rpc("get_invite_preview", { hash: token.hash })), "preview leaks to the wrong account").toHaveLength(0);
    // The intended person can still use it.
    expect((await user.client.rpc("accept_invite", { hash: token.hash })).error).toBeNull();
  });

  it("rejects an expired invite", async () => {
    const { user, token } = await makeInvitee("acc-exp", "viewer");
    await admin.from("workspace_invites").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", token.hash);
    expect((await user.client.rpc("accept_invite", { hash: token.hash })).error, "expired invite accepted").not.toBeNull();
    expect(await roleOf(user.id)).toBeNull();
    // A fresh invite to the same address replaces the expired one.
    const second = newToken();
    expect((await invite(owner, user.email, "viewer", second.hash)).error).toBeNull();
    expect((await user.client.rpc("accept_invite", { hash: second.hash })).error).toBeNull();
  });

  it("rejects unknown tokens and anonymous callers", async () => {
    expect((await owner.client.rpc("accept_invite", { hash: newToken().hash })).error).not.toBeNull();
    expect((await anon.rpc("accept_invite", { hash: newToken().hash })).error).not.toBeNull();
    expect((await anon.rpc("get_invite_preview", { hash: newToken().hash })).error).not.toBeNull();
  });

  it("stores only a hash, never the raw token", async () => {
    const { user, token } = await makeInvitee("acc-hash", "viewer");
    const { data } = await admin.from("workspace_invites").select("*").eq("workspace_id", ws).eq("email", user.email);
    expect(JSON.stringify(data)).not.toContain(token.raw);
    expect(data?.[0]?.token_hash).toBe(token.hash);
  });
});

describe("revoke_invite", () => {
  it("admin+ can revoke (and it is audited); others cannot; a revoked link stops working", async () => {
    const user = await createTestUser(cfg, admin, "rev");
    users.push(user.id);
    const token = newToken();
    const id = String((await invite(owner, user.email, "viewer", token.hash)).data);

    for (const who of [editor, viewer, outsider]) {
      expect((await who.client.rpc("revoke_invite", { invite_id: id })).error, "non-admin revoked an invite").not.toBeNull();
    }
    expect((await adm.client.rpc("revoke_invite", { invite_id: id })).error).toBeNull();
    expect((await auditActions()).some((e) => e.action === "invite.revoke" && e.actor === adm.id)).toBe(true);
    expect((await user.client.rpc("accept_invite", { hash: token.hash })).error, "revoked invite accepted").not.toBeNull();
  });
});

describe("change_member_role", () => {
  it("is blocked for editors, viewers and outsiders, even against someone else", async () => {
    for (const who of [editor, viewer, outsider]) {
      const res = await who.client.rpc("change_member_role", { ws, member: viewer.id, new_role: "admin" });
      expect(res.error, "a non-admin changed a role").not.toBeNull();
    }
    expect(await roleOf(viewer.id)).toBe("viewer");
  });

  it("nobody can change their own role", async () => {
    for (const who of [owner, adm, editor]) {
      expect((await who.client.rpc("change_member_role", { ws, member: who.id, new_role: "owner" })).error, "self role change").not.toBeNull();
    }
  });

  it("an admin can move editors and viewers but cannot touch an owner or create one", async () => {
    expect((await adm.client.rpc("change_member_role", { ws, member: viewer.id, new_role: "editor" })).error).toBeNull();
    expect(await roleOf(viewer.id)).toBe("editor");
    await admin.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", viewer.id);

    expect((await adm.client.rpc("change_member_role", { ws, member: owner.id, new_role: "viewer" })).error, "admin demoted an owner").not.toBeNull();
    expect((await adm.client.rpc("change_member_role", { ws, member: editor.id, new_role: "owner" })).error, "admin created an owner").not.toBeNull();
    expect(await roleOf(owner.id)).toBe("owner");
    expect(await roleOf(editor.id)).toBe("editor");
  });

  it("an owner can create another owner, and the last owner cannot be demoted", async () => {
    await admin.from("workspace_members").insert({ workspace_id: ws, user_id: owner2.id, role: "viewer" });
    expect((await owner.client.rpc("change_member_role", { ws, member: owner2.id, new_role: "owner" })).error).toBeNull();
    expect(await roleOf(owner2.id)).toBe("owner");

    // Owner 2 demotes owner 1: fine while two owners exist. Then the sole owner cannot be demoted.
    expect((await owner2.client.rpc("change_member_role", { ws, member: owner.id, new_role: "admin" })).error).toBeNull();
    expect((await owner.client.rpc("change_member_role", { ws, member: owner2.id, new_role: "viewer" })).error, "an admin demoted the last owner").not.toBeNull();
    expect(await roleOf(owner2.id)).toBe("owner");
    await admin.from("workspace_members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", owner.id);
    // Leave a single owner behind for the tests that follow.
    await admin.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", owner2.id);
    expect(await roleOf(owner2.id)).toBe("viewer");
  });

  it("rejects unknown roles and unknown members, and is audited", async () => {
    expect((await owner.client.rpc("change_member_role", { ws, member: editor.id, new_role: "god" })).error).not.toBeNull();
    expect((await owner.client.rpc("change_member_role", { ws, member: outsider.id, new_role: "viewer" })).error, "changed a non-member").not.toBeNull();
    expect((await owner.client.rpc("change_member_role", { ws, member: editor.id, new_role: "viewer" })).error).toBeNull();
    expect((await auditActions()).some((e) => e.action === "member.role_change" && e.actor === owner.id)).toBe(true);
    await admin.from("workspace_members").update({ role: "editor" }).eq("workspace_id", ws).eq("user_id", editor.id);
  });
});

describe("remove_member", () => {
  it("is blocked for editors and viewers removing someone else", async () => {
    for (const who of [editor, viewer, outsider]) {
      expect((await who.client.rpc("remove_member", { ws, member: adm.id })).error, "a non-admin removed a member").not.toBeNull();
    }
    expect(await roleOf(adm.id)).toBe("admin");
  });

  it("an admin cannot remove an owner; an owner can remove an admin; removals are audited", async () => {
    expect((await adm.client.rpc("remove_member", { ws, member: owner.id })).error, "admin removed an owner").not.toBeNull();
    expect(await roleOf(owner.id)).toBe("owner");

    const temp = await createTestUser(cfg, admin, "rm-temp");
    users.push(temp.id);
    await admin.from("workspace_members").insert({ workspace_id: ws, user_id: temp.id, role: "admin" });
    expect((await owner.client.rpc("remove_member", { ws, member: temp.id })).error).toBeNull();
    expect(await roleOf(temp.id)).toBeNull();
    expect((await auditActions()).some((e) => e.action === "member.remove" && e.actor === owner.id)).toBe(true);
  });

  it("anyone can leave, a removed user loses access immediately, and the last owner cannot leave", async () => {
    const temp = await createTestUser(cfg, admin, "rm-leave");
    users.push(temp.id);
    await admin.from("workspace_members").insert({ workspace_id: ws, user_id: temp.id, role: "viewer" });
    expect(rowsOf(await temp.client.from("workspaces").select("id").eq("id", ws))).toHaveLength(1);
    expect((await temp.client.rpc("remove_member", { ws, member: temp.id })).error).toBeNull();
    expect(rowsOf(await temp.client.from("workspaces").select("id").eq("id", ws)), "access remains after leaving").toHaveLength(0);
    expect((await auditActions()).some((e) => e.action === "member.leave" && e.actor === temp.id)).toBe(true);

    // owner is the only owner again at this point
    expect((await owner.client.rpc("remove_member", { ws, member: owner.id })).error, "last owner left").not.toBeNull();
    expect(await roleOf(owner.id)).toBe("owner");
  });

  it("cannot reach into another workspace", async () => {
    expect((await owner.client.rpc("remove_member", { ws: otherWs, member: outsider.id })).error).not.toBeNull();
    expect((await owner.client.rpc("change_member_role", { ws: otherWs, member: outsider.id, new_role: "viewer" })).error).not.toBeNull();
    expect((await invite(owner, "cross@example.test", "viewer", newToken().hash, otherWs)).error, "invited into another workspace").not.toBeNull();
    expect(await roleOf(outsider.id, otherWs)).toBe("owner");
  });
});

describe("list_team_members", () => {
  it("shows teammates to members only", async () => {
    const asViewer = await viewer.client.rpc("list_team_members", { ws });
    const rows = rowsOf(asViewer);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.map((r) => r.user_id)).toContain(owner.id);
    expect(rows[0].role, "owners should be listed first").toBe("owner");

    expect(rowsOf(await outsider.client.rpc("list_team_members", { ws })), "an outsider can list another team").toHaveLength(0);
    expect((await anon.rpc("list_team_members", { ws })).error).not.toBeNull();
  });
});
