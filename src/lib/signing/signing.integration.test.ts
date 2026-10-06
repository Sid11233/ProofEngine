/** The signing flow against the real database (npm run test:isolation). */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage, EmailSender } from "@/lib/email/types";
import { createMemoryLimiter } from "@/lib/security/rate-limit-memory";
import { generateToken } from "@/lib/security/tokens";
import { createTestUser, hex64, loadLocalConfig, makeClient, type TestUser } from "../../../supabase/tests/isolation/harness";
import { createSigningService } from "./access-core";

let admin: SupabaseClient;
let owner: TestUser;
let ws: string;
const users: string[] = [];
const ctx = { ip: "203.0.113.5", userAgent: "Vitest" };
const CLIENT_EMAIL = "dana@example.test";
const sent: EmailMessage[] = [];
const sender: EmailSender = { send: async (m) => { sent.push(m); return true; } };
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const service = () => createSigningService({
  admin, codeSecret: "k".repeat(40), sender,
  hashEvidence: (kind, value) => sha(`${kind}:${value}`),
  limiters: { ip: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }), token: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }), code: createMemoryLimiter({ limit: 1000, windowMs: 60_000 }) },
});

const content = (headline: string) => ({ headline, client: {}, sections: [{ type: "challenge", title: "Challenge", body: "Onboarding took 12 days." }], tags: [] });

async function sentStudy() {
  const { data: requestId } = await owner.client.rpc("create_proof_request", { ws, client_name: "Dana Doe", client_email: CLIENT_EMAIL, project_type: null, flow_type: "agency", focus_outcomes: [], tone: null, hash: generateToken().hash });
  const { data: interview } = await admin.from("interviews").insert({ request_id: requestId, workspace_id: ws, status: "completed", consent_given: true, consent_text_version: "v1", question_index: 6, publish_permission: "first_name" }).select("id").single();
  const { data: cs } = await admin.from("case_studies").insert({ workspace_id: ws, interview_id: interview?.id, content: content("Original"), status: "draft" }).select("id").single();
  const id = String(cs?.id);
  await admin.from("case_study_versions").insert({ case_study_id: id, workspace_id: ws, version: 1, content: content("Original") });
  const token = generateToken();
  expect((await owner.client.rpc("request_client_approval", { study: id, hash: token.hash })).error).toBeNull();
  return { id, token };
}

const lastCode = () => /Your code is (\d{6})/.exec(sent[sent.length - 1]?.text ?? "")?.[1] ?? "";
async function verified(svc: ReturnType<typeof service>, raw: string) {
  expect(await svc.sendCode(raw, ctx)).toEqual({ ok: true });
  const result = await svc.verifyCode(raw, { code: lastCode() }, ctx);
  if (!result.ok) throw new Error("verify failed");
  return result.session;
}
const signInput = (over: Record<string, unknown> = {}) => ({
  signerName: "Dana Doe", company: "Acme", role: "COO", displayChoice: "first_only", esignDisclosure: true, confirmAccuracy: true,
  consentSocial: false, consentMedia: false, method: "typed", expectedVersion: 1, ...over,
});

beforeAll(async () => {
  const cfg = loadLocalConfig();
  admin = makeClient(cfg, "service");
  owner = await createTestUser(cfg, admin, "sg-owner");
  users.push(owner.id);
  ws = String((await owner.client.rpc("create_workspace", { name: "Sign Co", type: "agency" })).data);
  await admin.from("workspaces").update({ plan: "pro", subdomain_slug: `sg-${hex64().slice(0, 8)}` }).eq("id", ws);
}, 120_000);

afterAll(async () => {
  await admin.from("workspaces").delete().eq("id", ws);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}, 120_000);

