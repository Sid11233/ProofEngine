/** Seeded templates and the plan/entitlement rule against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, rowsOf, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { isTemplateAllowed, templateAllowed } from "./allowed";
import { parseTemplate, type Template } from "./model";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let rows: Array<Record<string, unknown>>;
const users: string[] = [];

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, viewer, outsider] = await Promise.all(["tp-owner", "tp-viewer", "tp-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Tpl Co", type: "agency" })).data);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
  await outsider.client.rpc("create_workspace", { name: "Tpl Other", type: "agency" });
  rows = ((await admin.from("templates").select("*").like("name", "%").in("name", ["Classic", "Minimal", "Before and After", "Timeline Story", "SaaS Switch Story", "Clean Cards", "Midnight", "Results First", "Testimonial First", "Editorial", "Agency Win"])).data ?? []) as Array<Record<string, unknown>>;
}, 60_000);

afterAll(async () => {
  await admin.from("template_entitlements").delete().eq("workspace_id", ws);
  await admin.from("workspaces").delete().eq("id", ws);
  for (const m of (await admin.from("workspace_members").select("workspace_id").eq("user_id", outsider.id)).data ?? []) await admin.from("workspaces").delete().eq("id", m.workspace_id);
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("seeded templates", () => {
  it("has the eleven templates, all valid", () => {
    expect(rows).toHaveLength(11);
    const parsed = rows.map(parseTemplate);
    expect(parsed.every((t) => t !== null)).toBe(true);
    const byName = Object.fromEntries((parsed as Template[]).map((t) => [t.name, t]));
    expect(byName.Classic).toMatchObject({ tier: "free", layout: "classic" });
    expect(byName.Minimal).toMatchObject({ tier: "free", layout: "minimal" });
    expect(byName["Before and After"]).toMatchObject({ tier: "pro", layout: "before-after" });
    expect(byName["Timeline Story"]).toMatchObject({ tier: "pro", layout: "timeline" });
    expect(byName["SaaS Switch Story"]).toMatchObject({ tier: "pro", layout: "saas-switch" });
    expect(byName["Clean Cards"]).toMatchObject({ tier: "free", layout: "cards" });
    expect(byName.Midnight).toMatchObject({ tier: "free", layout: "classic", theme: { mode: "dark" } });
    expect(byName["Results First"]).toMatchObject({ tier: "pro", layout: "spotlight" });
    expect(byName["Testimonial First"]).toMatchObject({ tier: "pro", layout: "quote-led" });
    expect(byName.Editorial).toMatchObject({ tier: "pro", layout: "editorial" });
    expect(byName["Agency Win"]).toMatchObject({ tier: "pro", layout: "spotlight" });
  });

  it("are readable when signed in, never to anonymous, and never writable from the client", async () => {
    expect(rowsOf(await owner.client.from("templates").select("id")).length).toBeGreaterThanOrEqual(5);
    expect(rowsOf(await makeClient(loadLocalConfig(), "anon").from("templates").select("id"))).toHaveLength(0);
    const id = String(rows[0].id);
    expect(wasBlocked(await owner.client.from("templates").update({ tier: "free" }).eq("id", id).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("templates").insert({ name: "X", tier: "free" }).select())).toBe(true);
  });
});

describe("template_allowed (SQL) agrees with isTemplateAllowed (TypeScript)", () => {
  it("on every plan, tier and entitlement combination, for a member", async () => {
    const free = rows.find((r) => r.tier === "free")!;
    const pro = rows.find((r) => r.tier === "pro")!;
    const pack = { ...pro, id: crypto.randomUUID(), name: "Pack Tpl", tier: "pack" };
    await admin.from("templates").insert({ id: pack.id, name: "Isolation Pack", tier: "pack", sections: [], default_theme: {} });
    const inactive = { id: crypto.randomUUID() };
    await admin.from("templates").insert({ id: inactive.id, name: "Isolation Off", tier: "free", sections: [], default_theme: {}, active: false });

    try {
      for (const plan of ["free", "pro", "team"]) {
        await admin.from("workspaces").update({ plan }).eq("id", ws);
        for (const entitled of [false, true]) {
          await admin.from("template_entitlements").delete().eq("workspace_id", ws);
          if (entitled) {
            for (const t of [free, pro, { id: pack.id }]) await admin.from("template_entitlements").insert({ workspace_id: ws, template_id: t.id, source: "purchase" });
          }
          for (const [tier, id] of [["free", String(free.id)], ["pro", String(pro.id)], ["pack", pack.id]] as const) {
            const sql = await templateAllowed(owner.client, ws, id);
            expect(sql, `plan=${plan} entitled=${entitled} tier=${tier}`).toBe(isTemplateAllowed({ tier, plan, entitled }));
            expect(await templateAllowed(viewer.client, ws, id), "viewers are members too").toBe(sql);
          }
          expect(await templateAllowed(owner.client, ws, inactive.id), "inactive template allowed").toBe(false);
        }
      }
    } finally {
      await admin.from("template_entitlements").delete().eq("workspace_id", ws);
      await admin.from("templates").delete().in("id", [pack.id, inactive.id]);
    }
  });

  it("is false for non-members, anonymous callers and unknown templates, and true for the server", async () => {
    await admin.from("workspaces").update({ plan: "team" }).eq("id", ws);
    const free = String(rows.find((r) => r.tier === "free")!.id);
    expect(await templateAllowed(outsider.client, ws, free), "another workspace's member").toBe(false);
    expect((await makeClient(loadLocalConfig(), "anon").rpc("template_allowed", { ws, tpl: free })).error).not.toBeNull();
    expect(await templateAllowed(owner.client, ws, crypto.randomUUID())).toBe(false);
    expect(await templateAllowed(owner.client, crypto.randomUUID(), free)).toBe(false);
    expect((await admin.rpc("template_allowed", { ws, tpl: free })).data).toBe(true);
  });

  it("a free workspace cannot unlock a pro template by any client write", async () => {
    await admin.from("workspaces").update({ plan: "free" }).eq("id", ws);
    const pro = String(rows.find((r) => r.tier === "pro")!.id);
    expect(await templateAllowed(owner.client, ws, pro)).toBe(false);
    expect(wasBlocked(await owner.client.from("workspaces").update({ plan: "team" }).eq("id", ws).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("template_entitlements").insert({ workspace_id: ws, template_id: pro, source: "purchase" }).select())).toBe(true);
    expect(await templateAllowed(owner.client, ws, pro)).toBe(false);
  });
});
