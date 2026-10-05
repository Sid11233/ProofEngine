/** Reports, emergency disable and notification against the real database (npm run test:isolation). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, hex64, loadLocalConfig, makeClient, wasBlocked, type TestUser } from "../../../supabase/tests/isolation/harness";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { generateToken } from "@/lib/security/tokens";
import { loadPublishedStudy } from "@/lib/public/load";
import { submitReport } from "./service";

let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: TestUser;
let outsider: TestUser;
let ws: string;
let wsSlug: string;

const content = (headline: string) => ({ headline, client: { name: "Dana" }, sections: [{ type: "challenge", title: "The challenge", body: "Body" }], tags: [] });

async function published(headline = "Reported story") {
  const slug = `r-${hex64().slice(0, 8)}`;
  const { data: requestId } = await owner.client.rpc("create_proof_request", { ws, client_name: "Dana Doe", client_email: "dana@example.test", project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: content(headline), status: "draft" }).select("id").single();
  const id = String(cs?.id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content(headline) });
  const token = generateToken();
  await owner.client.rpc("request_client_approval", { study: id, hash: token.hash });
  await admin.rpc("approve_case_study", { token_hash: token.hash, ip_hash: hex64() });
  expect((await owner.client.rpc("publish_case_study", { study: id, new_slug: slug })).error).toBeNull();
  return { id, slug };
}

const report = (slug: string, email = "visitor@example.com", reason = "I am in this story and did not agree.") =>
  admin.rpc("create_takedown_request", { ws_slug: wsSlug, study_slug: slug, report_reason: reason, email, ip: hex64() });

function fakeSender() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = { async send(m) { sent.push(m); return true; } };
  return { sender, sent };
}

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  anon = makeClient(cfg, "anon");
  [owner, outsider] = await Promise.all(["td-owner", "td-out"].map((l) => createTestUser(cfg, admin, l)));
  ws = String((await owner.client.rpc("create_workspace", { name: "Takedown Co", type: "agency" })).data);
  wsSlug = `td-${hex64().slice(0, 8)}`;
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: wsSlug }).eq("id", ws);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const u of [owner, outsider]) await admin.auth.admin.deleteUser(u.id);
}, 120_000);

describe("create_takedown_request", () => {
  it("stores a report for a published page and does not remove anything by itself", async () => {
    const s = await published();
    const res = await report(s.slug);
    expect(res.error).toBeNull();
    const { data } = await owner.client.from("takedown_requests").select("reason, contact_email, status").eq("case_study_id", s.id);
    expect(data).toEqual([{ reason: "I am in this story and did not agree.", contact_email: "visitor@example.com", status: "open" }]);
    expect(await loadPublishedStudy(anon, wsSlug, s.slug), "a report took the page down on its own").not.toBeNull();
  });

  it("is not callable by anonymous or signed-in users, and anon cannot read reports", async () => {
    const s = await published();
    const args = { ws_slug: wsSlug, study_slug: s.slug, report_reason: "I am in this story", email: "x@example.com", ip: hex64() };
    expect(wasBlocked(await anon.rpc("create_takedown_request", args))).toBe(true);
    expect(wasBlocked(await owner.client.rpc("create_takedown_request", args))).toBe(true);
    expect((await anon.from("takedown_requests").select("*")).data ?? []).toHaveLength(0);
    expect((await outsider.client.from("takedown_requests").select("*").eq("case_study_id", s.id)).data ?? []).toHaveLength(0);
  });

  it("answers the same for a missing page, refuses duplicates from one contact and caps open reports", async () => {
    expect((await report("does-not-exist")).error?.code).toBe("P0002");
    const s = await published();
    expect((await report(s.slug, "same@example.com")).error).toBeNull();
    expect((await report(s.slug, "SAME@example.com")).error?.code, "duplicate contact").toBe("23505");
    for (let i = 0; i < 19; i++) expect((await report(s.slug, `p${i}@example.com`)).error).toBeNull();
    expect((await report(s.slug, "one-too-many@example.com")).error?.code).toBe("54000");
  });

  it("rejects an invalid contact or empty reason at the database too", async () => {
    const s = await published();
    expect((await report(s.slug, "not-an-email")).error).not.toBeNull();
    expect((await report(s.slug, "ok@example.com", "")).error).not.toBeNull();
  });
});

describe("emergency disable", () => {
  it("takes the page offline everywhere, blocks republishing, and can be restored", async () => {
    const s = await published();
    await report(s.slug);
    expect((await admin.rpc("set_case_study_disabled", { study: s.id, disable: true })).error).toBeNull();
    expect(await loadPublishedStudy(anon, wsSlug, s.slug), "a disabled page is still public").toBeNull();
    const { data: row } = await admin.from("case_studies").select("status, disabled_at").eq("id", s.id).single();
    expect(row?.status).toBe("unpublished");
    expect(row?.disabled_at).not.toBeNull();
    const { data: reports } = await admin.from("takedown_requests").select("status").eq("case_study_id", s.id);
    expect(reports).toEqual([{ status: "actioned" }]);

    // The workspace cannot bring it back, even as owner or through a direct update.
    const again = await owner.client.rpc("publish_case_study", { study: s.id, new_slug: s.slug });
    expect(again.error?.message).toContain("publish_blocked:disabled");
    expect((await admin.from("case_studies").update({ status: "published" }).eq("id", s.id)).error?.message).toContain("publish_blocked:disabled");
    expect(wasBlocked(await owner.client.rpc("set_case_study_disabled", { study: s.id, disable: false }))).toBe(true);
    expect(wasBlocked(await owner.client.from("case_studies").update({ disabled_at: null }).eq("id", s.id).select())).toBe(true);

    expect((await admin.rpc("set_case_study_disabled", { study: s.id, disable: false })).error).toBeNull();
    expect((await owner.client.rpc("publish_case_study", { study: s.id, new_slug: s.slug })).error).toBeNull();
  });

  it("resolve_takedown only accepts known statuses", async () => {
    const s = await published();
    await report(s.slug);
    const { data } = await admin.from("takedown_requests").select("id").eq("case_study_id", s.id).single();
    expect((await admin.rpc("resolve_takedown", { request: data?.id, new_status: "dismissed" })).error).toBeNull();
    expect((await admin.rpc("resolve_takedown", { request: data?.id, new_status: "deleted" })).error).not.toBeNull();
    expect(wasBlocked(await owner.client.rpc("resolve_takedown", { request: data?.id, new_status: "actioned" }))).toBe(true);
  });
});

describe("submitReport", () => {
  it("tells workspace owners and the platform admin by plain-text email, once each", async () => {
    const s = await published("Headline here");
    const { sender, sent } = fakeSender();
    const outcome = await submitReport(
      { admin, sender, platformAdmins: ["ops@example.com", owner.email], appUrl: "https://app.example.com" },
      { workspace: wsSlug, slug: s.slug, reason: "Please remove\nthis <b>now</b>", email: "visitor@example.com" },
      hex64(),
    );
    expect(outcome.ok).toBe(true);
    const recipients = sent.map((m) => m.to).sort();
    expect(recipients).toEqual([owner.email.toLowerCase(), "ops@example.com"].sort());
    expect(sent[0].subject).toContain("Takedown Co");
    expect(sent[0].text).toContain("Headline here");
    expect(sent[0].text).toContain(`https://app.example.com/app/case-studies/${s.id}/edit`);
    expect(sent[0].text).toContain("Nothing was removed automatically");
  });

  it("reports not_found and limit without sending anything", async () => {
    const { sender, sent } = fakeSender();
    const ctx = { admin, sender, platformAdmins: [], appUrl: "https://app.example.com" };
    expect(await submitReport(ctx, { workspace: wsSlug, slug: "nope-nope", reason: "A long enough reason", email: "a@example.com" }, hex64())).toEqual({ ok: false, reason: "not_found" });
    const s = await published();
    const input = { workspace: wsSlug, slug: s.slug, reason: "A long enough reason", email: "dup@example.com" };
    expect((await submitReport(ctx, input, hex64())).ok).toBe(true);
    sent.length = 0;
    expect(await submitReport(ctx, input, hex64())).toEqual({ ok: false, reason: "limit" });
    expect(sent).toHaveLength(0);
  });
});
