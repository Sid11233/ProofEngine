/** "Refine with AI" against the real database (npm run test:isolation): roles, limits, quotes, versions, restore. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AiClient } from "@/lib/ai/client";
import { createTestUser, hex64, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { acceptRefinement, refineText, restoreOriginal, REFINE_MESSAGES, type RefineDeps } from "./refine";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let ws: string;
let outsiderWs: string;
const users: string[] = [];
const SECRET = "x".repeat(40);

const BODY = "Onboarding took 12 days. Support tickets rose to 1,200 a month.";
const BETTER = "Onboarding used to take 12 days, and support tickets climbed to 1,200 a month.";
const content = (claimId: string) => ({
  headline: "Acme cut onboarding time by 40 percent",
  client: {},
  sections: [
    { type: "challenge", title: "Challenge", body: BODY },
    { type: "quote", title: "In their words", quote: { text: "We cut onboarding time by 40 percent", attribution: "A customer", claimId } },
  ],
  tags: [],
});

async function study(status = "draft") {
  const { data: msg } = await admin.from("interview_messages").insert({ interview_id: (await interview()).id, workspace_id: ws, role: "client", content: "We cut onboarding time by 40 percent." }).select("id, interview_id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: msg?.interview_id, content: {}, status: "draft" }).select("id").single();
  const id = String(cs?.id);
  const { data: claim } = await admin.from("claims").insert({ case_study_id: id, workspace_id: ws, text: "40 percent faster", source_message_id: msg?.id, source_quote: "cut onboarding time by 40 percent" }).select("id").single();
  await admin.from("case_studies").update({ content: content(String(claim?.id)) }).eq("id", id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content(String(claim?.id)) });
  if (status !== "draft") await admin.from("case_studies").update({ status }).eq("id", id);
  return id;
}
async function interview() {
  const { data: requestId } = await owner.client.rpc("create_proof_request", { ws, client_name: "Dana", client_email: "d@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: hex64() });
  const { data } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  return { id: String(data?.id) };
}

const ai = (reply: string | (() => string) = BETTER): AiClient & { calls: number } => {
  const client = { calls: 0, async complete() { client.calls++; return { text: typeof reply === "function" ? reply() : reply, inputTokens: 7, outputTokens: 3 }; } };
  return client;
};
const deps = (user: TestUser, role: string, client: AiClient = ai(), workspace = ws): RefineDeps => ({ supabase: user.client, ai: client, workspace: { id: workspace, role }, userId: user.id, model: "test-model", secret: SECRET });
const input = (caseStudyId: string, fieldPath = "sections.0.body", preset = "clearer") => ({ caseStudyId, fieldPath, preset });
const used = async () => Number((await admin.from("usage_counters").select("ai_refinements").eq("workspace_id", ws).maybeSingle()).data?.ai_refinements ?? 0);

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, viewer, outsider] = await Promise.all(["rf-owner", "rf-viewer", "rf-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Refine Co", type: "agency" })).data);
  outsiderWs = String((await outsider.client.rpc("create_workspace", { name: "Other Co", type: "agency" })).data);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().in("id", [ws, outsiderWs]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

beforeEach(async () => {
  await admin.from("usage_counters").delete().eq("workspace_id", ws);
});

describe("who can refine what", () => {
  it("a viewer is forbidden and the model is never called", async () => {
    const id = await study();
    const model = ai();
    expect(await refineText(deps(viewer, "viewer", model), input(id))).toEqual({ ok: false, error: "forbidden" });
    expect(model.calls).toBe(0);
  });

  it("a quote is refused with the explanation, and nothing is counted", async () => {
    const id = await study();
    const before = await used();
    const model = ai();
    const result = await refineText(deps(owner, "owner", model), input(id, "sections.1.quote.text"));
    expect(result).toEqual({ ok: false, error: "quote" });
    expect(REFINE_MESSAGES.quote).toContain("exact words");
    expect(await refineText(deps(owner, "owner", model), input(id, "sections.1.body"))).toEqual({ ok: false, error: "quote" });
    expect(model.calls).toBe(0);
    expect(await used()).toBe(before);
  });

  it("another workspace's case study is not found; a published page cannot be refined", async () => {
    const id = await study();
    expect(await refineText(deps(outsider, "owner", ai(), outsiderWs), input(id))).toEqual({ ok: false, error: "not_found" });
    // Inserted directly as published (a page that is already live).
    const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, content: { headline: "Live", client: {}, sections: [{ type: "challenge", title: "T", body: BODY }], tags: [] }, status: "published", slug: `rf-${hex64().slice(0, 8)}` }).select("id").single();
    const live = String(cs?.id);
    expect(await refineText(deps(owner, "owner"), input(live))).toEqual({ ok: false, error: "published" });
  });

  it("rejects fields off the allowlist and unknown input", async () => {
    const id = await study();
    for (const bad of ["tags.0", "client.name", "sections.0.title", "sections.7.body"]) {
      expect((await refineText(deps(owner, "owner"), input(id, bad))).ok, bad).toBe(false);
    }
    expect(await refineText(deps(owner, "owner"), { ...input(id), extra: true })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("refining", () => {
  it("returns a suggestion without saving, and gives the count back when the model fails the checks", async () => {
    const id = await study();
    const before = await used();
    const suggested = await refineText(deps(owner, "owner"), input(id));
    expect(suggested.ok).toBe(true);
    expect(await used()).toBe(before + 1);
    expect((await admin.from("case_studies").select("current_version, content").eq("id", id).single()).data).toMatchObject({ current_version: 1 });
    expect((await admin.from("text_refinements").select("id").eq("case_study_id", id)).data).toHaveLength(0);

    const bad = await refineText(deps(owner, "owner", ai("Onboarding took 14 days. Support tickets rose to 1,200 a month.")), input(id));
    expect(bad).toEqual({ ok: false, error: "unsafe" });
    expect(await used()).toBe(before + 1);
  });

  it("enforces the free plan's monthly limit, and a paid plan raises it", async () => {
    const id = await study();
    await admin.from("usage_counters").delete().eq("workspace_id", ws);
    for (let i = 0; i < 10; i++) expect((await refineText(deps(owner, "owner"), input(id))).ok, `call ${i + 1}`).toBe(true);
    const model = ai();
    expect(await refineText(deps(owner, "owner", model), input(id))).toEqual({ ok: false, error: "limit" });
    expect(model.calls).toBe(0);
    expect(await used()).toBe(10);
    await admin.from("workspaces").update({ plan: "pro" }).eq("id", ws);
    expect((await refineText(deps(owner, "owner"), input(id))).ok).toBe(true);
    await admin.from("workspaces").update({ plan: "free" }).eq("id", ws);
  });
});

describe("accepting and restoring", () => {
  it("applies one field as a new version, logs it, flags it, audits it, and limits to one a minute", async () => {
    const id = await study();
    const first = await refineText(deps(owner, "owner"), input(id));
    if (!first.ok) throw new Error("refine failed");
    const { suggestion } = first;

    // A tampered suggestion, or someone else's ticket, is refused.
    expect(await acceptRefinement(deps(owner, "owner"), { caseStudyId: id, fieldPath: "sections.0.body", suggested: `${suggestion.suggested} 99`, ticket: suggestion.ticket })).toEqual({ ok: false, error: "invalid" });
    expect(await acceptRefinement(deps(viewer, "viewer"), { caseStudyId: id, fieldPath: "sections.0.body", suggested: suggestion.suggested, ticket: suggestion.ticket })).toEqual({ ok: false, error: "forbidden" });

    const accepted = await acceptRefinement(deps(owner, "owner"), { caseStudyId: id, fieldPath: "sections.0.body", suggested: suggestion.suggested, ticket: suggestion.ticket });
    expect(accepted).toEqual({ ok: true, version: 2, text: BETTER });

    const { data: row } = await admin.from("case_studies").select("current_version, status, refined_fields, content").eq("id", id).single();
    expect(row).toMatchObject({ current_version: 2, status: "draft", refined_fields: ["sections.0.body"] });
    expect((row?.content as { sections: Array<{ body?: string }> }).sections[0].body).toBe(BETTER);
    expect((await admin.from("case_study_versions").select("version").eq("case_study_id", id)).data).toHaveLength(2);
    expect((await admin.from("text_refinements").select("field_path, original_text, suggested_text, accepted, preset, model, input_tokens, output_tokens").eq("case_study_id", id)).data).toEqual([
      { field_path: "sections.0.body", original_text: BODY, suggested_text: BETTER, accepted: true, preset: "clearer", model: "test-model", input_tokens: 7, output_tokens: 3 },
    ]);
    expect((await admin.from("audit_log").select("action").eq("target", id).eq("action", "case_study.refine")).data).toHaveLength(1);

    // Another accepted change within a minute is refused; the text it was made for is also stale now.
    const second = await refineText(deps(owner, "owner", ai("Onboarding took twelve days.".replace("twelve", "12"))), input(id, "headline"));
    if (second.ok) {
      expect(await acceptRefinement(deps(owner, "owner"), { caseStudyId: id, fieldPath: "headline", suggested: second.suggestion.suggested, ticket: second.suggestion.ticket })).toMatchObject({ ok: false });
    }
  });

  it("restores the wording from before the first refinement, and clears the flag", async () => {
    const id = await study();
    const old = new Date(Date.now() - 3_600_000).toISOString();
    await admin.from("case_studies").update({ refined_fields: ["sections.0.body"], content: { ...content("x"), sections: [{ type: "challenge", title: "Challenge", body: BETTER }, { type: "cta", title: "Next", body: "Talk to us." }] } }).eq("id", id);
    await admin.from("text_refinements").insert({ workspace_id: ws, case_study_id: id, version: 1, field_path: "sections.0.body", original_text: BODY, suggested_text: BETTER, accepted: true, preset: "clearer", created_at: old });

    expect(await restoreOriginal(deps(viewer, "viewer"), { caseStudyId: id, fieldPath: "sections.0.body" })).toEqual({ ok: false, error: "forbidden" });
    expect(await restoreOriginal(deps(owner, "owner"), { caseStudyId: id, fieldPath: "sections.1.body" })).toEqual({ ok: false, error: "nothing_to_restore" });
    const done = await restoreOriginal(deps(owner, "owner"), { caseStudyId: id, fieldPath: "sections.0.body" });
    expect(done).toMatchObject({ ok: true, text: BODY });
    expect((await admin.from("case_studies").select("refined_fields").eq("id", id).single()).data?.refined_fields).toEqual([]);
  });

  it("the database refuses a stale or quote target even when called directly", async () => {
    const id = await study();
    const call = (path: string, original: string) => owner.client.rpc("apply_text_refinement", { study: id, path, original, new_text: BETTER, preset: "clearer", model: "m", in_tokens: 0, out_tokens: 0, restoring: false });
    expect((await call("sections.0.body", "not the current text")).error?.code).toBe("40001");
    expect((await call("sections.1.body", "x")).error?.code).toBe("22023");
    expect((await call("sections.1.quote.text", "x")).error?.code).toBe("22023");
    expect((await viewer.client.rpc("apply_text_refinement", { study: id, path: "headline", original: "x", new_text: "y", preset: "clearer", model: "m", in_tokens: 0, out_tokens: 0, restoring: false })).error?.code).toBe("42501");
    expect((await viewer.client.rpc("reserve_refinement", { ws })).error?.code).toBe("42501");
  });
});
