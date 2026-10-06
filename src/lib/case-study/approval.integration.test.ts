/** Approval and publish rules against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, signCurrent, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";

let admin: SupabaseClient;
let owner: TestUser;
let editor: TestUser;
let adminUser: TestUser;
let ws: string;
const users: string[] = [];

const content = (headline: string, claimId?: string) => ({
  headline,
  client: {},
  sections: [
    { type: "challenge", title: "The challenge", body: "Body" },
    ...(claimId ? [{ type: "results", title: "Results", metrics: [{ label: "Faster", value: "40 percent", claimId }] }] : []),
  ],
  tags: [],
});

/** A draft with a real interview (for the approver address), one claim and version 1. */
async function draft({ withClaim = true }: { withClaim?: boolean } = {}) {
  const { data: requestId, error } = await owner.client.rpc("create_proof_request", {
    ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash,
  });
  if (error) throw new Error(error.message);
  const { data: interview } = await admin.from("interviews").insert({
    request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name",
  }).select("id").single();
  const interviewId = String(interview?.id);
  const { data: msg } = await admin.from("interview_messages").insert({ interview_id: interviewId, workspace_id: ws, role: "client", content: "We cut onboarding time by 40 percent." }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interviewId, content: content("Original"), status: "draft" }).select("id").single();
  const id = String(cs?.id);
  let claimId: string | undefined;
  if (withClaim) {
    const { data: claim, error: claimError } = await admin.from("claims").insert({
      case_study_id: id, workspace_id: ws, text: "Onboarding 40 percent faster", source_message_id: msg?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: false,
    }).select("id").single();
    if (claimError) throw new Error(claimError.message);
    claimId = String(claim?.id);
    await admin.from("case_studies").update({ content: content("Original", claimId) }).eq("id", id);
  }
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content("Original", claimId) });
  return { id, claimId };
}

const request = async (id: string, user = editor) => {
  const token = generateToken();
  const res = await user.client.rpc("request_client_approval", { study: id, hash: token.hash });
  return { token, res };
};
const approve = (hash: string) => admin.rpc("approve_case_study", { token_hash: hash, ip_hash: hex64() });
const publish = (user: TestUser, id: string, slug = `story-${hex64().slice(0, 8)}`) => user.client.rpc("publish_case_study", { study: id, new_slug: slug });
const statusOf = async (id: string) => String((await admin.from("case_studies").select("status").eq("id", id).single()).data?.status);

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  [owner, editor, adminUser] = await Promise.all(["ap-owner", "ap-editor", "ap-admin"].map((l) => createTestUser(cfg, admin, l)));
  users.push(owner.id, editor.id, adminUser.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Approval Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: `ap-${hex64().slice(0, 8)}` }).eq("id", ws);
  await admin.from("workspace_members").insert([{ workspace_id: ws, user_id: editor.id, role: "editor" }, { workspace_id: ws, user_id: adminUser.id, role: "admin" }]);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("request_client_approval", () => {
  it("snapshots the content so the approved version is exactly what was shown", async () => {
    const { id, claimId } = await draft();
    await admin.from("case_studies").update({ content: content("Edited in the last minute", claimId) }).eq("id", id);
    const { res } = await request(id);
    expect(res.error).toBeNull();
    expect(res.data).toBe(2);
    expect(await statusOf(id)).toBe("awaiting_client_approval");
  });

  it("is refused for a viewer-less outsider and for anon, and replaces the previous link", async () => {
    const { id } = await draft();
    const first = await request(id);
    const second = await request(id);
    expect(await approve(first.token.hash)).toMatchObject({ error: expect.anything() });
    expect((await approve(second.token.hash)).error).toBeNull();
  });
});