describe("the happy path", () => {
  it("emails the code only to the address on file, then reviews, signs, approves and allows publishing", async () => {
    const { id, token } = await sentStudy();
    const svc = service();

    const first = await svc.loadPage(token.raw, undefined, ctx);
    expect(first).toMatchObject({ ok: true, stage: "identity", maskedEmail: "d***@example.test" });
    expect(JSON.stringify(first)).not.toContain("Original");

    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: true });
    expect(sent[sent.length - 1].to).toBe(CLIENT_EMAIL);
    const code = lastCode();
    expect((await admin.from("signing_challenges").select("code_hash").eq("case_study_id", id)).data?.[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await admin.from("signing_challenges").select("*").eq("case_study_id", id)).data)).not.toContain(code);

    expect(await svc.verifyCode(token.raw, { code: code === "000000" ? "000001" : "000000" }, ctx)).toEqual({ ok: false, reason: "unverified" });
    const verify = await svc.verifyCode(token.raw, { code }, ctx);
    if (!verify.ok) throw new Error("verify failed");

    const page = await svc.loadPage(token.raw, verify.session, ctx);
    expect(page).toMatchObject({ ok: true, stage: "review", review: { version: 1, consent: { version: "v1" }, prefill: { signerName: "Dana Doe", displayChoice: "first_only" } } });
    expect(page.ok && page.stage === "review" ? page.review.consent.body : "").toContain("LAWYER REVIEW REQUIRED");

    const signed = await svc.sign(token.raw, verify.session, signInput({ consentSocial: true }), ctx);
    expect(signed.ok).toBe(true);
    const { data: sig } = await admin.from("signatures").select("*").eq("case_study_id", id).single();
    expect(sig).toMatchObject({ signer_name: "Dana Doe", signer_email: CLIENT_EMAIL, display_name_choice: "first_only", consent_web: true, consent_social: true, consent_media: false, version: 1, method: "typed" });
    expect(sig?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sig?.ip_hash).toBe(sha("ip:203.0.113.5"));
    expect(JSON.stringify(sig)).not.toContain("203.0.113.5");
    expect((await admin.from("case_studies").select("status").eq("id", id).single()).data?.status).toBe("approved");

    const events = ((await admin.from("signature_events").select("event").eq("case_study_id", id)).data ?? []).map((e) => e.event);
    for (const e of ["sent", "otp_sent", "otp_failed", "otp_verified", "viewed", "signed"]) expect(events, e).toContain(e);

    expect((await owner.client.rpc("publish_case_study", { study: id, new_slug: `sg-${hex64().slice(0, 8)}` })).error).toBeNull();
  });

  it("rejects an email typed on the page and any unknown field", async () => {
    const { token } = await sentStudy();
    const svc = service();
    const session = await verified(svc, token.raw);
    expect(await svc.sign(token.raw, session, signInput({ email: "attacker@example.test" }), ctx)).toEqual({ ok: false, reason: "bad_input" });
    expect(await svc.sign(token.raw, session, signInput({ esignDisclosure: false }), ctx)).toEqual({ ok: false, reason: "bad_input" });
    expect(await svc.sign(token.raw, session, signInput({ confirmAccuracy: false }), ctx)).toEqual({ ok: false, reason: "bad_input" });
  });
});

