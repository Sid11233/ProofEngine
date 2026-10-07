/** Demos against the real database (npm run test:isolation): roles, publish rules, the public view, append-only tables. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let adminUser: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let wsOther: string;
const users: string[] = [];

const scenes = { scenes: [{ id: "s1", type: "chat", persona: { name: "Ava", role: "Support" }, messages: [{ from: "user", text: "Hi", delayMs: 0 }], choices: [] }] };

/** A draft made by the editor, ready (attested) or not. */
async function demo({ ready = true, content = scenes, plan }: { ready?: boolean; content?: unknown; plan?: string } = {}) {
  if (plan) await admin.from("workspaces").update({ plan }).eq("id", ws);
  const { data, error } = await editor.client.from("demos").insert({ workspace_id: ws, created_by: editor.id, title: "A demo", content }).select("id").single();
  if (error) throw new Error(error.message);
  const id = String(data?.id);
  if (ready) await editor.client.from("demos").update({ authenticity_attested: true, redaction_acknowledged: true }).eq("id", id);
  return id;
}
const publish = (user: TestUser, id: string, slug = `demo-${hex64().slice(0, 8)}`) => user.client.rpc("publish_demo", { demo: id, new_slug: slug });
const statusOf = async (id: string) => String((await admin.from("demos").select("status").eq("id", id).single()).data?.status);
const asset = (demoId: string, over: Record<string, unknown> = {}) => ({
  workspace_id: ws, demo_id: demoId, file_path: `${ws}/${demoId}/${randomUUID()}.webp`, kind: "screenshot", width: 800, height: 600, size_bytes: 12345, sha256: hex64(), ...over,
});

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, adminUser, editor, viewer, outsider] = await Promise.all(["dm-owner", "dm-admin", "dm-editor", "dm-viewer", "dm-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, adminUser.id, editor.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Demo Co", type: "agency" })).data);
  wsOther = String((await outsider.client.rpc("create_workspace", { name: "Other Demo Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: `dm-${hex64().slice(0, 8)}` }).eq("id", ws);
  await admin.from("workspace_members").insert([
    { workspace_id: ws, user_id: adminUser.id, role: "admin" },
    { workspace_id: ws, user_id: editor.id, role: "editor" },
    { workspace_id: ws, user_id: viewer.id, role: "viewer" },
  ]);
}, 120_000);

// Each test starts with nothing live, so the plan limit only matters where a test is about it.
beforeEach(async () => {
  await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
  await admin.from("demos").update({ status: "unpublished" }).eq("workspace_id", ws).eq("status", "published");
});

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, wsOther]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("who can do what", () => {
  it("editors create drafts only, and cannot set the status, the slug or the version", async () => {
    const id = await demo({ ready: false });
    expect(await statusOf(id)).toBe("draft");
    expect((await editor.client.from("demos").insert({ workspace_id: ws, created_by: editor.id, title: "x", status: "published" }).select()).error).not.toBeNull();
    for (const patch of [{ status: "published" }, { slug: "sneaky" }, { current_version: 9 }, { published_at: new Date().toISOString() }]) {
      expect(wasBlocked(await editor.client.from("demos").update(patch).eq("id", id).select()), JSON.stringify(patch)).toBe(true);
    }
    expect((await editor.client.from("demos").update({ title: "Renamed" }).eq("id", id).select("id")).data).toHaveLength(1);
  });

  it("a viewer and another workspace's owner cannot create or edit", async () => {
    const id = await demo({ ready: false });
    expect(wasBlocked(await viewer.client.from("demos").insert({ workspace_id: ws, created_by: viewer.id, title: "x" }).select())).toBe(true);
    expect((await viewer.client.from("demos").update({ title: "x" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await outsider.client.from("demos").select("id").eq("id", id)).data ?? []).toHaveLength(0);
    expect((await outsider.client.from("demos").update({ title: "x" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
  });
});

describe("publishing", () => {
  it("is admin and above only", async () => {
    const id = await demo();
    expect((await publish(editor, id)).error?.code).toBe("42501");
    expect((await publish(viewer, id)).error?.code).toBe("42501");
    expect((await publish(outsider, id)).error?.code).toBe("42501");
    expect((await publish({ client: anon } as unknown as TestUser, id)).error).not.toBeNull();
    expect(await statusOf(id)).toBe("draft");
  });

  it("needs both attestations", async () => {
    const id = await demo({ ready: false });
    expect((await publish(adminUser, id)).error?.message).toContain("publish_blocked:not_attested");
    await editor.client.from("demos").update({ authenticity_attested: true }).eq("id", id);
    expect((await publish(adminUser, id)).error?.message).toContain("publish_blocked:not_redacted");
    await editor.client.from("demos").update({ redaction_acknowledged: true }).eq("id", id);
    expect((await publish(adminUser, id)).error).toBeNull();
  });

  it("is blocked while a screenshot is flagged, and allowed once the owner resolves it", async () => {
    const id = await demo();
    const { data: a } = await admin.from("demo_assets").insert(asset(id, { flagged: true, flag_reason: "an email address" })).select("id").single();
    expect((await publish(adminUser, id)).error?.message).toContain("publish_blocked:flagged_assets");
    expect((await viewer.client.rpc("resolve_demo_asset", { asset: a?.id, how: "acknowledged" })).error?.code).toBe("42501");
    expect((await editor.client.rpc("resolve_demo_asset", { asset: a?.id, how: "something else" })).error).not.toBeNull();
    expect((await editor.client.rpc("resolve_demo_asset", { asset: a?.id, how: "blurred" })).error).toBeNull();
    expect((await admin.from("demo_assets").select("flagged, resolution").eq("id", a?.id).single()).data).toEqual({ flagged: false, resolution: "blurred" });
    expect((await publish(adminUser, id)).error).toBeNull();
  });

  it("needs a valid, unreserved slug and at least one scene", async () => {
    const id = await demo();
    for (const bad of ["admin", "a", "Has Space", "double--dash", "-lead"]) expect((await publish(adminUser, id, bad)).error, bad).not.toBeNull();
    expect(await statusOf(id)).toBe("draft");
    const empty = await demo({ content: { scenes: [] } });
    expect((await publish(adminUser, empty)).error?.message).toContain("publish_blocked:empty");
  });

  it("stops at the plan's limit of live demos, even for the service role", async () => {
    await admin.from("workspaces").update({ plan: "free" }).eq("id", ws);
    await admin.from("demos").update({ status: "unpublished" }).eq("workspace_id", ws).eq("status", "published");
    const first = await demo();
    expect((await publish(adminUser, first)).error).toBeNull();
    const second = await demo();
    expect((await publish(adminUser, second)).error?.message).toContain("publish_blocked:plan_limit");
    expect((await admin.from("demos").update({ status: "published", slug: "forced-demo" }).eq("id", second)).error?.message).toContain("publish_blocked");
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
    expect((await publish(adminUser, second)).error).toBeNull();
  });

  it("snapshots what went live, and a live demo cannot be edited until it is unpublished", async () => {
    const id = await demo();
    expect((await publish(adminUser, id, "snap-shot-demo")).data).toBe("snap-shot-demo");
    const { data: row } = await admin.from("demos").select("current_version, published_at, status").eq("id", id).single();
    expect(row).toMatchObject({ current_version: 2, status: "published" });
    expect(row?.published_at).not.toBeNull();
    expect((await admin.from("demo_versions").select("version, content").eq("demo_id", id)).data).toEqual([{ version: 2, content: scenes }]);
    expect((await editor.client.from("demos").update({ title: "Edited live" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await editor.client.rpc("unpublish_demo", { demo: id })).error?.code).toBe("42501");
    expect((await adminUser.client.rpc("unpublish_demo", { demo: id })).error).toBeNull();
    expect(await statusOf(id)).toBe("unpublished");
    expect((await editor.client.from("demos").update({ title: "Edited after" }).eq("id", id).select("id")).data).toHaveLength(1);
  });

  it("writes the audit trail", async () => {
    const id = await demo();
    await publish(adminUser, id);
    await adminUser.client.rpc("unpublish_demo", { demo: id });
    const actions = ((await admin.from("audit_log").select("action").eq("target", id)).data ?? []).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["demo.publish", "demo.unpublish"]));
  });
});

describe("blocking", () => {
  it("only the server can block; a blocked demo cannot be published, deleted or edited, and leaves the public view", async () => {
    const id = await demo();
    await publish(adminUser, id, "blockable-demo");
    expect((await anon.from("public_demos").select("slug").eq("slug", "blockable-demo")).data).toHaveLength(1);

    expect((await owner.client.rpc("set_demo_blocked", { demo: id, blocked: true })).error).not.toBeNull();
    expect((await admin.rpc("set_demo_blocked", { demo: id, blocked: true })).error).toBeNull();
    expect(await statusOf(id)).toBe("blocked");
    expect((await anon.from("public_demos").select("slug").eq("slug", "blockable-demo")).data ?? []).toHaveLength(0);
    expect((await publish(adminUser, id)).error).not.toBeNull();
    expect((await adminUser.client.from("demos").delete().eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await editor.client.from("demos").update({ title: "x" }).eq("id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await admin.from("demos").update({ status: "draft" }).eq("id", id)).error?.message).toContain("publish_blocked");

    expect((await admin.rpc("set_demo_blocked", { demo: id, blocked: false })).error).toBeNull();
    expect(await statusOf(id)).toBe("unpublished");
  });
});

describe("the public view", () => {
  it("shows anonymous visitors only published demos, with only public-safe columns", async () => {
    const live = await demo();
    await publish(adminUser, live, "visible-demo");
    const draft = await demo();
    await admin.from("demos").update({ settings: { lead_gate: "start", allow_embed: true, cta_text: "Book", cta_url: "https://example.com" } }).eq("id", live);
    await admin.from("demo_embed_origins").insert({ demo_id: live, workspace_id: ws, origin: "https://customer.example" });
    await admin.from("demo_embed_origins").insert({ demo_id: draft, workspace_id: ws, origin: "https://hidden.example" });

    const { data } = await anon.from("public_demos").select("*").eq("slug", "visible-demo");
    expect(data).toHaveLength(1);
    expect(Object.keys(data?.[0] ?? {}).sort()).toEqual(["content", "embed_origins", "id", "published_at", "settings", "show_badge", "slug", "theme", "title", "workspace_slug"]);
    expect(data?.[0].embed_origins).toEqual(["https://customer.example"]);
    expect((await anon.from("public_demos").select("title").eq("id", draft)).data ?? []).toHaveLength(0);
    // Not the tables.
    for (const table of ["demos", "demo_versions", "demo_assets", "demo_embed_origins", "demo_leads", "demo_events", "demo_reports"]) {
      expect(wasBlocked(await anon.from(table).select("*").limit(1)), table).toBe(true);
    }
  });

  it("lists no embed origins unless embedding is switched on", async () => {
    const id = await demo();
    await publish(adminUser, id, "no-embed-demo");
    await admin.from("demo_embed_origins").insert({ demo_id: id, workspace_id: ws, origin: "https://customer.example" });
    expect((await anon.from("public_demos").select("embed_origins").eq("slug", "no-embed-demo").single()).data?.embed_origins).toEqual([]);
  });
});

describe("append-only tables", () => {
  it("snapshots and events reject update and delete for everyone, but go away with their demo", async () => {
    const id = await demo();
    await publish(adminUser, id);
    await admin.from("demo_events").insert({ workspace_id: ws, demo_id: id, type: "view" });
    for (const client of [admin, owner.client, adminUser.client]) {
      for (const table of ["demo_versions", "demo_events"]) {
        expect((await client.from(table).update({ type: "x", content: {} }).eq("demo_id", id)).error?.message ?? "blocked", `${table} update`).not.toBe("");
        const del = await client.from(table).delete().eq("demo_id", id).select();
        expect(del.error !== null || (del.data ?? []).length === 0, `${table} delete`).toBe(true);
      }
    }
    expect((await admin.from("demo_versions").select("id").eq("demo_id", id)).data?.length).toBe(1);
    expect((await admin.from("demo_events").select("id").eq("demo_id", id)).data?.length).toBe(1);
    await adminUser.client.rpc("unpublish_demo", { demo: id });
    expect((await adminUser.client.from("demos").delete().eq("id", id).select("id")).data).toHaveLength(1);
    expect((await admin.from("demo_versions").select("id").eq("demo_id", id)).data ?? []).toHaveLength(0);
    expect((await admin.from("demo_events").select("id").eq("demo_id", id)).data ?? []).toHaveLength(0);
  });

  it("clients cannot write events, versions or assets at all", async () => {
    const id = await demo();
    expect(wasBlocked(await owner.client.from("demo_events").insert({ workspace_id: ws, demo_id: id, type: "view" }).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("demo_versions").insert({ demo_id: id, workspace_id: ws, version: 9, content: {} }).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("demo_assets").insert(asset(id)).select())).toBe(true);
  });
});

describe("assets", () => {
  it("accepts only the {workspace}/{demo}/{uuid}.webp path, and at most 40 per demo", async () => {
    const id = await demo();
    expect((await admin.from("demo_assets").insert(asset(id, { file_path: `${ws}/${id}/evil.exe` }))).error).not.toBeNull();
    expect((await admin.from("demo_assets").insert(asset(id, { file_path: `${wsOther}/${id}/${randomUUID()}.webp` }))).error).not.toBeNull();
    expect((await admin.from("demo_assets").insert(asset(id, { size_bytes: 6_000_000 }))).error).not.toBeNull();
    expect((await admin.from("demo_assets").insert(asset(id, { kind: "svg" }))).error).not.toBeNull();
    const rows = Array.from({ length: 40 }, () => asset(id));
    expect((await admin.from("demo_assets").insert(rows)).error).toBeNull();
    expect((await admin.from("demo_assets").insert(asset(id))).error?.code).toBe("54000");
  });

  it("members can read their own, other workspaces cannot", async () => {
    const id = await demo();
    await admin.from("demo_assets").insert(asset(id));
    expect((await viewer.client.from("demo_assets").select("id").eq("demo_id", id)).data).toHaveLength(1);
    expect((await outsider.client.from("demo_assets").select("id").eq("demo_id", id)).data ?? []).toHaveLength(0);
  });
});

describe("embed origins, leads and reports", () => {
  it("origins: admins manage, others cannot, and only plain https origins are accepted", async () => {
    const id = await demo();
    const add = (user: TestUser, origin: string) => user.client.from("demo_embed_origins").insert({ demo_id: id, workspace_id: ws, origin }).select();
    expect((await add(adminUser, "https://customer.example")).error).toBeNull();
    expect(wasBlocked(await add(editor, "https://editor.example"))).toBe(true);
    for (const bad of ["http://insecure.example", "https://*.example.com", "https://example.com/path", "javascript:alert(1)", "https://exa mple.com", "example.com"]) {
      expect((await add(adminUser, bad)).error, bad).not.toBeNull();
    }
    expect((await add(adminUser, "https://customer.example")).error).not.toBeNull(); // duplicate
    for (let i = 0; i < 9; i++) expect((await add(adminUser, `https://site${i}.example`)).error).toBeNull();
    expect((await add(adminUser, "https://eleventh.example")).error?.code).toBe("54000");
    expect((await viewer.client.from("demo_embed_origins").select("id").eq("demo_id", id)).data).toHaveLength(10);
    expect((await adminUser.client.from("demo_embed_origins").delete().eq("demo_id", id).select("id")).data).toHaveLength(10);
  });

  it("leads: the server inserts them with consent; members read; only admins delete; no consent is rejected", async () => {
    const id = await demo();
    const lead = (over: Record<string, unknown> = {}) => ({ workspace_id: ws, demo_id: id, email: "lead@example.test", name: "Lee", consent: true, consent_text_version: "demo-lead-v1", step_reached: 2, ...over });
    expect((await admin.from("demo_leads").insert(lead())).error).toBeNull();
    expect((await admin.from("demo_leads").insert(lead({ consent: false }))).error).not.toBeNull();
    expect((await admin.from("demo_leads").insert(lead({ consent_text_version: "made-up" }))).error).not.toBeNull();
    expect((await admin.from("demo_leads").insert(lead({ email: "not-an-email" }))).error).not.toBeNull();
    expect(wasBlocked(await owner.client.from("demo_leads").insert(lead()).select())).toBe(true);
    expect((await viewer.client.from("demo_leads").select("email").eq("demo_id", id)).data).toHaveLength(1);
    expect((await outsider.client.from("demo_leads").select("email").eq("demo_id", id)).data ?? []).toHaveLength(0);
    expect((await editor.client.from("demo_leads").delete().eq("demo_id", id).select("id")).data ?? []).toHaveLength(0);
    expect((await adminUser.client.from("demo_leads").delete().eq("demo_id", id).select("id")).data).toHaveLength(1);
  });

  it("reports: no client can read or write them; the server can", async () => {
    const id = await demo();
    expect(wasBlocked(await owner.client.from("demo_reports").select("id"))).toBe(true);
    expect(wasBlocked(await owner.client.from("demo_reports").insert({ demo_id: id, reason: "x" }).select())).toBe(true);
    expect(wasBlocked(await anon.from("demo_reports").insert({ demo_id: id, reason: "x" }).select())).toBe(true);
    expect((await admin.from("demo_reports").insert({ demo_id: id, reason: "Looks like a phishing page", contact_email: "r@example.test" })).error).toBeNull();
    expect((await admin.from("demo_reports").insert({ demo_id: id, reason: "" })).error).not.toBeNull();
    expect((await admin.from("demo_reports").select("status").eq("demo_id", id).single()).data?.status).toBe("open");
  });
});

describe("a case study link", () => {
  it("must be one of the same workspace's case studies", async () => {
    const id = await demo();
    const { data: other } = await admin.from("case_studies").insert({ workspace_id: wsOther, content: {}, status: "draft" }).select("id").single();
    expect((await editor.client.from("demos").update({ case_study_id: other?.id }).eq("id", id).select("id")).error).not.toBeNull();
  });
});
