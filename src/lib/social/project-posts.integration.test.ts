/** Project posts and carousels against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiClient } from "@/lib/ai/client";
import { createClientRecord, createProjectRecord, addProjectFeedback, updateProjectRecord } from "@/lib/clients/service";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { discardProjectPost, editProjectPost, generateProjectPosts } from "./project-posts";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let wsOther: string;
let projectId: string;
let emptyProjectId: string;
const users: string[] = [];

const aiReturning = (posts: unknown[]): AiClient => ({ complete: async () => ({ text: JSON.stringify({ posts }), inputTokens: 1, outputTokens: 1 }) });
const GOOD = [
  { network: "linkedin", kind: "post", body: "We rebuilt a website and bookings rose 40% in 3 months." },
  { network: "linkedin", kind: "carousel", body: "A rebuild story", slides: [{ kind: "title", heading: "Rebuilt", body: "" }, { kind: "quote", heading: "", body: "our phone now rings every day" }, { kind: "cta", heading: "Say hello", body: "" }] },
  { network: "x", kind: "post", body: "Bookings rose 90%." },
];

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, viewer, outsider] = await Promise.all(["pp-owner", "pp-viewer", "pp-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Posts Co", type: "agency" })).data);
  wsOther = String((await outsider.client.rpc("create_workspace", { name: "Other Co", type: "agency" })).data);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
  const ctx = { workspaceId: ws, userId: owner.id };
  const client = await createClientRecord(owner.client, ctx, { name: "Acme" });
  if (!client.ok) throw new Error("setup");
  const project = await createProjectRecord(owner.client, ctx, client.id, { name: "Site rebuild", summary: "We rebuilt their website and booking flow.", key_facts: "Bookings went up 40% in 3 months." });
  const empty = await createProjectRecord(owner.client, ctx, client.id, { name: "Nothing written yet" });
  if (!project.ok || !empty.ok) throw new Error("setup");
  projectId = project.id;
  emptyProjectId = empty.id;
  await addProjectFeedback(owner.client, ctx, projectId, { body: "The new site is fast and our phone now rings every day.", source: "client", author_name: "Dana" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, wsOther]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

const gen = (client: SupabaseClient, user: TestUser, w: string, id: string, body: unknown = { networks: ["linkedin", "x"], attested: true }, posts = GOOD) =>
  generateProjectPosts({ supabase: client, ai: aiReturning(posts) }, { workspaceId: w, userId: user.id }, id, body);
const rows = async () => (await admin.from("project_posts").select("id, network, kind, status, attested, slides").eq("project_id", projectId).order("created_at")).data ?? [];

describe("generating", () => {
  it("saves only verified items, attested, and replaces old drafts but keeps saved ones", async () => {
    const first = await gen(owner.client, owner, ws, projectId);
    expect(first).toEqual({ ok: true, created: 3 - 1, dropped: 1 }); // "Bookings rose 90%" is not in the sources
    const saved = await rows();
    expect(saved.map((r) => `${r.network}:${r.kind}`)).toEqual(["linkedin:post", "linkedin:carousel"]);
    expect(saved.every((r) => r.attested === true && r.status === "draft")).toBe(true);
    expect((saved[1].slides as unknown[]).length).toBe(3);

    await owner.client.from("project_posts").update({ status: "saved" }).eq("id", String(saved[0].id));
    expect((await gen(owner.client, owner, ws, projectId)).ok).toBe(true);
    const after = await rows();
    expect(after.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(after).toHaveLength(3); // the kept one plus two fresh drafts
  });

  it("needs the attestation, real networks, some facts, and a project in your own workspace", async () => {
    expect(await gen(owner.client, owner, ws, projectId, { networks: ["linkedin"], attested: false })).toMatchObject({ ok: false, error: "invalid" });
    expect(await gen(owner.client, owner, ws, projectId, { networks: ["myspace"], attested: true })).toMatchObject({ ok: false, error: "invalid" });
    expect(await gen(owner.client, owner, ws, projectId, { networks: [], attested: true })).toMatchObject({ ok: false, error: "invalid" });
    expect(await gen(owner.client, owner, ws, projectId, { networks: ["x"], attested: true, extra: 1 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await gen(owner.client, owner, ws, emptyProjectId)).toEqual({ ok: false, error: "no_facts" });
    expect(await gen(outsider.client, outsider, wsOther, projectId)).toEqual({ ok: false, error: "not_found" });
    const viewerTry = await gen(viewer.client, viewer, ws, projectId);
    expect(viewerTry.ok).toBe(false);
    expect(await gen(owner.client, owner, ws, projectId, { networks: ["linkedin"], attested: true }, [{ network: "linkedin", kind: "post", body: "Up 77%" }])).toEqual({ ok: false, error: "no_items" });
  });
});

describe("editing", () => {
  it("re-checks edits against the project's typed sources", async () => {
    await gen(owner.client, owner, ws, projectId);
    const [post, carousel] = (await rows()).filter((r) => r.status === "draft");
    expect(await editProjectPost(owner.client, post.id, { body: "We rebuilt a site; bookings rose 40% in 3 months." })).toEqual({ ok: true });
    expect(await editProjectPost(owner.client, post.id, { body: "Bookings rose 41%." })).toEqual({ ok: false, error: "unverified" });
    expect(await editProjectPost(owner.client, post.id, { body: 'They said "our phone rings all night".' })).toEqual({ ok: false, error: "unverified" });
    expect(await editProjectPost(owner.client, post.id, { body: "See https://example.com" })).toEqual({ ok: false, error: "unverified" });
    expect(await editProjectPost(owner.client, post.id, { slides: [{ kind: "title", heading: "x", body: "" }, { kind: "point", heading: "y", body: "" }] })).toEqual({ ok: false, error: "unverified" }); // not a carousel
    expect(await editProjectPost(owner.client, carousel.id, { slides: [{ kind: "title", heading: "Fresh start", body: "" }, { kind: "quote", heading: "", body: '"our phone now rings every day"' }] })).toEqual({ ok: true });
    expect(await editProjectPost(owner.client, carousel.id, { slides: [{ kind: "title", heading: "x", body: "" }, { kind: "quote", heading: "", body: "We are the best in the world" }] })).toEqual({ ok: false, error: "unverified" });
    // the key facts the owner writes later become allowed numbers
    expect(await editProjectPost(owner.client, post.id, { body: "Calls rose 55%." })).toEqual({ ok: false, error: "unverified" });
    await updateProjectRecord(owner.client, projectId, { name: "Site rebuild", summary: "We rebuilt their website and booking flow.", key_facts: "Bookings up 40% in 3 months. Calls up 55%." });
    expect(await editProjectPost(owner.client, post.id, { body: "Calls rose 55%." })).toEqual({ ok: true });
  });

  it("status changes need no checks; others cannot touch the post; the database refuses broken rows", async () => {
    const [post] = (await rows()).filter((r) => r.status === "draft");
    expect(await editProjectPost(owner.client, post.id, { status: "posted" })).toEqual({ ok: true });
    expect(await editProjectPost(owner.client, post.id, { status: "gone" })).toEqual({ ok: false, error: "invalid" });
    expect(await editProjectPost(owner.client, post.id, {})).toEqual({ ok: false, error: "invalid" });
    expect(await editProjectPost(viewer.client, post.id, { status: "draft" })).toEqual({ ok: false, error: "not_found" });
    expect(await editProjectPost(outsider.client, post.id, { status: "draft" })).toEqual({ ok: false, error: "not_found" });
    expect(await discardProjectPost(outsider.client, post.id)).toEqual({ ok: false, error: "not_found" });

    const base = { workspace_id: ws, project_id: projectId, created_by: owner.id, network: "x", body: "hi", attested: true };
    expect((await owner.client.from("project_posts").insert({ ...base, kind: "carousel" }).select()).error).not.toBeNull(); // a carousel needs slides
    expect((await owner.client.from("project_posts").insert({ ...base, kind: "post", slides: [{}, {}] }).select()).error).not.toBeNull(); // a post has none
    expect((await owner.client.from("project_posts").insert({ ...base, kind: "post", attested: false }).select()).error).not.toBeNull(); // no attestation
    expect((await viewer.client.from("project_posts").insert({ ...base, created_by: viewer.id, kind: "post" }).select()).data ?? []).toHaveLength(0);
    expect(await discardProjectPost(owner.client, post.id)).toEqual({ ok: true });
  });
});
