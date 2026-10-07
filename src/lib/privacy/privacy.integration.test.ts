/** Deletion, retention and erasure against the real database and Storage (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, signCurrent, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import { generateToken } from "@/lib/security/tokens";
import { eraseStory } from "./erase";
import { listFiles } from "./files";
import { runPurge } from "./purge";

let admin: SupabaseClient;
const users: string[] = [];
const workspaces: string[] = [];

const content = (h: string, claimId?: string) => ({
  headline: h, client: { name: "Dana" },
  sections: [{ type: "challenge", title: "The challenge", body: "Body" }, ...(claimId ? [{ type: "results", title: "Results", metrics: [{ label: "Faster", value: "40 percent", claimId }] }] : [])],
  tags: [],
});

interface Tenant {
  user: TestUser;
  ws: string;
  requestId: string;
  interviewId: string;
  studyId: string;
  files: string[];
}

/** A workspace with a row in every kind of table that holds personal data, and real files in Storage. */
async function tenant(label: string, { published = true }: { published?: boolean } = {}): Promise<Tenant> {
  const cfg = loadLocalConfig();
  const user = await createTestUser(cfg, admin, label);
  users.push(user.id);
  const ws = String((await user.client.rpc("create_workspace", { name: `${label} Co`, type: "agency" })).data);
  workspaces.push(ws);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: `pv-${hex64().slice(0, 8)}` }).eq("id", ws);

  const { data: requestId } = await user.client.rpc("create_proof_request", { ws, client_name: `${label} Client`, client_email: `${label}-client@example.test`, project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const interviewId = String(interview?.id);
  const { data: message } = await admin.from("interview_messages").insert({ interview_id: interviewId, workspace_id: ws, role: "client", content: `${label} TRANSCRIPT we cut onboarding time by 40 percent` }).select("id").single();

  const upload = `${ws}/${interviewId}/headshot.webp`;
  const logo = `${ws}/logos/logo.webp`;
  const exported = `${ws}/exports/export.pdf`;
  const bytes = new Uint8Array([82, 73, 70, 70]);
  for (const [bucket, path, type] of [["uploads", upload, "image/webp"], ["uploads", logo, "image/webp"], ["exports", exported, "application/pdf"]] as const) {
    const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
  await admin.from("interview_uploads").insert({ interview_id: interviewId, workspace_id: ws, file_path: upload, kind: "headshot", size_bytes: 4 });

  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interviewId, content: content(`${label} STORY`), status: "draft" }).select("id").single();
  const studyId = String(cs?.id);
  const { data: claim } = await admin.from("claims").insert({ case_study_id: studyId, workspace_id: ws, text: "Faster", source_message_id: message?.id, source_quote: "cut onboarding time by 40 percent", client_confirmed: true }).select("id").single();
  const finalContent = { ...content(`${label} STORY`, String(claim?.id)), client: { name: "Dana", logoPath: logo } };
  await admin.from("case_studies").update({ content: finalContent }).eq("id", studyId);
  await admin.from("case_study_versions").insert({ case_study_id: studyId, workspace_id: ws, version: 1, content: finalContent });
  await admin.from("approvals").insert({ case_study_id: studyId, workspace_id: ws, version: 1, approver_email: `${label}-client@example.test`, method: "email_link" });
  await admin.from("case_study_previews").insert({ case_study_id: studyId, workspace_id: ws, token_hash: hex64(), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
  if (published) await signCurrent(admin, studyId);
  if (published) expect((await admin.from("case_studies").update({ status: "published", slug: `st-${hex64().slice(0, 8)}` }).eq("id", studyId)).error).toBeNull();
  await admin.from("page_events").insert({ case_study_id: studyId, workspace_id: ws, type: "view" });
  await admin.from("case_study_feedback").insert({ case_study_id: studyId, workspace_id: ws, version: 1, kind: "changes_requested", message: `${label} FEEDBACK` });
  await admin.from("referrals").insert({ workspace_id: ws, interview_id: interviewId, referred_name: `${label} Referral`, referred_contact: `${label}-ref@example.test` });
  await admin.from("wall_settings").insert({ workspace_id: ws, enabled: false });
  await admin.from("workspace_communities").insert({ workspace_id: ws, community_id: "b0000000-0000-4000-8000-000000000001", status: "saved", notes: `${label} NOTE` });
  await admin.from("notification_preferences").insert({ user_id: user.id, workspace_id: ws });
  await admin.from("usage_counters").upsert({ workspace_id: ws, period: new Date().toISOString().slice(0, 7) + "-01", interviews: 1 });
  return { user, ws, requestId: String(requestId), interviewId, studyId, files: [upload, logo, exported] };
}

/** Every public table that has a workspace_id column. */
async function tenantTables(): Promise<string[]> {
  return ["proof_requests", "interviews", "interview_messages", "interview_uploads", "referrals", "case_studies", "case_study_versions", "claims", "approvals", "case_study_feedback", "case_study_approval_tokens", "case_study_previews", "takedown_requests", "page_events", "wall_settings", "workspace_communities", "social_profiles", "social_posts", "signatures", "signature_revocations", "signature_events", "text_refinements", "demos", "demo_versions", "demo_assets", "demo_embed_origins", "demo_leads", "demo_events", "workspace_members", "workspace_invites", "subscriptions", "usage_counters", "audit_log", "notification_preferences", "push_subscriptions", "template_entitlements", "question_flows"];
}

async function rowsLeft(ws: string): Promise<Record<string, number>> {
  const left: Record<string, number> = {};
  for (const table of await tenantTables()) {
    const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", ws);
    if (count) left[table] = count;
  }
  const { count } = await admin.from("workspaces").select("*", { count: "exact", head: true }).eq("id", ws);
  if (count) left.workspaces = count;
  return left;
}

const filesLeft = async (ws: string) => [...(await listFiles(admin, "uploads", ws)), ...(await listFiles(admin, "exports", ws))];
const backdate = (ws: string, days: number) => admin.from("workspaces").update({ deletion_requested_at: new Date(Date.now() - days * 86_400_000).toISOString() }).eq("id", ws);

beforeAll(() => {
  admin = makeClient(loadLocalConfig(), "service");
});

afterAll(async () => {
  for (const ws of workspaces) {
    await admin.from("workspaces").update({ deletion_requested_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).eq("id", ws);
    await admin.rpc("hard_delete_workspace", { ws });
    await admin.from("workspaces").delete().eq("id", ws);
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("workspace deletion", () => {
  it("is requested by an owner only, hides and stops everything at once, and can be cancelled", async () => {
    const t = await tenant("wd-a");
    const editor = await createTestUser(loadLocalConfig(), admin, "wd-editor");
    users.push(editor.id);
    await admin.from("workspace_members").insert({ workspace_id: t.ws, user_id: editor.id, role: "editor" });

    expect((await editor.client.rpc("request_workspace_deletion", { ws: t.ws })).error, "an editor requested deletion").not.toBeNull();
    expect(wasBlocked(await t.user.client.from("workspaces").delete().eq("id", t.ws).select()), "direct delete skipped the grace period").toBe(true);

    const when = await t.user.client.rpc("request_workspace_deletion", { ws: t.ws });
    expect(when.error).toBeNull();
    expect(Date.parse(String(when.data)) - Date.now()).toBeGreaterThan(29.9 * 86_400_000);

    // Public pages are hidden, links revoked, nothing new can be created, and nothing is deleted yet.
    const { data: slugRow } = await admin.from("workspaces").select("subdomain_slug").eq("id", t.ws).single();
    const anon = makeClient(loadLocalConfig(), "anon");
    expect((await anon.from("public_case_studies").select("slug").eq("workspace_slug", slugRow?.subdomain_slug)).data ?? []).toHaveLength(0);
    expect((await admin.from("proof_requests").select("revoked_at").eq("id", t.requestId).single()).data?.revoked_at).not.toBeNull();
    expect((await admin.from("case_study_previews").select("revoked_at").eq("case_study_id", t.studyId)).data?.every((p) => p.revoked_at !== null)).toBe(true);
    expect((await t.user.client.rpc("create_proof_request", { ws: t.ws, client_name: "x", client_email: "x@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash })).error).not.toBeNull();
    expect(Object.keys(await rowsLeft(t.ws)).length).toBeGreaterThan(10);
    expect(await filesLeft(t.ws)).toHaveLength(3);

    // Not due yet: the job does nothing.
    const early = await runPurge(admin);
    expect(early.workspaces).toBe(0);
    expect((await admin.rpc("hard_delete_workspace", { ws: t.ws })).data, "deleted before the grace period ended").toBe(false);

    expect((await editor.client.rpc("cancel_workspace_deletion", { ws: t.ws })).error).not.toBeNull();
    expect((await t.user.client.rpc("cancel_workspace_deletion", { ws: t.ws })).error).toBeNull();
    expect((await admin.from("workspaces").select("deletion_requested_at").eq("id", t.ws).single()).data?.deletion_requested_at).toBeNull();
    expect((await anon.from("public_case_studies").select("slug").eq("workspace_slug", slugRow?.subdomain_slug)).data).toHaveLength(1);
  });

  it("refuses while a paid subscription is active, so nobody is billed for a workspace that disappears", async () => {
    const t = await tenant("wd-sub");
    await admin.from("subscriptions").upsert({ workspace_id: t.ws, stripe_customer_id: `cus_${hex64().slice(0, 12)}`, plan: "pro", status: "active" });
    const res = await t.user.client.rpc("request_workspace_deletion", { ws: t.ws });
    expect(res.error?.message).toContain("subscription_active");
    await admin.from("subscriptions").update({ status: "canceled" }).eq("workspace_id", t.ws);
    expect((await t.user.client.rpc("request_workspace_deletion", { ws: t.ws })).error).toBeNull();
  });

  it("after the 30 days the job removes every row and every file, and only that workspace", async () => {
    const gone = await tenant("wd-gone");
    const kept = await tenant("wd-kept");
    expect((await gone.user.client.rpc("request_workspace_deletion", { ws: gone.ws })).error).toBeNull();
    await backdate(gone.ws, 31);

    const summary = await runPurge(admin);
    expect(summary.workspaces).toBeGreaterThanOrEqual(1);
    expect(summary.failures).toBe(0);

    expect(await rowsLeft(gone.ws), "rows remain after deletion").toEqual({});
    expect(await filesLeft(gone.ws), "files remain after deletion").toEqual([]);
    // Nothing else was touched.
    expect(Object.keys(await rowsLeft(kept.ws)).length).toBeGreaterThan(10);
    expect(await filesLeft(kept.ws)).toHaveLength(3);
    // The append-only tables did not stop it, and no client could have asked them to.
    expect((await admin.from("case_study_versions").select("id", { count: "exact", head: true }).eq("case_study_id", gone.studyId)).count).toBe(0);
  }, 120_000);

  it("cannot be switched on by a user: the purge flag is not reachable from the API", async () => {
    const t = await tenant("wd-flag");
    expect((await t.user.client.rpc("set_config", { setting_name: "pe.purge", new_value: "on", is_local: false })).error).not.toBeNull();
    expect((await t.user.client.from("case_study_versions").delete().eq("case_study_id", t.studyId).select()).data ?? []).toHaveLength(0);
    expect((await admin.from("case_study_versions").select("id").eq("case_study_id", t.studyId)).data).toHaveLength(1);
    expect((await admin.from("case_study_versions").delete().eq("case_study_id", t.studyId)).error, "append-only no longer holds for the service role").not.toBeNull();
  });
});

describe("account deletion", () => {
  it("removes the user and the workspaces they alone own after 30 days, and is refused while others depend on them", async () => {
    const t = await tenant("ad-solo");
    const when = await t.user.client.rpc("request_account_deletion");
    expect(when.error).toBeNull();
    expect((await admin.from("workspaces").select("deletion_requested_at").eq("id", t.ws).single()).data?.deletion_requested_at).not.toBeNull();
    await backdate(t.ws, 31);
    await admin.from("profiles").update({ deletion_requested_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", t.user.id);

    const summary = await runPurge(admin);
    expect(summary.accounts).toBeGreaterThanOrEqual(1);
    expect(await rowsLeft(t.ws)).toEqual({});
    expect(await filesLeft(t.ws)).toEqual([]);
    expect((await admin.auth.admin.getUserById(t.user.id)).data.user, "the account still exists").toBeNull();
    expect((await admin.from("profiles").select("id").eq("id", t.user.id)).data).toHaveLength(0);

    const shared = await tenant("ad-shared");
    const member = await createTestUser(loadLocalConfig(), admin, "ad-member");
    users.push(member.id);
    await admin.from("workspace_members").insert({ workspace_id: shared.ws, user_id: member.id, role: "editor" });
    const refused = await shared.user.client.rpc("request_account_deletion");
    expect(refused.error?.message).toContain("transfer_ownership");
    expect((await admin.from("profiles").select("deletion_requested_at").eq("id", shared.user.id).single()).data?.deletion_requested_at).toBeNull();
    // A member (not an owner) can leave on their own, and cancel again.
    expect((await member.client.rpc("request_account_deletion")).error).toBeNull();
    expect((await member.client.rpc("cancel_account_deletion")).error).toBeNull();
    expect((await admin.from("profiles").select("deletion_requested_at").eq("id", member.id).single()).data?.deletion_requested_at).toBeNull();
  }, 120_000);
});

describe("delete this interview", () => {
  it("removes the transcript, uploads and claims, takes the case study offline, and leaves the rest", async () => {
    const t = await tenant("di-a");
    const editor = await createTestUser(loadLocalConfig(), admin, "di-editor");
    users.push(editor.id);
    await admin.from("workspace_members").insert({ workspace_id: t.ws, user_id: editor.id, role: "editor" });
    expect((await editor.client.rpc("delete_interview", { ws: t.ws, interview: t.interviewId })).error, "an editor deleted an interview").not.toBeNull();
    const outsider = await createTestUser(loadLocalConfig(), admin, "di-out");
    users.push(outsider.id);
    expect((await outsider.client.rpc("delete_interview", { ws: t.ws, interview: t.interviewId })).error).not.toBeNull();

    const res = await t.user.client.rpc("delete_interview", { ws: t.ws, interview: t.interviewId });
    expect(res.error).toBeNull();
    for (const table of ["interviews", "interview_messages", "interview_uploads", "claims", "referrals"]) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", t.ws);
      expect(count, `${table} still holds data from the deleted interview`).toBe(0);
    }
    const { data: study } = await admin.from("case_studies").select("status, interview_id").eq("id", t.studyId).single();
    expect(study).toEqual({ status: "unpublished", interview_id: null });
    // It cannot go live again: its numbers no longer point at a claim.
    const again = await t.user.client.rpc("publish_case_study", { study: t.studyId, new_slug: `again-${hex64().slice(0, 6)}` });
    expect(again.error).not.toBeNull();
    // The workspace itself, its request record and other data are untouched.
    expect((await admin.from("proof_requests").select("id").eq("id", t.requestId)).data).toHaveLength(1);
    expect((await admin.from("workspaces").select("id").eq("id", t.ws)).data).toHaveLength(1);
  });
});

describe("the client's removal link", () => {
  it("erases the story, the interview, the request and every file, whatever state the story is in", async () => {
    for (const published of [true, false]) {
      const t = await tenant(`er-${published ? "live" : "draft"}`, { published });
      const kept = await tenant(`er-kept-${published ? "a" : "b"}`);
      expect(await eraseStory(admin, t.studyId)).toBe(true);

      for (const table of ["case_studies", "case_study_versions", "approvals", "case_study_feedback", "case_study_previews", "claims", "page_events", "interviews", "interview_messages", "interview_uploads", "referrals", "proof_requests"]) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", t.ws);
        expect(count, `${table} still has rows after erasure`).toBe(0);
      }
      expect((await listFiles(admin, "uploads", t.ws)).filter((f) => f.includes(t.interviewId) || f.includes("/logos/"))).toEqual([]);
      // The workspace and other clients' stories are untouched; the audit trail notes the erasure.
      expect((await admin.from("workspaces").select("id").eq("id", t.ws)).data).toHaveLength(1);
      expect((await admin.from("case_studies").select("id").eq("id", kept.studyId)).data).toHaveLength(1);
      expect((await admin.from("audit_log").select("action").eq("workspace_id", t.ws).eq("action", "client.erase")).data).toHaveLength(1);
      expect(await eraseStory(admin, t.studyId), "a second erase must be a no-op").toBe(false);
    }
  }, 120_000);
});

describe("retention", () => {
  it("purges requests that never completed after 90 days, with their files, and keeps everything else", async () => {
    const t = await tenant("rt-a");
    const make = async (status: string, ageDays: number, withUpload = false) => {
      const { data: request } = await admin.from("proof_requests").insert({ workspace_id: t.ws, client_name: "Old", client_email: `old-${hex64().slice(0, 6)}@example.test`, flow_type: "agency", token_hash: hex64(), expires_at: new Date(Date.now() - (ageDays - 20) * 86_400_000).toISOString(), status, created_at: new Date(Date.now() - ageDays * 86_400_000).toISOString() }).select("id").single();
      let path: string | null = null;
      if (withUpload) {
        const { data: i } = await admin.from("interviews").insert({ request_id: request?.id, workspace_id: t.ws, status: "started", consent_given: true, consent_text_version: "v1", started_at: new Date(Date.now() - ageDays * 86_400_000).toISOString() }).select("id").single();
        path = `${t.ws}/${i?.id}/abandoned.webp`;
        await admin.storage.from("uploads").upload(path, new Uint8Array([1, 2, 3]), { contentType: "image/webp", upsert: true });
        await admin.from("interview_uploads").insert({ interview_id: i?.id, workspace_id: t.ws, file_path: path, kind: "headshot", size_bytes: 3 });
      }
      return { id: String(request?.id), path };
    };
    const old = await make("sent", 100, true);
    const revoked = await make("revoked", 120);
    const recent = await make("sent", 10, true);
    const completedOld = await make("completed", 200);

    const summary = await runPurge(admin);
    expect(summary.staleRequests).toBeGreaterThanOrEqual(2);
    const exists = async (id: string) => ((await admin.from("proof_requests").select("id").eq("id", id)).data ?? []).length === 1;
    expect(await exists(old.id)).toBe(false);
    expect(await exists(revoked.id)).toBe(false);
    expect(await exists(recent.id), "a recent request was purged").toBe(true);
    expect(await exists(completedOld.id), "a completed request was purged").toBe(true);
    expect(await exists(t.requestId), "the completed interview's request was purged").toBe(true);
    const files = await listFiles(admin, "uploads", t.ws);
    expect(files.some((f) => f === old.path), "the abandoned upload remains").toBe(false);
    expect(files.some((f) => f === recent.path)).toBe(true);
    expect((await admin.rpc("purge_requests", { ids: [recent.id] })).data, "purge_requests deleted something that is not stale").toBe(0);
  }, 120_000);
});