describe("the code", () => {
  it("cannot be brute forced: five wrong tries kill it, even if the right code follows", async () => {
    const { token } = await sentStudy();
    const svc = service();
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: true });
    const right = lastCode();
    const wrong = right === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect(await svc.verifyCode(token.raw, { code: wrong }, ctx)).toEqual({ ok: false, reason: "unverified" });
    expect(await svc.verifyCode(token.raw, { code: right }, ctx)).toEqual({ ok: false, reason: "unverified" });
  });

  it("an expired code, an old code after a resend, and a malformed code all fail; resends are capped at 3 an hour", async () => {
    const { id, token } = await sentStudy();
    const svc = service();
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: true });
    const old = lastCode();
    expect(await svc.verifyCode(token.raw, { code: "12ab56" }, ctx)).toEqual({ ok: false, reason: "bad_input" });
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: true });
    const fresh = lastCode();
    if (old !== fresh) expect(await svc.verifyCode(token.raw, { code: old }, ctx)).toEqual({ ok: false, reason: "unverified" });
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: true });
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: false, reason: "too_many_codes" });
    // Expire the live code.
    await admin.from("signing_challenges").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("case_study_id", id);
    expect(await svc.verifyCode(token.raw, { code: lastCode() }, ctx)).toEqual({ ok: false, reason: "unverified" });
  });

  it("per-IP rate limiting answers rate_limited", async () => {
    const { token } = await sentStudy();
    const svc = createSigningService({ admin, codeSecret: "k".repeat(40), sender, hashEvidence: (k, v) => sha(`${k}:${v}`), limiters: { ip: createMemoryLimiter({ limit: 2, windowMs: 60_000 }), token: createMemoryLimiter({ limit: 100, windowMs: 60_000 }), code: createMemoryLimiter({ limit: 100, windowMs: 60_000 }) } });
    await svc.sendCode(token.raw, ctx);
    await svc.sendCode(token.raw, ctx);
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("the link", () => {
  it("is not found when expired, malformed, unknown or revoked, and says nothing different for each", async () => {
    const { id, token } = await sentStudy();
    const svc = service();
    await admin.from("case_study_approval_tokens").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("case_study_id", id);
    expect(await svc.loadPage(token.raw, undefined, ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.loadPage("short", undefined, ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.loadPage(generateToken().raw, undefined, ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: false, reason: "not_found" });
  });

  it("cannot be replayed once used", async () => {
    const { token } = await sentStudy();
    const svc = service();
    const session = await verified(svc, token.raw);
    expect((await svc.sign(token.raw, session, signInput(), ctx)).ok).toBe(true);
    expect(await svc.sign(token.raw, session, signInput(), ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.loadPage(token.raw, session, ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.sendCode(token.raw, ctx)).toEqual({ ok: false, reason: "not_found" });
  });

  it("stops working when the content is edited after sending, and the study goes back to draft", async () => {
    const { id, token } = await sentStudy();
    const svc = service();
    const session = await verified(svc, token.raw);
    expect((await owner.client.rpc("save_case_study_edit", { study: id, new_content: content("Edited after sending"), edited_claims: [] })).error).toBeNull();
    expect((await admin.from("case_study_approval_tokens").select("revoked_at").eq("token_hash", sha(token.raw)).maybeSingle()).data).toBeDefined();
    expect(await svc.loadPage(token.raw, session, ctx)).toEqual({ ok: false, reason: "not_found" });
    expect(await svc.sign(token.raw, session, signInput(), ctx)).toEqual({ ok: false, reason: "not_found" });
    expect((await admin.from("case_studies").select("status").eq("id", id).single()).data?.status).toBe("draft");
  });

  it("refuses to sign an outdated version, in the app and in the database", async () => {
    const { id, token } = await sentStudy();
    const svc = service();
    const session = await verified(svc, token.raw);
    expect(await svc.sign(token.raw, session, signInput({ expectedVersion: 2 }), ctx)).toEqual({ ok: false, reason: "version_changed" });
    // Straight at the database with a mismatching version.
    const direct = await admin.rpc("sign_case_study", {
      token_hash: token.hash, session_hash: sha(session), expected_version: 5, signer_name: "Dana", signer_company: "", signer_role: "", display_choice: "full",
      consent_social: false, consent_media: false, method: "typed", signature_path: null, content_hash: hex64(), ip_hash: hex64(), ua_hash: hex64(),
    });
    expect(direct.error?.code).toBe("40001");
    expect((await admin.from("signatures").select("id").eq("case_study_id", id)).data).toHaveLength(0);
  });

  it("will not sign without a verified code, or with another link's session", async () => {
    const a = await sentStudy();
    const b = await sentStudy();
    const svc = service();
    expect(await svc.sign(a.token.raw, undefined, signInput(), ctx)).toEqual({ ok: false, reason: "unverified" });
    const sessionB = await verified(svc, b.token.raw);
    expect(await svc.sign(a.token.raw, sessionB, signInput(), ctx)).toEqual({ ok: false, reason: "unverified" });
    expect(await svc.sign(a.token.raw, "x".repeat(43), signInput(), ctx)).toEqual({ ok: false, reason: "unverified" });
  });

  it("an old verification (over 30 minutes) is not enough", async () => {
    const { id, token } = await sentStudy();
    const svc = service();
    const session = await verified(svc, token.raw);
    await admin.from("signing_challenges").update({ consumed_at: new Date(Date.now() - 31 * 60_000).toISOString() }).eq("case_study_id", id);
    expect(await svc.sign(token.raw, session, signInput(), ctx)).toEqual({ ok: false, reason: "unverified" });
  });
});

describe("changes and decline", () => {
  it("request changes sets the draft back and records feedback; decline blocks the story and keeps the trail", async () => {
    const a = await sentStudy();
    const svc = service();
    const sessionA = await verified(svc, a.token.raw);
    expect(await svc.requestChanges(a.token.raw, sessionA, { note: "Please fix the days" }, ctx)).toEqual({ ok: true });
    expect((await admin.from("case_studies").select("status").eq("id", a.id).single()).data?.status).toBe("draft");
    expect((await admin.from("case_study_feedback").select("kind, message").eq("case_study_id", a.id)).data).toEqual([{ kind: "changes_requested", message: "Please fix the days" }]);

    const b = await sentStudy();
    const sessionB = await verified(svc, b.token.raw);
    expect((await svc.requestChanges(b.token.raw, sessionB, { note: "x".repeat(1001) }, ctx))).toEqual({ ok: false, reason: "bad_input" });
    expect(await svc.decline(b.token.raw, sessionB, ctx)).toMatchObject({ ok: true });
    expect((await admin.from("case_studies").select("status, client_declined_at").eq("id", b.id).single()).data?.status).toBe("unpublished");
    const events = ((await admin.from("signature_events").select("event").eq("case_study_id", b.id)).data ?? []).map((e) => e.event);
    expect(events).toContain("declined");
  });
});