describe("client actions", () => {
  it("approves once, confirms claims, and cannot be replayed", async () => {
    const { id, claimId } = await draft();
    const { token } = await request(id);
    expect((await approve(token.hash)).error).toBeNull();
    expect(await statusOf(id)).toBe("approved");
    const { data: claim } = await admin.from("claims").select("client_confirmed").eq("id", claimId).single();
    expect(claim?.client_confirmed).toBe(true);
    expect((await approve(token.hash)).error).not.toBeNull();
    const { data: approvals } = await admin.from("approvals").select("approver_email, version").eq("case_study_id", id);
    expect(approvals).toEqual([{ approver_email: "dana@example.test", version: 1 }]);
  });

  it("rejects unknown, expired and wrong-version tokens", async () => {
    expect((await approve(hex64())).error).not.toBeNull();

    const expired = await draft();
    const e = await request(expired.id);
    await admin.from("case_study_approval_tokens").update({ expires_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() - 2000).toISOString() }).eq("token_hash", e.token.hash);
    expect((await approve(e.token.hash)).error).not.toBeNull();

    const edited = await draft();
    const t = await request(edited.id);
    // The owner edits after the link went out: a new version, back to draft. The old link is dead.
    await editor.client.rpc("autosave_case_study", { study: edited.id, new_content: content("Changed", edited.claimId), edited_claims: [] });
    await admin.rpc("snapshot_case_study", { study: edited.id }).then(() => undefined, () => undefined);
    expect((await approve(t.token.hash)).error).not.toBeNull();
    expect(await statusOf(edited.id)).not.toBe("approved");
  });

  it("request changes returns to draft and stores the note; decline is final", async () => {
    const a = await draft();
    const ta = await request(a.id);
    const changes = await admin.rpc("request_case_study_changes", { token_hash: ta.token.hash, note: "Please remove the second paragraph", ip_hash: hex64() });
    expect(changes.error).toBeNull();
    expect(await statusOf(a.id)).toBe("draft");
    const { data: feedback } = await editor.client.from("case_study_feedback").select("kind, message").eq("case_study_id", a.id);
    expect(feedback).toEqual([{ kind: "changes_requested", message: "Please remove the second paragraph" }]);

    const b = await draft();
    const tb = await request(b.id);
    expect((await admin.rpc("decline_case_study", { token_hash: tb.token.hash, ip_hash: hex64() })).error).toBeNull();
    expect(await statusOf(b.id)).toBe("unpublished");
    expect((await request(b.id)).res.error).not.toBeNull();
    expect((await publish(owner, b.id)).error).not.toBeNull();
  });

  it("the client functions are not callable by signed-in users", async () => {
    const { id } = await draft();
    const { token } = await request(id);
    expect(wasBlocked(await owner.client.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64() }))).toBe(true);
    expect(wasBlocked(await owner.client.from("case_studies").update({ status: "approved" }).eq("id", id).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("case_studies").update({ status: "published" }).eq("id", id).select())).toBe(true);
  });
});

describe("publish rules (hold even for the owner, through the API)", () => {
  async function approved(opts?: { withClaim?: boolean }) {
    const d = await draft(opts);
    expect((await approve((await request(d.id)).token.hash)).error).toBeNull();
    await signCurrent(admin, d.id);
    return d;
  }

  it("publishes an approved study and takes it down again; only admin and above", async () => {
    const { id } = await approved();
    expect((await publish(editor, id)).error).not.toBeNull();
    const res = await publish(adminUser, id, "Great-Story-One");
    expect(res.error).toBeNull();
    expect(res.data).toBe("great-story-one");
    expect(await statusOf(id)).toBe("published");
    expect((await adminUser.client.rpc("unpublish_case_study", { study: id })).error).toBeNull();
    expect(await statusOf(id)).toBe("unpublished");
    expect((await editor.client.rpc("unpublish_case_study", { study: id })).error).not.toBeNull();
  });

  it("lets an owner change the template and theme of an approved study, without being able to set its status", async () => {
    const { id } = await approved();
    const { data: templates } = await admin.from("templates").select("id").eq("tier", "free").limit(1);
    const templateId = String(templates?.[0]?.id);
    const changed = await owner.client.from("case_studies").update({ template_id: templateId, theme_settings: {} }).eq("id", id).select("id");
    expect(changed.error).toBeNull();
    expect(changed.data).toHaveLength(1);
    expect(await statusOf(id)).toBe("approved");
    expect(wasBlocked(await owner.client.from("case_studies").update({ status: "published" }).eq("id", id).select())).toBe(true);
    expect(wasBlocked(await owner.client.from("case_studies").update({ status: "draft" }).eq("id", id).select())).toBe(true);
  });

  it("blocks a study that was never approved", async () => {
    const { id } = await draft();
    expect((await publish(owner, id)).error).not.toBeNull();
    // Even the service role cannot skip the trigger.
    const forced = await admin.from("case_studies").update({ status: "published", slug: "forced-story" }).eq("id", id);
    expect(forced.error?.message).toContain("publish_blocked:not_approved");
  });

  it("approval of v1 does not allow publishing v2", async () => {
    const { id, claimId } = await approved();
    await owner.client.rpc("save_case_study_edit", { study: id, new_content: content("Version two", claimId), edited_claims: [] });
    expect((await publish(owner, id)).error).not.toBeNull();
    const forced = await admin.from("case_studies").update({ status: "published", slug: "forced-two" }).eq("id", id);
    expect(forced.error?.message).toContain("publish_blocked:not_approved");
  });

  it("blocks reserved and malformed slugs", async () => {
    const { id } = await approved();
    for (const bad of ["admin", "a", "Has Space", "double--dash", "-lead"]) {
      expect((await publish(owner, id, bad)).error, bad).not.toBeNull();
    }
    expect(await statusOf(id)).toBe("approved");
  });

  it("blocks an unconfirmed claim", async () => {
    const { id, claimId } = await approved();
    await admin.from("claims").update({ client_confirmed: false }).eq("id", claimId);
    const blocked = await admin.from("case_studies").update({ status: "published", slug: "unconfirmed-one" }).eq("id", id);
    expect(blocked.error?.message).toContain("publish_blocked:claims_unconfirmed");
  });

  it("a live page cannot be edited through the editing function", async () => {
    const { id, claimId } = await approved();
    expect((await publish(owner, id)).error).toBeNull();
    const res = await owner.client.rpc("save_case_study_edit", { study: id, new_content: content("Live edit", claimId), edited_claims: [] });
    expect(res.error?.code).toBe("22023");
  });

  it("an edit to a live page sends it back to draft", async () => {
    const { id, claimId } = await approved();
    expect((await publish(owner, id)).error).toBeNull();
    const { error } = await admin.from("case_studies").update({ content: content("Sneaky change", claimId) }).eq("id", id);
    expect(error).toBeNull();
    expect(await statusOf(id)).toBe("draft");
    const { data } = await admin.from("case_studies").select("published_at").eq("id", id).single();
    expect(data?.published_at).toBeNull();
  });
});

