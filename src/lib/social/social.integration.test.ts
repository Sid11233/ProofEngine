/** Social drafts against the real database (npm run test:isolation): consent, publish state, roles. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, signCurrent, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";

let admin: SupabaseClient;
let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let anon: SupabaseClient;
let ws: string;
const users: string[] = [];

const content = (claimId: string) => ({
  headline: "Original", client: {},
  sections: [{ type: "results", title: "Results", metrics: [{ label: "Faster", value: "40 percent", claimId }] }],
  tags: [],
});

/** Approved by the client with or without social consent; optionally published. */
async function story({ social, publish }: { social: boolean; publish: boolean }) {
  const { data: requestId } = await owner.client.rpc("create_proof_request", {
    ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash,
  });
  const { data: interview } = await admin.from("interviews").insert({
    request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name",
  }).select("id").single();
  const { data: msg } = await admin.from("interview_messages").insert({ interview_id: interview?.id, workspace_id: ws, role: "client", content: "We cut onboarding time by 40 percent." }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: {}, status: "draft" }).select("id").single();
  const id = String(cs?.id);
  const { data: claim } = await admin.from("claims").insert({ case_study_id: id, workspace_id: ws, text: "Onboarding 40 percent faster", source_message_id: msg?.id, source_quote: "cut onboarding time by 40 percent" }).select("id").single();
  await admin.from("case_studies").update({ content: content(String(claim?.id)) }).eq("id", id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content(String(claim?.id)) });
  const token = generateToken();
  await owner.client.rpc("request_client_approval", { study: id, hash: token.hash });
  const approved = await admin.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64(), social });
  if (approved.error) throw new Error(approved.error.message);
  if (publish) {
    await signCurrent(admin, id, { social });
    const res = await owner.client.rpc("publish_case_study", { study: id, new_slug: `s-${hex64().slice(0, 8)}` });
    if (res.error) throw new Error(res.error.message);
  }
  return id;
}

const drafts = [{ network: "x", body: "We cut onboarding time by 40 percent." }, { network: "linkedin", body: "Onboarding got 40 percent faster." }];
const create = (user: { client: SupabaseClient }, id: string, body = drafts) => user.client.rpc("create_social_drafts", { study: id, drafts: body });

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, viewer, outsider] = await Promise.all(["so-owner", "so-viewer", "so-out"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, viewer.id, outsider.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Social Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: `so-${hex64().slice(0, 8)}` }).eq("id", ws);
  await admin.from("workspace_members").insert({ workspace_id: ws, user_id: viewer.id, role: "viewer" });
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("create_social_drafts", () => {
  it("refuses when the client did not agree to social posts", async () => {
    const id = await story({ social: false, publish: true });
    const res = await create(owner, id);
    expect(res.error?.code).toBe("22023");
    expect((await admin.from("social_posts").select("id").eq("case_study_id", id)).data).toHaveLength(0);
  });

  it("refuses an unpublished case study even with consent", async () => {
    const id = await story({ social: true, publish: false });
    expect((await create(owner, id)).error?.code).toBe("22023");
  });

  it("writes drafts for a published, consented case study, and keeps saved ones when replacing", async () => {
    const id = await story({ social: true, publish: true });
    const first = await create(owner, id);
    expect(first.error).toBeNull();
    expect(first.data).toBe(2);
    const saved = (await admin.from("social_posts").select("id").eq("case_study_id", id).eq("network", "x").single()).data?.id;
    expect((await owner.client.from("social_posts").update({ status: "saved" }).eq("id", saved)).error).toBeNull();
    expect((await create(owner, id)).error).toBeNull();
    const rows = (await admin.from("social_posts").select("network, variant, status").eq("case_study_id", id)).data ?? [];
    expect(rows.filter((r) => r.status === "saved")).toHaveLength(1);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => `${r.network}${r.variant}`)).size).toBe(3);
  });

  it("refuses a viewer, an outsider and anon", async () => {
    const id = await story({ social: true, publish: true });
    expect((await create(viewer, id)).error?.code).toBe("42501");
    expect((await create(outsider, id)).error?.code).toBe("42501");
    expect((await create({ client: anon }, id)).error).not.toBeNull();
  });

  it("rejects unknown networks and oversize bodies", async () => {
    const id = await story({ social: true, publish: true });
    expect((await create(owner, id, [{ network: "myspace", body: "x" }])).error).not.toBeNull();
    expect((await create(owner, id, [{ network: "x", body: "a".repeat(3001) }])).error).not.toBeNull();
  });

  it("cannot be bypassed with a direct insert, and an outsider cannot read the drafts", async () => {
    const id = await story({ social: false, publish: true });
    const direct = await owner.client.from("social_posts").insert({ workspace_id: ws, case_study_id: id, network: "x", variant: 1, body: "sneaky" }).select();
    expect(wasBlocked(direct)).toBe(true);
    const ok = await story({ social: true, publish: true });
    await create(owner, ok);
    expect((await outsider.client.from("social_posts").select("id").eq("case_study_id", ok)).data ?? []).toHaveLength(0);
  });
});
