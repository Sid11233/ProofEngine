/** The dashboard loader against the real database: each user sees only their own workspace (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";
import { loadDashboard } from "./load";

let admin: SupabaseClient;
let a: TestUser;
let b: TestUser;
let wsA: string;
let wsB: string;

async function request(user: TestUser, ws: string, { complete = false, old = false } = {}) {
  const { data: id } = await user.client.rpc("create_proof_request", { ws, client_name: "Dana", client_email: "d@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  await admin.from("proof_requests").update({ status: "sent", ...(old ? { created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() } : {}) }).eq("id", id);
  if (!complete) return String(id);
  const { data: interview } = await admin.from("interviews").insert({ request_id: id, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  return String(interview?.id);
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [a, b] = await Promise.all(["db-a", "db-b"].map((l) => createTestUser(cfg, admin, l)));
  wsA = String((await a.client.rpc("create_workspace", { name: "Dash A", type: "agency" })).data);
  wsB = String((await b.client.rpc("create_workspace", { name: "Dash B", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro" }).in("id", [wsA, wsB]);

  // Workspace A: 3 sent (2 old and unanswered, 1 completed with no case study yet), 2 referrals.
  await request(a, wsA, { old: true });
  await request(a, wsA, { old: true });
  await request(a, wsA, { complete: true });
  await admin.from("referrals").insert([{ workspace_id: wsA, referred_name: "R1", referred_contact: "r1@example.com", status: "new" }, { workspace_id: wsA, referred_name: "R2", referred_contact: "r2@example.com", status: "won" }]);
  // Workspace B: a different shape, so any leak would show.
  await request(b, wsB, { complete: true });
  await request(b, wsB, { complete: true });
  await admin.from("referrals").insert({ workspace_id: wsB, referred_name: "Other", referred_contact: "o@example.com" });
  await admin.from("usage_counters").upsert({ workspace_id: wsB, period: new Date().toISOString().slice(0, 7) + "-01", interviews: 2, ai_messages: 50 });
}, 120_000);

afterAll(async () => {
  for (const ws of [wsA, wsB]) await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [a, b]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("loadDashboard", () => {
  it("shows a user only their own workspace's numbers", async () => {
    const da = await loadDashboard(a.client, wsA, { plan: "pro", aiLimit: 3000 });
    const db = await loadDashboard(b.client, wsB, { plan: "pro", aiLimit: 3000 });

    expect(da.funnel).toMatchObject({ sent: 3, started: 1, completed: 1 });
    expect(da.funnel.completionRate).toBe(33);
    expect(da.referrals).toEqual({ new: 1, contacted: 0, won: 1, dismissed: 0 });
    expect(da.usage.interviews).toBe(3);
    expect(da.usage.interviewLimit).toBe(100);

    expect(db.funnel).toMatchObject({ sent: 2, started: 2, completed: 2 });
    expect(db.referrals).toEqual({ new: 1, contacted: 0, won: 0, dismissed: 0 });
    expect(db.usage).toMatchObject({ interviews: 2, aiMessages: 50 });
  });

  it("returns nothing for a workspace the user does not belong to, even when asked by id", async () => {
    const leak = await loadDashboard(a.client, wsB, { plan: "pro", aiLimit: 3000 });
    expect(leak.funnel).toMatchObject({ sent: 0, started: 0, completed: 0 });
    expect(leak.referrals).toEqual({ new: 0, contacted: 0, won: 0, dismissed: 0 });
    expect(leak.usage.interviews).toBe(0);
    expect(leak.totalViews).toBe(0);
    expect(Object.values(leak.caseStudies).every((n) => n === 0)).toBe(true);
  });

  it("suggests the right next step from real data", async () => {
    // A has a completed interview with no case study, so generating comes before reminding.
    expect((await loadDashboard(a.client, wsA, { plan: "pro", aiLimit: 3000 })).next.id).toBe("generate");
    const c = await createTestUser(loadLocalConfig(), admin, "db-c");
    const wsC = String((await c.client.rpc("create_workspace", { name: "Dash C", type: "agency" })).data);
    expect((await loadDashboard(c.client, wsC, { plan: "free", aiLimit: 100 })).next.id).toBe("first");
    await request(c, wsC, { old: true });
    const stale = await loadDashboard(c.client, wsC, { plan: "free", aiLimit: 100 });
    expect(stale.next.id).toBe("remind");
    await admin.from("workspaces").delete().eq("id", wsC);
    await admin.auth.admin.deleteUser(c.id);
  });
});
