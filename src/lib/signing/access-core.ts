import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import type { ClaimRef } from "@/lib/case-study/claim-check";
import { caseStudyContentSchema, type CaseStudyContent } from "@/lib/case-study/schema";
import type { RateLimiter } from "@/lib/security/rate-limit-memory";
import { constantTimeEqualHex, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { changedFields, type ChangedField } from "./changes";
import { generateCode, hashCode } from "./code";
import { contentHash } from "./canonical";
import { changesSchema, codeSchema, signSchema } from "./schemas";
import { cleanSignatureImage } from "./signature-image";

// The door for signing links (/sign/<token>). Every bad link, wrong version, expired code or used link is answered
// the same way where it could help a guesser; the database functions re-check everything when the client acts.
// Never logged: the token, the code, the email address, the signature.

export interface SigningDeps {
  admin: SupabaseClient;
  /** Keyed hashing of codes. */
  codeSecret: string;
  /** Keyed hashing of IPs and user agents for the evidence trail. */
  hashEvidence: (kind: "ip" | "ua", value: string) => string;
  sender: EmailSender | null;
  workspaceNameFor?: (id: string) => string;
  limiters: { ip: RateLimiter; token: RateLimiter; code: RateLimiter };
  /** The workspace's own "remove my story" link. */
  removalUrl?: (caseStudyId: string) => string;
}

export interface Ctx {
  ip: string;
  userAgent: string;
}

export type Failure = { ok: false; reason: "not_found" | "rate_limited" | "bad_input" | "unverified" | "version_changed" | "too_many_codes" | "failed" };

const NOT_FOUND: Failure = { ok: false, reason: "not_found" };
const RATE: Failure = { ok: false, reason: "rate_limited" };

export interface ReviewData {
  caseStudyId: string;
  version: number;
  workspaceName: string;
  content: CaseStudyContent;
  templateId: string | null;
  themeSettings: unknown;
  claims: Array<{ id: string; text: string; sourceQuote: string; edited: boolean }>;
  changes: ChangedField[];
  consent: { version: string; body: string };
  prefill: { signerName: string; company: string; role: string; displayChoice: "full" | "first_only" | "anonymous" };
  logoPath: string | null;
}

export type PageState =
  | { ok: true; stage: "identity"; workspaceName: string; maskedEmail: string }
  | { ok: true; stage: "review"; review: ReviewData }
  | Failure;

const mask = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
};
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const newSession = () => { const raw = randomBytes(32).toString("base64url"); return { raw, hash: sha(raw) }; };
const isCode = (error: { code?: string } | null, code: string) => error?.code === code;

async function limited(deps: SigningDeps, tokenHash: string, ctx: Ctx, bucket: "token" | "code" = "token"): Promise<boolean> {
  const ipOk = (await deps.limiters.ip.limit(sha(ctx.ip))).success;
  const tokenOk = (await deps.limiters[bucket].limit(tokenHash)).success;
  return ipOk && tokenOk;
}

/** The approver on file for the interview. Never taken from the page. */
async function approverOf(admin: SupabaseClient, caseStudyId: string) {
  const { data: study } = await admin.from("case_studies").select("interview_id, workspace_id").eq("id", caseStudyId).maybeSingle();
  if (!study?.interview_id) return null;
  const { data: interview } = await admin.from("interviews").select("request_id, publish_permission").eq("id", study.interview_id).maybeSingle();
  if (!interview?.request_id) return null;
  const { data: request } = await admin.from("proof_requests").select("client_name, client_email").eq("id", interview.request_id).maybeSingle();
  if (!request) return null;
  return { name: String(request.client_name), email: String(request.client_email), permission: String(interview.publish_permission ?? "") };
}

