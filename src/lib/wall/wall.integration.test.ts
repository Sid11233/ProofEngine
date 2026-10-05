/** Wall of proof settings against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let outsider: TestUser;
let ws: string;
let wsSlug: string;

const save = (user: TestUser, args: { enabled?: boolean; origins?: string[]; layout?: string; limit?: number }, workspace = ws) =>
  user.client.rpc("save_wall_settings", { ws: workspace, is_enabled: args.enabled ?? true, origins: args.origins ?? ["https://example.com"], chosen_layout: args.layout ?? "grid", item_limit: args.limit ?? 6 });

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, editor, outsider] = await Promise.all(["wall-owner", "wall-editor", "wall-out"].map((l) => createTestUser(cfg, admin, l)));
  ws = String((await owner.client.rpc("create_workspace", { name: "Wall Co", type: "agency" })).data);
  wsSlug = `wall-${hex64().slice(0, 8)}`;
  await admin.from("workspaces").update({ subdomain_slug: wsSlug }).eq("id", ws);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: editor.id, role: "editor" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [owner, editor, outsider]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("save_wall_settings", () => {
  it("lets an admin or owner save, and nobody else", async () => {
    expect((await save(owner, { origins: ["https://example.com", "https://shop.example.org:8443"] })).error).toBeNull();
    expect((await save(editor, {})).error).not.toBeNull();
    expect((await save(outsider, {})).error).not.toBeNull();
    expect((await save(owner, {}, "00000000-0000-4000-8000-000000000000")).error).not.toBeNull();
  });

  it("refuses origins that could widen the allowlist, whatever the app does", async () => {
    for (const bad of ["*", "http://example.com", "https://*.example.com", "https://example.com/path", "https://a.com; script-src *", "https://a.com https://b.com", "'self'", "data:"]) {
      expect((await save(owner, { origins: [bad] })).error, bad).not.toBeNull();
    }
    expect((await save(owner, { origins: Array.from({ length: 11 }, (_, i) => `https://s${i}.example.com`) })).error).not.toBeNull();
    expect((await save(owner, { enabled: true, origins: [] })).error, "enabled without any allowed site").not.toBeNull();
    expect((await save(owner, { layout: "masonry" })).error).not.toBeNull();
    expect((await save(owner, { limit: 99 })).error).not.toBeNull();
  });

  it("writes only through the function: no direct table writes, admins-only reads", async () => {
    expect(wasBlocked(await owner.client.from("wall_settings").update({ enabled: false }).eq("workspace_id", ws).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("wall_settings").insert({ workspace_id: ws }).select())).toBe(true);
    const asEditor = await editor.client.from("wall_settings").select("*").eq("workspace_id", ws);
    expect(asEditor.data ?? []).toHaveLength(0);
    const asOwner = await owner.client.from("wall_settings").select("*").eq("workspace_id", ws);
    expect(asOwner.data).toHaveLength(1);
  });
});

describe("public_wall_settings", () => {
  it("exposes only enabled widgets, and only what the embed page needs", async () => {
    await save(owner, { enabled: true, origins: ["https://example.com"], layout: "list", limit: 3 });
    const on = await anon.from("public_wall_settings").select("*").eq("workspace_slug", wsSlug);
    expect(on.data).toEqual([{ workspace_slug: wsSlug, allowed_origins: ["https://example.com"], layout: "list", max_items: 3 }]);
    await save(owner, { enabled: false, origins: ["https://example.com"] });
    const off = await anon.from("public_wall_settings").select("*").eq("workspace_slug", wsSlug);
    expect(off.data ?? []).toHaveLength(0);
    expect((await anon.from("wall_settings").select("*")).data ?? []).toHaveLength(0);
  });
});
