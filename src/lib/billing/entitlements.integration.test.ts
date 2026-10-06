/** Limits and entitlements enforced by the server and database, called directly with a valid session (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, signCurrent, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { createRequest } from "@/lib/requests/service";
import { generateToken } from "@/lib/security/tokens";
import { loadPublishedStudy } from "@/lib/public/load";
import { resolveLimits } from "@/lib/limits";
import { canRemoveBranding } from "./entitlements";
import { PLANS } from "./plans";
import { processVerifiedEvent } from "./webhook-core";

const PRO_TEMPLATE = "a0000000-0000-4000-8000-000000000004";
let admin: SupabaseClient;
let anon: SupabaseClient;
let free: TestUser;
let pro: TestUser;
let wsFree: string;
let wsPro: string;
const PRICE = "price_entitle123";

const content = (h: string) => ({ headline: h, client: {}, sections: [{ type: "challenge", title: "The challenge", body: "Body" }], tags: [] });

async function approved(user: TestUser, ws: string, template: string | null) {
  const { data: requestId } = await user.client.rpc("create_proof_request", { ws, client_name: "Dana", client_email: "d@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: content("Plan story"), status: "draft", template_id: template }).select("id").single();
  const id = String(cs?.id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content("Plan story") });
  const token = generateToken();
  await user.client.rpc("request_client_approval", { study: id, hash: token.hash });
  await admin.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64() });
  await signCurrent(admin, id);
  return id;
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [free, pro] = await Promise.all(["ent-free", "ent-pro"].map((l) => createTestUser(cfg, admin, l)));
  wsFree = String((await free.client.rpc("create_workspace", { name: "Free Co", type: "agency" })).data);
  wsPro = String((await pro.client.rpc("create_workspace", { name: "Pro Co", type: "agency" })).data);
  await admin.from("workspaces").update({ subdomain_slug: `ent-${hex64().slice(0, 8)}` }).eq("id", wsFree);
  await admin.from("workspaces").update({ subdomain_slug: `ent-${hex64().slice(0, 8)}`, plan: "pro" }).eq("id", wsPro);
}, 120_000);

afterAll(async () => {
  for (const ws of [wsFree, wsPro]) await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [free, pro]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("the plan table and the database agree", () => {
  it("interview allowances match plan_interview_limit() for every plan", async () => {
    for (const plan of Object.values(PLANS)) {
      expect((await admin.rpc("plan_interview_limit", { plan: plan.id })).data, plan.id).toBe(plan.interviewsPerMonth);
    }
    expect((await admin.rpc("plan_interview_limit", { plan: "made-up" })).data).toBe(0);
  });

  it("AI allowances match the limits defaults", () => {
    const l = resolveLimits({});
    for (const plan of Object.values(PLANS)) expect(l.aiMessagesPerMonth[plan.id], plan.id).toBe(plan.aiMessagesPerMonth);
  });

  it("template access matches template_allowed() for every plan and tier", async () => {
    const { data: templates } = await admin.from("templates").select("id, tier").in("tier", ["free", "pro"]).eq("active", true);
    for (const [ws, plan] of [[wsFree, "free"], [wsPro, "pro"]] as const) {
      for (const t of templates ?? []) {
        const db = (await admin.rpc("template_allowed", { ws, tpl: t.id })).data;
        expect(db, `${plan}/${t.tier}`).toBe(PLANS[plan as "free" | "pro"].proTemplates || t.tier === "free");
      }
    }
  });

  it("the public Powered by line shows exactly when the plan does not remove branding", async () => {
    for (const [ws, plan] of [[wsFree, "free"], [wsPro, "pro"]] as const) {
      const s = await approved(ws === wsFree ? free : pro, ws, null);
      const user = ws === wsFree ? free : pro;
      const slug = `bd-${hex64().slice(0, 8)}`;
      expect((await user.client.rpc("publish_case_study", { study: s, new_slug: slug })).error).toBeNull();
      const { data: ws_ } = await admin.from("workspaces").select("subdomain_slug").eq("id", ws).single();
      const loaded = await loadPublishedStudy(anon, String(ws_?.subdomain_slug), slug);
      expect(loaded?.showBadge, plan).toBe(!canRemoveBranding(plan));
    }
  });
});

describe("a free workspace is blocked, calling the API directly with a valid session", () => {
  it("cannot create a fourth interview in a month", async () => {
    const make = () => free.client.rpc("create_proof_request", { ws: wsFree, client_name: "Dana", client_email: "d@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
    // The earlier tests in this file already used some of the allowance; fill it exactly.
    const { data: used } = await admin.from("usage_counters").select("interviews").eq("workspace_id", wsFree).eq("period", new Date().toISOString().slice(0, 7) + "-01").maybeSingle();
    for (let i = Number(used?.interviews ?? 0); i < 3; i++) expect((await make()).error).toBeNull();
    const fourth = await make();
    expect(fourth.error?.code).toBe("54000");
  });

  it("is also stopped early by the service-level check, with the limit message", async () => {
    const result = await createRequest(free.client, wsFree, { clientName: "Dana", clientEmail: "d@example.test", flowType: "agency", focusOutcomes: [], sendNow: false } as never, { appUrl: "https://app.example.com", workspaceName: "Free Co", sender: null, plan: "free" });
    expect(result).toEqual({ ok: false, error: "limit" });
  });

  it("cannot publish a Pro template", async () => {
    // An approved study on a Pro template in the free workspace (the monthly allowance is used up, so insert the case study directly).
    const { data: cs } = await admin.from("case_studies").insert({ workspace_id: wsFree, content: content("Locked"), status: "approved", template_id: PRO_TEMPLATE }).select("id").single();
    const sid = String(cs?.id);
    await admin.from("case_study_versions").insert({ case_study_id: sid, workspace_id: wsFree, version: 1, content: content("Locked") });
    await admin.from("approvals").insert({ case_study_id: sid, workspace_id: wsFree, version: 1, approver_email: "d@example.test", method: "email_link" });
    const res = await free.client.rpc("publish_case_study", { study: sid, new_slug: `lk-${hex64().slice(0, 8)}` });
    expect(res.error?.message).toContain("publish_blocked:template_locked");
    expect((await admin.from("case_studies").update({ status: "published", slug: `lk2-${hex64().slice(0, 8)}` }).eq("id", sid)).error?.message, "even the service role cannot skip the rule").toContain("publish_blocked:template_locked");
  });

  it("cannot change its own plan or remove the Powered by line", async () => {
    expect(wasBlocked(await free.client.from("workspaces").update({ plan: "pro" }).eq("id", wsFree).select())).toBe(true);
    expect(wasBlocked(await free.client.from("subscriptions").upsert({ workspace_id: wsFree, plan: "pro" }).select())).toBe(true);
    expect(wasBlocked(await free.client.from("template_entitlements").insert({ workspace_id: wsFree, template_id: PRO_TEMPLATE }).select())).toBe(true);
  });
});

describe("downgrade: published pages stay online but cannot be edited or republished", () => {
  it("keeps the page visible, blocks edits and republishing, and restores everything on upgrade", async () => {
    const id = await approved(pro, wsPro, PRO_TEMPLATE);
    const slug = `dg-${hex64().slice(0, 8)}`;
    expect((await pro.client.rpc("publish_case_study", { study: id, new_slug: slug })).error).toBeNull();
    const { data: w } = await admin.from("workspaces").select("subdomain_slug").eq("id", wsPro).single();
    const wsSlug = String(w?.subdomain_slug);

    const customer = `cus_${hex64().slice(0, 12)}`;
    const sub = (status: string, workspace = wsPro) => ({ id: `evt_${hex64().slice(0, 16)}`, type: "customer.subscription.updated", data: { object: { id: `sub_${hex64().slice(0, 12)}`, customer, status, metadata: { workspace_id: workspace }, items: { data: [{ price: { id: PRICE } }] } } } });
    expect(await processVerifiedEvent(admin, sub("active"), { STRIPE_PRICE_PRO: PRICE })).toBe("processed");
    expect(await processVerifiedEvent(admin, sub("canceled"), { STRIPE_PRICE_PRO: PRICE })).toBe("processed");
    expect((await admin.from("workspaces").select("plan").eq("id", wsPro).single()).data?.plan).toBe("free");

    // Still public.
    expect(await loadPublishedStudy(anon, wsSlug, slug), "the page went offline on downgrade").not.toBeNull();
    // Not editable: neither the editing function nor a direct update works on a published page.
    expect((await pro.client.rpc("save_case_study_edit", { study: id, new_content: content("Changed"), edited_claims: [] })).error?.code).toBe("22023");
    expect(wasBlocked(await pro.client.from("case_studies").update({ template_id: "a0000000-0000-4000-8000-000000000001" }).eq("id", id).select())).toBe(true);
    // Taking it down is allowed; putting it back up is not until the plan returns.
    expect((await pro.client.rpc("unpublish_case_study", { study: id })).error).toBeNull();
    expect((await pro.client.rpc("publish_case_study", { study: id, new_slug: slug })).error?.message).toContain("publish_blocked:template_locked");

    expect(await processVerifiedEvent(admin, sub("active"), { STRIPE_PRICE_PRO: PRICE })).toBe("processed");
    expect((await pro.client.rpc("publish_case_study", { study: id, new_slug: slug })).error).toBeNull();
  });
});
