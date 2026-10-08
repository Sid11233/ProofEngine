/** Onboarding interviews against the real database (npm run test:isolation): the creation function, the question list, the snapshot. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateToken } from "@/lib/security/tokens";
import { createTestUser, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { createResolver } from "../interview-access-core";
import { createMemoryLimiter } from "../security/rate-limit-memory";
import { loadEffectiveFlow, resetOnboardingFlow, saveOnboardingFlow } from "./flow";

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
  [owner, viewer, outsider] = await Promise.all(["ob-owner", "ob-viewer", "ob-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Onboard Co", type: "agency" })).data);
  wsOther = String((await outsider.client.rpc("create_workspace", { name: "Other Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro" }).in("id", [ws, wsOther]);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, wsOther]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

const questions = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, text: `Question number ${i}?` }));
const create = (u: TestUser, w: string, over: Record<string, unknown> = {}) => {
  const token = generateToken();
  return u.client.rpc("create_onboarding_request", { ws: w, client: null, client_name: "Dana Doe", client_email: "dana@example.test", questions: questions(), hash: token.hash, ...over }).then((r) => ({ ...r, token }));
};

describe("create_onboarding_request", () => {
  it("an editor creates an onboarding request; it is marked onboarding and keeps its own questions", async () => {
    const r = await create(owner, ws);
    expect(r.error).toBeNull();
    const { data } = await admin.from("proof_requests").select("purpose, status, questions_snapshot, flow_type").eq("id", String(r.data)).single();
    expect(data).toMatchObject({ purpose: "onboarding", status: "draft", flow_type: "agency", questions_snapshot: questions() });
    // clients of the API cannot read the snapshot column directly
    expect((await owner.client.from("proof_requests").select("questions_snapshot").eq("id", String(r.data))).error).not.toBeNull();
  });

  it("refuses viewers, outsiders, other workspaces' clients and bad question lists", async () => {
    expect((await create(viewer, ws)).error?.code).toBe("42501");
    expect((await create(outsider, ws)).error?.code).toBe("42501");
    const foreign = await outsider.client.from("clients").insert({ workspace_id: wsOther, created_by: outsider.id, name: "Theirs" }).select("id").single();
    expect((await create(owner, ws, { client: foreign.data?.id })).error?.code).toBe("P0002");
    expect((await create(owner, ws, { questions: [] })).error?.code).toBe("22023");
    expect((await create(owner, ws, { questions: questions(13) })).error?.code).toBe("22023");
    expect((await create(owner, ws, { questions: { not: "a list" } })).error?.code).toBe("22023");
  });

  it("the interview link serves the snapshot and the onboarding consent, and later edits do not change it", async () => {
    const r = await create(owner, ws, { questions: [{ id: "x1", text: "Snapshot question for {{workspace}}?" }] });
    const resolve = createResolver({ admin, ipLimiter: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }), tokenLimiter: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }) });
    await admin.from("proof_requests").update({ status: "sent" }).eq("id", String(r.data));
    const first = await resolve(r.token.raw, { ip: "1.1.1.1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.access.purpose).toBe("onboarding");
    expect(first.access.view.questions).toEqual([{ id: "x1", text: "Snapshot question for Onboard Co?" }]);
    expect(first.access.view.consentText).not.toMatch(/case study/i);

    // editing the workspace list afterwards does not touch a link already made
    expect(await saveOnboardingFlow(owner.client, { workspaceId: ws, workspaceType: "agency" }, [{ id: "n1", text: "A brand new question?" }])).toEqual({ ok: true });
    const again = await resolve(r.token.raw, { ip: "1.1.1.1" });
    if (!again.ok) throw new Error("resolve failed");
    expect(again.access.view.questions[0].id).toBe("x1");
  });
});

describe("the question list (CMS)", () => {
  it("starts from the standard questions, saves a custom list, and resets", async () => {
    const standard = await loadEffectiveFlow(owner.client, ws, "agency");
    expect(standard?.custom ?? false).toBe(standard?.custom);
    await resetOnboardingFlow(owner.client, ws);
    const base = await loadEffectiveFlow(owner.client, ws, "agency");
    expect(base).toMatchObject({ custom: false });
    expect(base?.questions.length).toBeGreaterThanOrEqual(6);

    expect(await saveOnboardingFlow(owner.client, { workspaceId: ws, workspaceType: "agency" }, [{ id: "c1", text: "First custom question?" }, { id: "c2", text: "A link please", key: "short" }])).toEqual({ ok: true });
    expect(await saveOnboardingFlow(owner.client, { workspaceId: ws, workspaceType: "agency" }, [{ id: "c1", text: "Changed once more?" }])).toEqual({ ok: true }); // update path, still one row
    const custom = await loadEffectiveFlow(owner.client, ws, "agency");
    expect(custom).toMatchObject({ custom: true, questions: [{ id: "c1", text: "Changed once more?" }] });
    expect((await admin.from("question_flows").select("id").eq("workspace_id", ws).eq("purpose", "onboarding")).data).toHaveLength(1);

    // other workspaces still see the standard list and cannot see this one
    expect(await loadEffectiveFlow(outsider.client, wsOther, "agency")).toMatchObject({ custom: false });
    expect(await resetOnboardingFlow(owner.client, ws)).toEqual({ ok: true });
    expect(await loadEffectiveFlow(owner.client, ws, "agency")).toMatchObject({ custom: false });
  });

  it("invalid lists are refused; viewers and outsiders cannot write; system and review flows are untouchable", async () => {
    expect(await saveOnboardingFlow(owner.client, { workspaceId: ws, workspaceType: "agency" }, [])).toMatchObject({ ok: false, error: "invalid" });
    expect((await saveOnboardingFlow(viewer.client, { workspaceId: ws, workspaceType: "agency" }, questions())).ok).toBe(false);
    expect((await saveOnboardingFlow(outsider.client, { workspaceId: ws, workspaceType: "agency" }, questions())).ok).toBe(false);

    const asEditor = owner.client.from("question_flows");
    expect((await asEditor.insert({ workspace_id: null, type: "agency", name: "Mine now", questions: [], purpose: "onboarding" }).select()).data ?? []).toHaveLength(0);
    expect((await owner.client.from("question_flows").insert({ workspace_id: ws, type: "agency", name: "Review flow", questions: [], purpose: "review" }).select()).data ?? []).toHaveLength(0);
    const system = await admin.from("question_flows").select("id").is("workspace_id", null).eq("purpose", "onboarding").limit(1).single();
    const before = (await admin.from("question_flows").select("questions").eq("id", String(system.data?.id)).single()).data;
    await owner.client.from("question_flows").update({ questions: [{ id: "h", text: "Hacked" }] }).eq("id", String(system.data?.id));
    await owner.client.from("question_flows").delete().eq("id", String(system.data?.id));
    expect((await admin.from("question_flows").select("questions").eq("id", String(system.data?.id)).single()).data).toEqual(before);
  });
});
