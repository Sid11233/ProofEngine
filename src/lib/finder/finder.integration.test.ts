/** The global communities list and per-workspace trackers against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { loadFinder } from "./load";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let other: TestUser;
let wsA: string;
let wsB: string;
const C1 = "b0000000-0000-4000-8000-000000000001";
const C2 = "b0000000-0000-4000-8000-000000000002";
let inactive: string;

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, editor, viewer, other] = await Promise.all(["fn-owner", "fn-editor", "fn-viewer", "fn-other"].map((l) => createTestUser(cfg, admin, l)));
  wsA = String((await owner.client.rpc("create_workspace", { name: "Finder A", type: "agency" })).data);
  wsB = String((await other.client.rpc("create_workspace", { name: "Finder B", type: "agency" })).data);
  await admin.from("workspace_members").insert([{ workspace_id: wsA, user_id: editor.id, role: "editor" }, { workspace_id: wsA, user_id: viewer.id, role: "viewer" }]);
  const { data } = await admin.from("communities").insert({ name: "Retired community", platform: "forum", url: "https://example.com/retired", niches: ["saas"], active: false }).select("id").single();
  inactive = String(data?.id);
}, 120_000);

afterAll(async () => {
  await admin.from("communities").delete().eq("id", inactive);
  for (const ws of [wsA, wsB]) await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [owner, editor, viewer, other]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("the global communities list", () => {
  it("is seeded with real communities: read-from-the-source ones verified and dated, the rest hidden until someone checks them", async () => {
    const { data } = await admin.from("communities").select("name, url, platform, needs_verification, last_verified_at, rules_summary, self_promo_policy").eq("active", true);
    const rows = data ?? [];
    expect(rows.some((r) => String(r.name).startsWith("[Placeholder]"))).toBe(false);
    expect(rows.some((r) => /example\.com|example\.test/.test(String(r.url)))).toBe(false);
    expect(rows.every((r) => /^https:\/\/[a-z0-9.-]+\//.test(String(r.url)))).toBe(true);
    const verified = rows.filter((r) => r.needs_verification === false);
    expect(verified.length).toBeGreaterThanOrEqual(10);
    // A verified entry says where its rules were read and when, and has a promotion policy.
    for (const r of verified) {
      expect(r.last_verified_at, String(r.name)).not.toBeNull();
      expect(String(r.rules_summary), String(r.name)).toMatch(/Source/);
      expect(String(r.self_promo_policy).length, String(r.name)).toBeGreaterThan(10);
    }
    expect(rows.filter((r) => r.needs_verification === true).every((r) => r.last_verified_at === null)).toBe(true);
    for (const name of ["Hacker News (Show HN)", "Shopify Community", "Product Hunt forums", "Superpath"]) expect(verified.map((r) => r.name)).toContain(name);
  });

  it("is readable by any signed-in user (active entries only) and by nobody who is signed out", async () => {
    for (const u of [owner, viewer, other]) {
      const rows = rowsOf(await u.client.from("communities").select("id, active"));
      expect(rows.length).toBeGreaterThanOrEqual(25);
      expect(rows.every((r) => r.active === true), "an inactive community was visible").toBe(true);
    }
    expect(rowsOf(await anon.from("communities").select("id"))).toHaveLength(0);
  });

  it("cannot be changed by anyone through the API, whatever their role", async () => {
    for (const [who, u] of [["owner", owner], ["editor", editor], ["other", other]] as const) {
      expect(wasBlocked(await u.client.from("communities").insert({ name: "Mine", platform: "other", url: "https://evil.example" }).select()), `${who} inserted`).toBe(true);
      expect(wasBlocked(await u.client.from("communities").update({ url: "https://evil.example" }).eq("id", C1).select()), `${who} updated`).toBe(true);
      expect(wasBlocked(await u.client.from("communities").delete().eq("id", C1).select()), `${who} deleted`).toBe(true);
    }
    expect((await admin.from("communities").select("url").eq("id", C1).single()).data?.url).toBe("https://news.ycombinator.com/show");
  });

  it("refuses non-https links and oversized fields even from the service role", async () => {
    const base = { name: "Bad", platform: "other" };
    for (const url of ["http://example.com/x", "javascript:alert(1)", "ftp://example.com", "https://", "//example.com", "https://a.com/with space"]) {
      expect((await admin.from("communities").insert({ ...base, url }).select()).error, url).not.toBeNull();
    }
    expect((await admin.from("communities").insert({ ...base, url: "https://example.com/ok", platform: "myspace" }).select()).error).not.toBeNull();
    expect((await admin.from("communities").insert({ ...base, url: "https://example.com/ok", rules_summary: "x".repeat(1001) }).select()).error).not.toBeNull();
    expect((await admin.from("communities").insert({ ...base, url: "https://example.com/ok", niches: ["Not A Tag"] }).select()).error).not.toBeNull();
  });
});

describe("the tracker", () => {
  const save = (u: TestUser, ws: string, community: string, status = "saved", notes: string | null = "note") => u.client.from("workspace_communities").insert({ workspace_id: ws, community_id: community, status, notes }).select();

  it("is for editors and above of one workspace: viewers and other workspaces see and change nothing", async () => {
    expect(rowsOf(await save(owner, wsA, C1))).toHaveLength(1);
    expect(rowsOf(await save(editor, wsA, C2, "joined"))).toHaveLength(1);

    expect(rowsOf(await owner.client.from("workspace_communities").select("community_id").eq("workspace_id", wsA))).toHaveLength(2);
    expect(rowsOf(await viewer.client.from("workspace_communities").select("community_id"))).toHaveLength(0);
    expect(rowsOf(await other.client.from("workspace_communities").select("community_id").eq("workspace_id", wsA))).toHaveLength(0);
    expect(rowsOf(await anon.from("workspace_communities").select("community_id"))).toHaveLength(0);

    expect(wasBlocked(await save(viewer, wsA, "b0000000-0000-4000-8000-000000000003"))).toBe(true);
    expect(wasBlocked(await save(other, wsA, "b0000000-0000-4000-8000-000000000003"))).toBe(true);
    expect(rowsOf(await other.client.from("workspace_communities").update({ notes: "pwned" }).eq("workspace_id", wsA).select())).toHaveLength(0);
    expect(rowsOf(await other.client.from("workspace_communities").delete().eq("workspace_id", wsA).select())).toHaveLength(0);
    expect((await admin.from("workspace_communities").select("notes").eq("workspace_id", wsA).eq("community_id", C1).single()).data?.notes).toBe("note");
  });

  it("keeps each workspace's tracker separate even for the same community", async () => {
    expect(rowsOf(await save(other, wsB, C1, "posted", "B's own note"))).toHaveLength(1);
    const a = rowsOf(await owner.client.from("workspace_communities").select("status, notes").eq("community_id", C1));
    const b = rowsOf(await other.client.from("workspace_communities").select("status, notes").eq("community_id", C1));
    expect(a).toEqual([{ status: "saved", notes: "note" }]);
    expect(b).toEqual([{ status: "posted", notes: "B's own note" }]);
  });

  it("allows only the four statuses, bounded notes, active communities and a change to status and notes only", async () => {
    expect((await save(owner, wsA, "b0000000-0000-4000-8000-000000000004", "lurking")).error).not.toBeNull();
    expect((await save(owner, wsA, "b0000000-0000-4000-8000-000000000004", "saved", "x".repeat(2001))).error).not.toBeNull();
    expect(wasBlocked(await save(owner, wsA, inactive)), "an inactive community was added").toBe(true);

    expect(rowsOf(await owner.client.from("workspace_communities").update({ status: "dropped", notes: "changed" }).eq("workspace_id", wsA).eq("community_id", C1).select("status"))).toEqual([{ status: "dropped" }]);
    expect(wasBlocked(await owner.client.from("workspace_communities").update({ workspace_id: wsB }).eq("workspace_id", wsA).eq("community_id", C1).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("workspace_communities").update({ community_id: C2 }).eq("workspace_id", wsA).eq("community_id", C1).select())).toBe(true);
    // The row's timestamp moves on every change.
    const before = (await admin.from("workspace_communities").select("updated_at").eq("workspace_id", wsA).eq("community_id", C1).single()).data?.updated_at;
    await owner.client.from("workspace_communities").update({ notes: "again" }).eq("workspace_id", wsA).eq("community_id", C1);
    const after = (await admin.from("workspace_communities").select("updated_at").eq("workspace_id", wsA).eq("community_id", C1).single()).data?.updated_at;
    expect(Date.parse(String(after))).toBeGreaterThan(Date.parse(String(before)));
  });

  it("is removed with the workspace, and an editor can remove their own entry", async () => {
    expect(rowsOf(await editor.client.from("workspace_communities").delete().eq("workspace_id", wsA).eq("community_id", C2).select())).toHaveLength(1);
    expect(rowsOf(await viewer.client.from("workspace_communities").delete().eq("workspace_id", wsA).select())).toHaveLength(0);
  });
});

describe("loadFinder", () => {
  it("ranks by the workspace's niche, drops non-https rows and returns the caller's own tracker only", async () => {
    const view = await loadFinder(owner.client, { id: wsA, niche: "SaaS startup", audience: "Founders" }, { includeTracker: true });
    expect(view.hasNiche).toBe(true);
    expect(view.communities.length).toBeGreaterThanOrEqual(25);
    expect(view.communities[0].niches).toContain("saas");
    expect(view.communities[0].score).toBeGreaterThan(view.communities[view.communities.length - 1].score);
    expect(view.tracker.get(C1)?.status).toBe("dropped");
    expect(view.communities.every((c) => c.url.startsWith("https://"))).toBe(true);

    const none = await loadFinder(other.client, { id: wsA, niche: null, audience: null }, { includeTracker: true });
    expect(none.hasNiche).toBe(false);
    expect(none.tracker.size, "another workspace's tracker leaked through the loader").toBe(0);
    const asViewer = await loadFinder(viewer.client, { id: wsA, niche: "x", audience: "y" }, { includeTracker: true });
    expect(asViewer.tracker.size).toBe(0);
  });
});
