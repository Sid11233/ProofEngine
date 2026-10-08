/** Clients and projects against the real database (npm run test:isolation): roles, workspace isolation, limits. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import * as records from "./service";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let wsOther: string;
const users: string[] = [];

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, viewer, outsider] = await Promise.all(["cp-owner", "cp-viewer", "cp-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Clients Co", type: "agency" })).data);
  wsOther = String((await outsider.client.rpc("create_workspace", { name: "Other Co", type: "agency" })).data);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, wsOther]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

const ctx = (u: TestUser, w: string) => ({ workspaceId: w, userId: u.id });

describe("clients and projects", () => {
  it("an editor builds a client, a project, links and feedback; text is stored clean", async () => {
    const c = await records.createClientRecord(owner.client, ctx(owner, ws), { name: " Acme ", contact_email: "boss@acme.test", website_url: "https://acme.test", notes: "Prefers​ email" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const p = await records.createProjectRecord(owner.client, ctx(owner, ws), c.id, { name: "Site rebuild", repo_url: "https://github.com/acme/site", status: "delivered", started_on: "2026-01-01", delivered_on: "2026-03-01" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(await records.addProjectLink(owner.client, ctx(owner, ws), p.id, { label: "Staging", url: "https://staging.acme.test" })).toEqual({ ok: true });
    expect(await records.addProjectFeedback(owner.client, ctx(owner, ws), p.id, { body: "Loved it <b>so</b> much", author_name: "Boss" })).toEqual({ ok: true });
    const { data: row } = await owner.client.from("clients").select("name, notes").eq("id", c.id).single();
    expect(row).toEqual({ name: "Acme", notes: "Prefers email" });
    const { data: fb } = await owner.client.from("project_feedback").select("body").eq("project_id", p.id);
    expect(fb).toEqual([{ body: "Loved it <b>so</b> much" }]); // plain text; rendered as text by the page

    // clearing an optional field really clears it
    expect(await records.updateClientRecord(owner.client, c.id, { name: "Acme", status: "paused" })).toEqual({ ok: true });
    const { data: after } = await owner.client.from("clients").select("contact_email, website_url, status").eq("id", c.id).single();
    expect(after).toEqual({ contact_email: null, website_url: null, status: "paused" });
  });

  it("invalid input is refused with field errors and nothing is stored", async () => {
    const bad = await records.createClientRecord(owner.client, ctx(owner, ws), { name: "", website_url: "http://x.com", extra: 1 });
    expect(bad).toMatchObject({ ok: false, error: "invalid" });
    const c = await records.createClientRecord(owner.client, ctx(owner, ws), { name: "Limits Co" });
    if (!c.ok) throw new Error("setup");
    const p = await records.createProjectRecord(owner.client, ctx(owner, ws), c.id, { name: "P" });
    if (!p.ok) throw new Error("setup");
    expect(await records.addProjectLink(owner.client, ctx(owner, ws), p.id, { label: "x", url: "javascript:alert(1)" })).toMatchObject({ ok: false, error: "invalid" });
    for (let i = 0; i < 20; i++) expect((await records.addProjectLink(owner.client, ctx(owner, ws), p.id, { label: `L${i}`, url: `https://e${i}.test` })).ok).toBe(true);
    expect(await records.addProjectLink(owner.client, ctx(owner, ws), p.id, { label: "21st", url: "https://e21.test" })).toEqual({ ok: false, error: "limit" });
  });

  it("viewers read but cannot write; other workspaces see nothing and cannot attach to it", async () => {
    const c = await records.createClientRecord(owner.client, ctx(owner, ws), { name: "Shared Co" });
    if (!c.ok) throw new Error("setup");
    expect((await viewer.client.from("clients").select("id").eq("id", c.id)).data).toHaveLength(1);
    expect(await records.createClientRecord(viewer.client, ctx(viewer, ws), { name: "Nope" })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await records.updateClientRecord(viewer.client, c.id, { name: "Renamed" })).toEqual({ ok: false, error: "not_found" });
    expect(await records.deleteClientRecord(viewer.client, c.id)).toEqual({ ok: false, error: "not_found" });

    expect((await outsider.client.from("clients").select("id").eq("id", c.id)).data).toHaveLength(0);
    // a project cannot be attached to someone else's client, even with the right workspace claimed
    expect(await records.createProjectRecord(outsider.client, ctx(outsider, wsOther), c.id, { name: "Sneaky" })).toEqual({ ok: false, error: "not_found" });
    expect(await records.createProjectRecord(outsider.client, ctx(outsider, ws), c.id, { name: "Sneaky" })).toMatchObject({ ok: false });
  });

  it("only admins delete a client, and its projects go with it", async () => {
    const c = await records.createClientRecord(owner.client, ctx(owner, ws), { name: "Gone Co" });
    if (!c.ok) throw new Error("setup");
    const p = await records.createProjectRecord(owner.client, ctx(owner, ws), c.id, { name: "Gone project" });
    if (!p.ok) throw new Error("setup");
    await admin.from("workspace_members").insert({ workspace_id: ws, user_id: outsider.id, role: "editor" });
    expect(await records.deleteClientRecord(outsider.client, c.id)).toEqual({ ok: false, error: "not_found" }); // editor: policy hides the row from delete
    expect(await records.deleteClientRecord(owner.client, c.id)).toEqual({ ok: true });
    expect((await admin.from("projects").select("id").eq("id", p.id)).data).toHaveLength(0);
    await admin.from("workspace_members").delete().eq("user_id", outsider.id).eq("workspace_id", ws);
  });
});
