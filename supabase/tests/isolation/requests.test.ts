/** Proof request lifecycle (Phase 3.1) through the real REST API. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "./harness";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let otherWs: string;
const users: string[] = [];
const workspaces: string[] = [];

const create = (who: TestUser, hash = hex64(), workspace = ws, overrides: Record<string, unknown> = {}) =>
  who.client.rpc("create_proof_request", {
    ws: workspace,
    client_name: "Casey Client",
    client_email: "casey@example.test",
    project_type: "Website",
    flow_type: "agency",
    focus_outcomes: ["speed"],
    tone: "friendly",
    hash,
    ...overrides,
  });

const row = async (id: string) =>
  (await admin.from("proof_requests").select("*").eq("id", id).single()).data as Record<string, unknown>;
const actions = async (workspace = ws) =>
  ((await admin.from("audit_log").select("action,actor").eq("workspace_id", workspace)).data ?? []) as Array<{ action: string; actor: string }>;

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, editor, viewer, outsider] = await Promise.all(["r-owner", "r-editor", "r-viewer", "r-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, editor.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Req WS", type: "agency" })).data);
  otherWs = String((await outsider.client.rpc("create_workspace", { name: "Req Other", type: "saas" })).data);
  workspaces.push(ws, otherWs);
  // Most tests create many requests; the free-plan cap has its own test on a separate workspace.
  await admin.from("workspaces").update({ plan: "pro" }).in("id", [ws, otherWs]);
  await admin.from("workspace_members").insert([
    { workspace_id: ws, user_id: editor.id, role: "editor" },
    { workspace_id: ws, user_id: viewer.id, role: "viewer" },
  ]);
}, 120_000);

afterAll(async () => {
  if (!admin) return;
  for (const id of workspaces) await admin.from("workspaces").delete().eq("id", id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 60_000);

describe("create_proof_request", () => {
  it("lets editor+ create; blocks viewer, outsider and anonymous", async () => {
    expect((await create(editor)).error).toBeNull();
    for (const [who, label] of [[viewer, "viewer"], [outsider, "outsider"]] as const) {
      expect((await create(who)).error, `proof_requests: ${label} could create`).not.toBeNull();
    }
    expect((await anon.rpc("create_proof_request", { ws, client_name: "x", client_email: "x@e.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: hex64() })).error).not.toBeNull();
  });

  it("stores a hash, a 30 day expiry, draft status, and the creator", async () => {
    const hash = hex64();
    const id = String((await create(owner, hash)).data);
    const r = await row(id);
    expect(r).toMatchObject({ token_hash: hash, status: "draft", created_by: owner.id, workspace_id: ws, reminder_count: 0 });
    const days = (Date.parse(String(r.expires_at)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect((await actions()).some((a) => a.action === "request.create" && a.actor === owner.id)).toBe(true);
  });

  it("validates input: bad hash, unknown flow, more than three outcomes, bad email", async () => {
    expect((await create(owner, "not-a-hash")).error).not.toBeNull();
    expect((await create(owner, hex64(), ws, { flow_type: "custom" })).error).not.toBeNull();
    expect((await create(owner, hex64(), ws, { focus_outcomes: ["a", "b", "c", "d"] })).error).not.toBeNull();
    expect((await create(owner, hex64(), ws, { client_email: "no-at-sign" })).error).not.toBeNull();
    const dup = hex64();
    expect((await create(owner, dup)).error).toBeNull();
    expect((await create(owner, dup)).error, "duplicate token hash accepted").not.toBeNull();
  });

  it("cannot create in another workspace", async () => {
    expect((await create(owner, hex64(), otherWs)).error).not.toBeNull();
  });

  it("enforces the free plan limit of 3 interviews per month, per workspace", async () => {
    const cfg = loadLocalConfig();
    const solo = await createTestUser(cfg, admin, "r-limit");
    users.push(solo.id);
    const limited = String((await solo.client.rpc("create_workspace", { name: "Limited", type: "agency" })).data);
    workspaces.push(limited);

    for (let i = 0; i < 3; i++) expect((await create(solo, hex64(), limited)).error, `request ${i + 1} refused`).toBeNull();
    const fourth = await create(solo, hex64(), limited);
    expect(fourth.error?.code, "a fourth interview was allowed on the free plan").toBe("54000");
    const { data } = await admin.from("proof_requests").select("id").eq("workspace_id", limited);
    expect(data).toHaveLength(3);

    // Revoking does not hand the slot back, and other workspaces are unaffected.
    await solo.client.rpc("revoke_request", { request_id: data![0].id });
    expect((await create(solo, hex64(), limited)).error?.code).toBe("54000");
    expect((await create(outsider, hex64(), otherWs)).error).toBeNull();

    // A paid plan raises the cap.
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", limited);
    expect((await create(solo, hex64(), limited)).error).toBeNull();
  });
});

describe("direct writes are closed", () => {
  it("nobody can insert, or change status, revoked_at, token_hash, workspace_id or reminders directly", async () => {
    const id = String((await create(owner)).data);
    const before = await row(id);

    for (const who of [owner, editor]) {
      const ins = await who.client.from("proof_requests").insert({ workspace_id: ws, created_by: who.id, client_name: "x", client_email: "x@e.test", flow_type: "agency", token_hash: hex64(), expires_at: new Date(Date.now() + 86_400_000).toISOString() }).select();
      expect(wasBlocked(ins), "direct insert possible").toBe(true);
      for (const patch of [{ status: "completed" }, { revoked_at: null }, { token_hash: hex64() }, { workspace_id: otherWs }, { reminder_count: 0 }, { expires_at: new Date(Date.now() + 86_400_000 * 80).toISOString() }]) {
        const upd = await who.client.from("proof_requests").update(patch).eq("id", id).select();
        expect(wasBlocked(upd), `direct update of ${Object.keys(patch)[0]} possible`).toBe(true);
      }
    }
    expect(await row(id)).toEqual(before);
  });

  it("editors can still correct descriptive fields; viewers cannot", async () => {
    const id = String((await create(owner)).data);
    expect(rowsOf(await editor.client.from("proof_requests").update({ tone: "formal" }).eq("id", id).select("id"))).toHaveLength(1);
    expect(wasBlocked(await viewer.client.from("proof_requests").update({ tone: "casual" }).eq("id", id).select("id"))).toBe(true);
  });
});

describe("rotate_request_token", () => {
  const rotate = (who: TestUser, id: string, purpose: string, hash = hex64()) =>
    who.client.rpc("rotate_request_token", { request_id: id, new_hash: hash, purpose });

  it("send: draft -> sent, replaces the token, audited; blocked for viewer and outsider", async () => {
    const oldHash = hex64();
    const id = String((await create(owner, oldHash)).data);
    for (const who of [viewer, outsider]) expect((await rotate(who, id, "send")).error, "non-editor sent").not.toBeNull();
    expect(await row(id)).toMatchObject({ status: "draft", token_hash: oldHash });

    const newHash = hex64();
    expect((await rotate(editor, id, "send", newHash)).error).toBeNull();
    expect(await row(id)).toMatchObject({ status: "sent", token_hash: newHash });
    expect((await actions()).some((a) => a.action === "request.send" && a.actor === editor.id)).toBe(true);
  });

  it("remind: only for sent requests, max 3, at least 48 hours apart", async () => {
    const id = String((await create(owner)).data);
    expect((await rotate(owner, id, "remind")).error, "reminded a draft").not.toBeNull();
    await rotate(owner, id, "send");

    expect((await rotate(owner, id, "remind")).error).toBeNull();
    expect((await rotate(owner, id, "remind")).error?.code, "reminder within 48 hours").toBe("54000");

    for (const n of [2, 3]) {
      await admin.from("proof_requests").update({ last_reminder_at: new Date(Date.now() - 49 * 3600_000).toISOString() }).eq("id", id);
      expect((await rotate(owner, id, "remind")).error, `reminder ${n} refused`).toBeNull();
    }
    await admin.from("proof_requests").update({ last_reminder_at: new Date(Date.now() - 49 * 3600_000).toISOString() }).eq("id", id);
    expect((await rotate(owner, id, "remind")).error?.code, "a fourth reminder was allowed").toBe("54000");
    expect((await row(id)).reminder_count).toBe(3);
  });

  it("remind: refused once the interview has started, was revoked, or has expired", async () => {
    for (const patch of [{ status: "started" }, { status: "revoked", revoked_at: new Date().toISOString() }, { expires_at: new Date(Date.now() - 1000).toISOString() }]) {
      const id = String((await create(owner)).data);
      await rotate(owner, id, "send");
      await admin.from("proof_requests").update(patch).eq("id", id);
      expect((await rotate(owner, id, "remind")).error, `reminded despite ${JSON.stringify(patch)}`).not.toBeNull();
    }
  });

  it("regenerate: replaces the token, revives revoked links, keeps completed ones closed", async () => {
    const id = String((await create(owner)).data);
    await rotate(owner, id, "send");
    await owner.client.rpc("revoke_request", { request_id: id });
    expect(await row(id)).toMatchObject({ status: "revoked" });

    const fresh = hex64();
    expect((await rotate(editor, id, "regenerate", fresh)).error).toBeNull();
    const r = await row(id);
    expect(r).toMatchObject({ status: "draft", token_hash: fresh, revoked_at: null });
    expect((await actions()).some((a) => a.action === "token.regenerate" && a.actor === editor.id)).toBe(true);

    await admin.from("proof_requests").update({ status: "completed" }).eq("id", id);
    expect((await rotate(owner, id, "regenerate")).error, "completed request regenerated").not.toBeNull();
    expect((await rotate(owner, id, "send")).error).not.toBeNull();
  });

  it("rejects an unknown purpose, a malformed hash, an unknown id and another workspace's request", async () => {
    const id = String((await create(owner)).data);
    expect((await rotate(owner, id, "resurrect")).error).not.toBeNull();
    expect((await rotate(owner, id, "send", "short")).error).not.toBeNull();
    expect((await rotate(owner, crypto.randomUUID(), "send")).error).not.toBeNull();
    expect((await rotate(outsider, id, "regenerate")).error, "cross-tenant rotation").not.toBeNull();
  });
});

describe("revoke_request", () => {
  it("editor+ can revoke (audited); viewer and outsider cannot; completed ones cannot be revoked", async () => {
    const id = String((await create(owner)).data);
    for (const who of [viewer, outsider]) {
      expect((await who.client.rpc("revoke_request", { request_id: id })).error, "non-editor revoked").not.toBeNull();
    }
    expect((await editor.client.rpc("revoke_request", { request_id: id })).error).toBeNull();
    const r = await row(id);
    expect(r.status).toBe("revoked");
    expect(r.revoked_at).not.toBeNull();
    expect((await actions()).some((a) => a.action === "token.revoke" && a.actor === editor.id)).toBe(true);

    const done = String((await create(owner)).data);
    await admin.from("proof_requests").update({ status: "completed" }).eq("id", done);
    expect((await owner.client.rpc("revoke_request", { request_id: done })).error).not.toBeNull();
  });
});

describe("system question flows", () => {
  it("are seeded for agency and saas with six questions each, and readable when signed in", async () => {
    for (const type of ["agency", "saas"]) {
      const res = await owner.client.from("question_flows").select("questions").is("workspace_id", null).eq("type", type);
      const flows = rowsOf(res);
      expect(flows.length, `no system flow for ${type}`).toBeGreaterThanOrEqual(1);
      const questions = flows[0].questions as Array<{ id: string; text: string }>;
      expect(questions).toHaveLength(6);
      expect(new Set(questions.map((q) => q.id)).size).toBe(6);
    }
    expect(rowsOf(await anon.from("question_flows").select("id"))).toHaveLength(0);
  });
});