export function createSigningService(deps: SigningDeps) {
  const { admin } = deps;

  async function linkOf(rawToken: string) {
    if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) return null;
    const hash = hashToken(rawToken);
    const { data } = await admin.from("case_study_approval_tokens").select("id, case_study_id, workspace_id, version, token_hash, expires_at, used_at, revoked_at").eq("token_hash", hash).maybeSingle();
    if (!data || !constantTimeEqualHex(String(data.token_hash), hash)) return null;
    if (data.used_at !== null || data.revoked_at !== null || Date.parse(String(data.expires_at)) <= Date.now()) return null;
    return { hash, caseStudyId: String(data.case_study_id), workspaceId: String(data.workspace_id), version: Number(data.version) };
  }

  async function sessionValid(tokenHash: string, session: string | undefined): Promise<boolean> {
    if (!session || !/^[A-Za-z0-9_-]{43}$/.test(session)) return false;
    const { data, error } = await admin.rpc("check_signing_session", { token_hash: tokenHash, session_hash: sha(session) });
    return !error && data === true;
  }

  /** What /sign/<token> shows: the identity step, or (with a verified session) the review. */
  async function loadPage(rawToken: string, session: string | undefined, ctx: Ctx): Promise<PageState> {
    const link = await linkOf(rawToken);
    if (!link) return (await deps.limiters.ip.limit(sha(ctx.ip))).success ? NOT_FOUND : RATE;
    if (!(await limited(deps, link.hash, ctx))) return RATE;

    const approver = await approverOf(admin, link.caseStudyId);
    const { data: workspace } = await admin.from("workspaces").select("name").eq("id", link.workspaceId).maybeSingle();
    const workspaceName = typeof workspace?.name === "string" ? workspace.name : "";
    if (!approver) return NOT_FOUND;

    if (!(await sessionValid(link.hash, session))) return { ok: true, stage: "identity", workspaceName, maskedEmail: mask(approver.email) };

    const { data: version } = await admin.from("case_study_versions").select("content").eq("case_study_id", link.caseStudyId).eq("version", link.version).maybeSingle();
    const content = caseStudyContentSchema.safeParse(version?.content);
    if (!content.success) return NOT_FOUND;
    const { data: study } = await admin.from("case_studies").select("template_id, theme_settings, refined_fields").eq("id", link.caseStudyId).maybeSingle();
    const { data: claimRows } = await admin.from("claims").select("id, text, source_quote, source_message_id, edited").eq("case_study_id", link.caseStudyId);
    const messageIds = [...new Set((claimRows ?? []).map((c) => String(c.source_message_id)))];
    const { data: messages } = messageIds.length ? await admin.from("interview_messages").select("id, content").in("id", messageIds) : { data: [] as Array<{ id: string; content: string }> };
    const messageOf = new Map((messages ?? []).map((m) => [String(m.id), String(m.content)] as const));
    const refs = new Map<string, ClaimRef>((claimRows ?? []).map((c) => [String(c.id), { id: String(c.id), sourceQuote: String(c.source_quote), messageContent: messageOf.get(String(c.source_message_id)) ?? String(c.source_quote) }]));

    const refined = Array.isArray(study?.refined_fields) ? study.refined_fields.map(String) : [];
    const { data: log } = refined.length
      ? await admin.from("text_refinements").select("field_path, original_text, preset, created_at").eq("case_study_id", link.caseStudyId).in("field_path", refined).order("created_at", { ascending: true })
      : { data: [] as Array<{ field_path: string; original_text: string; preset: string | null }> };
    const originals = new Map<string, string>();
    for (const row of log ?? []) if (row.preset !== "restore" && !originals.has(String(row.field_path))) originals.set(String(row.field_path), String(row.original_text));

    const { data: consent } = await admin.from("consent_texts").select("version, body").eq("kind", "testimonial_release").lte("effective_at", new Date().toISOString()).order("effective_at", { ascending: false }).limit(1).maybeSingle();
    if (!consent) return { ok: false, reason: "failed" };

    await admin.rpc("log_signing_viewed", { token_hash: link.hash, ip_hash: deps.hashEvidence("ip", ctx.ip), ua_hash: deps.hashEvidence("ua", ctx.userAgent) });
    const displayChoice = approver.permission === "full" ? "full" : approver.permission === "first_name" ? "first_only" : "anonymous";
    return {
      ok: true,
      stage: "review",
      review: {
        caseStudyId: link.caseStudyId,
        version: link.version,
        workspaceName,
        content: content.data,
        templateId: typeof study?.template_id === "string" ? study.template_id : null,
        themeSettings: study?.theme_settings ?? {},
        claims: (claimRows ?? []).map((c) => ({ id: String(c.id), text: String(c.text), sourceQuote: String(c.source_quote), edited: c.edited === true })),
        changes: changedFields(content.data, refined, originals, refs),
        consent: { version: String(consent.version), body: String(consent.body) },
        prefill: { signerName: approver.name, company: "", role: "", displayChoice },
        logoPath: content.data.client.logoPath ?? null,
      },
    };
  }

  /** Emails a fresh code to the address on file. Answers the same whether or not anything was sent, except for the hourly cap. */
  async function sendCode(rawToken: string, ctx: Ctx): Promise<{ ok: true } | Failure> {
    const link = await linkOf(rawToken);
    if (!link) return NOT_FOUND;
    if (!(await limited(deps, link.hash, ctx, "code"))) return RATE;

    const code = generateCode();
    const { data, error } = await admin.rpc("issue_signing_code", {
      token_hash: link.hash, code_hash: hashCode(deps.codeSecret, link.hash, code), ip_hash: deps.hashEvidence("ip", ctx.ip), ua_hash: deps.hashEvidence("ua", ctx.userAgent),
    });
    if (isCode(error, "54000")) return { ok: false, reason: "too_many_codes" };
    if (error) return NOT_FOUND;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.client_email || !deps.sender) return { ok: false, reason: "failed" };
    const sent = await deps.sender.send({
      to: String(row.client_email),
      subject: "Your code to review and sign",
      text: [`Your code is ${code}.`, "", "It works for 10 minutes. If you did not ask for it, you can ignore this email: nothing happens without the code."].join("\n"),
    });
    return sent ? { ok: true } : { ok: false, reason: "failed" };
  }

  /** Checks the code (5 tries per code). On success returns the session secret for this browser. */
  async function verifyCode(rawToken: string, input: unknown, ctx: Ctx): Promise<{ ok: true; session: string } | Failure> {
    const parsed = codeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "bad_input" };
    const link = await linkOf(rawToken);
    if (!link) return NOT_FOUND;
    if (!(await limited(deps, link.hash, ctx, "code"))) return RATE;

    const session = newSession();
    const { data, error } = await admin.rpc("verify_signing_code", {
      token_hash: link.hash, code_hash: hashCode(deps.codeSecret, link.hash, parsed.data.code), session_hash: session.hash,
      ip_hash: deps.hashEvidence("ip", ctx.ip), ua_hash: deps.hashEvidence("ua", ctx.userAgent),
    });
    if (error) return NOT_FOUND;
    return data === true ? { ok: true, session: session.raw } : { ok: false, reason: "unverified" };
  }

  type Link = NonNullable<Awaited<ReturnType<typeof linkOf>>>;
  async function authorised(rawToken: string, session: string | undefined, ctx: Ctx): Promise<{ link: Link; fail?: undefined } | { link?: undefined; fail: Failure }> {
    const link = await linkOf(rawToken);
    if (!link) return { fail: NOT_FOUND };
    if (!(await limited(deps, link.hash, ctx))) return { fail: RATE };
    if (!(await sessionValid(link.hash, session))) return { fail: { ok: false, reason: "unverified" } };
    return { link };
  }

  /** Signs and approves. The database enforces the version, the verified code and the single use of the link. */
  async function sign(rawToken: string, session: string | undefined, input: unknown, ctx: Ctx): Promise<{ ok: true; signatureId: string } | Failure> {
    const parsed = signSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "bad_input" };
    const auth = await authorised(rawToken, session, ctx);
    if (!auth.link) return auth.fail;
    const { link } = auth;
    const body = parsed.data;
    if (body.expectedVersion !== link.version) return { ok: false, reason: "version_changed" };

    // The signature picture: a small PNG, re-encoded, kept in the private bucket.
    let signaturePath: string | null = null;
    if (body.method === "drawn") {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.signatureImage ?? "");
      if (!match) return { ok: false, reason: "bad_input" };
      const cleaned = await cleanSignatureImage(Buffer.from(match[1], "base64"));
      if (!cleaned.ok) return { ok: false, reason: "bad_input" };
      signaturePath = `${link.workspaceId}/${link.caseStudyId}/${crypto.randomUUID()}.png`;
      const upload = await admin.storage.from("signatures").upload(signaturePath, cleaned.png, { contentType: "image/png", upsert: false });
      if (upload.error) return { ok: false, reason: "failed" };
    }

    const { data: version } = await admin.from("case_study_versions").select("content").eq("case_study_id", link.caseStudyId).eq("version", link.version).maybeSingle();
    const { data: consent } = await admin.from("consent_texts").select("version").eq("kind", "testimonial_release").lte("effective_at", new Date().toISOString()).order("effective_at", { ascending: false }).limit(1).maybeSingle();
    if (!version || !consent) return { ok: false, reason: "failed" };

    const hash = contentHash({ content: version.content, consentTextVersion: String(consent.version), consent: { web: true, social: body.consentSocial, media: body.consentMedia }, signerName: body.signerName });
    const { data, error } = await admin.rpc("sign_case_study", {
      token_hash: link.hash, session_hash: sha(session as string), expected_version: body.expectedVersion,
      signer_name: body.signerName, signer_company: body.company ?? "", signer_role: body.role ?? "", display_choice: body.displayChoice,
      consent_social: body.consentSocial, consent_media: body.consentMedia, method: body.method, signature_path: signaturePath,
      content_hash: hash, ip_hash: deps.hashEvidence("ip", ctx.ip), ua_hash: deps.hashEvidence("ua", ctx.userAgent),
    });
    if (error || typeof data !== "string") {
      if (signaturePath) await admin.storage.from("signatures").remove([signaturePath]);
      return isCode(error, "40001") ? { ok: false, reason: "version_changed" } : isCode(error, "P0002") ? NOT_FOUND : { ok: false, reason: "failed" };
    }
    return { ok: true, signatureId: data };
  }

  async function requestChanges(rawToken: string, session: string | undefined, input: unknown, ctx: Ctx): Promise<{ ok: true } | Failure> {
    const parsed = changesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "bad_input" };
    const auth = await authorised(rawToken, session, ctx);
    if (!auth.link) return auth.fail;
    const { error } = await admin.rpc("request_case_study_changes", { token_hash: auth.link.hash, note: parsed.data.note, ip_hash: deps.hashEvidence("ip", ctx.ip) });
    return error ? NOT_FOUND : { ok: true };
  }

  async function decline(rawToken: string, session: string | undefined, ctx: Ctx): Promise<{ ok: true; removalUrl: string | null } | Failure> {
    const auth = await authorised(rawToken, session, ctx);
    if (!auth.link) return auth.fail;
    const { error } = await admin.rpc("decline_case_study", { token_hash: auth.link.hash, ip_hash: deps.hashEvidence("ip", ctx.ip) });
    return error ? NOT_FOUND : { ok: true, removalUrl: deps.removalUrl?.(auth.link.caseStudyId) ?? null };
  }

  return { loadPage, sendCode, verifyCode, sign, requestChanges, decline };
}