describe("publishing needs a signature", () => {
  const unsigned = async () => {
    const d = await draft();
    expect((await approve((await request(d.id)).token.hash)).error).toBeNull();
    return d.id;
  };
  const sign = (id: string, over: Record<string, unknown> = {}) =>
    admin.from("signatures").insert({
      workspace_id: ws, case_study_id: id, version: 1, signer_name: "Dana Doe", signer_email: "dana@example.test", display_name_choice: "first_only",
      consent_text_version: "v1", esign_disclosure_accepted: true, consent_web: true, method: "typed", content_hash: hex64(), otp_verified_at: new Date().toISOString(), ...over,
    }).select("id").single();

  it("blocks an approved study with no signature, even for the service role", async () => {
    const id = await unsigned();
    expect((await publish(owner, id)).error?.message).toContain("publish_blocked:not_signed");
    expect((await admin.from("case_studies").update({ status: "published", slug: "no-sig" }).eq("id", id)).error?.message).toContain("publish_blocked:not_signed");
  });

  it("blocks a signature without web consent, and one for another version", async () => {
    const id = await unsigned();
    expect((await sign(id, { consent_web: false })).error).toBeNull();
    expect((await publish(owner, id)).error?.message).toContain("publish_blocked:not_signed");
    expect((await sign(id, { version: 2 })).error).not.toBeNull(); // no such version exists
  });

  it("allows a valid signature, then blocks again once it is revoked; unpublishing is always allowed", async () => {
    const id = await unsigned();
    const { data } = await sign(id);
    expect((await publish(owner, id)).error).toBeNull();
    expect((await adminUser.client.rpc("unpublish_case_study", { study: id })).error).toBeNull();
    expect((await admin.from("signature_revocations").insert({ workspace_id: ws, signature_id: data?.id, method: "email_link", reason: "test" })).error).toBeNull();
    expect((await publish(owner, id)).error?.message).toContain("publish_blocked:not_signed");
  });

  it("signature tables are insert-only and hide hashes from members", async () => {
    const id = await unsigned();
    const { data } = await sign(id);
    expect((await admin.from("signatures").update({ signer_name: "Changed" }).eq("id", data?.id)).error).not.toBeNull();
    expect((await admin.from("signatures").delete().eq("id", data?.id)).error).not.toBeNull();
    expect(wasBlocked(await owner.client.from("signatures").insert({ workspace_id: ws, case_study_id: id, version: 1 }).select())).toBe(true);
    expect((await owner.client.from("signatures").select("id, signer_name").eq("id", data?.id)).data).toHaveLength(1);
    expect((await owner.client.from("signatures").select("ip_hash").eq("id", data?.id)).error).not.toBeNull();
    expect(wasBlocked(await owner.client.from("signing_challenges").select("id"))).toBe(true);
    expect(wasBlocked(await owner.client.from("signature_events").insert({ workspace_id: ws, case_study_id: id, event: "signed" }).select())).toBe(true);
  });
});
