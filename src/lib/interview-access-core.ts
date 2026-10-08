import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimiter } from "@/lib/security/rate-limit-memory";
import { constantTimeEqualHex, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { consentFor, type InterviewPurpose } from "@/lib/interview/consent";

// The client-facing door. Everything an interview endpoint knows about who is
// calling comes from here, so it returns as little as possible and says "not found"
// for every kind of bad link.

export interface InterviewQuestion {
  id: string;
  text: string;
  /** Which part of the story the question is about (challenge, trigger, solution, results, quote, audience), when known. */
  key?: string;
}

/** Safe to hand to the browser. */
export interface InterviewPublicView {
  workspaceName: string;
  clientFirstName: string;
  questions: InterviewQuestion[];
  consentVersion: string;
  consentText: string;
  purpose: InterviewPurpose;
}

/** Server-side only: ids the endpoints need to scope their queries. Never serialise this to a client. */
export interface InterviewAccess {
  requestId: string;
  workspaceId: string;
  /** Null until the client accepts the consent screen and the interview starts. */
  interviewId: string | null;
  flowType: "agency" | "saas" | "custom";
  purpose: InterviewPurpose;
  tokenHash: string;
  view: InterviewPublicView;
}

export type ResolveResult =
  | { ok: true; access: InterviewAccess }
  // One reason for every invalid, expired, revoked or completed link, so tokens cannot be probed.
  | { ok: false; reason: "not_found" | "rate_limited" };

export interface ResolverDeps {
  admin: SupabaseClient;
  ipLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
  now?: () => number;
}

const OPEN_STATUSES = new Set(["draft", "sent", "started"]);
const NOT_FOUND: ResolveResult = { ok: false, reason: "not_found" };

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0]?.slice(0, 50) || "there";
}

function parseQuestions(raw: unknown, workspaceName: string): InterviewQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  const out: InterviewQuestion[] = [];
  for (const item of raw) {
    const q = item as { id?: unknown; text?: unknown; key?: unknown };
    if (typeof q?.id !== "string" || typeof q.text !== "string") return null;
    out.push({ id: q.id, text: q.text.replaceAll("{{workspace}}", workspaceName), ...(typeof q.key === "string" ? { key: q.key } : {}) });
  }
  return out.length > 0 ? out : null;
}

export function createResolver({ admin, ipLimiter, tokenLimiter, now = Date.now }: ResolverDeps) {
  return async function resolveInterview(rawToken: string, { ip }: { ip: string }): Promise<ResolveResult> {
    // Count every attempt against the caller's IP, valid or not.
    if (!(await ipLimiter.limit(ip)).success) return { ok: false, reason: "rate_limited" };
    if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) return NOT_FOUND;

    const hash = hashToken(rawToken);
    if (!(await tokenLimiter.limit(hash)).success) return { ok: false, reason: "rate_limited" };

    const { data: request } = await admin
      .from("proof_requests")
      .select("id, workspace_id, client_name, flow_type, token_hash, status, expires_at, revoked_at, purpose, questions_snapshot")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!request) return NOT_FOUND;

    // The database matched on the hash; compare again without leaking timing.
    if (!constantTimeEqualHex(String(request.token_hash), hash)) return NOT_FOUND;
    if (request.revoked_at !== null) return NOT_FOUND;
    if (Date.parse(String(request.expires_at)) <= now()) return NOT_FOUND;
    // Completed links are closed to the interview (the approval step has its own token).
    if (!OPEN_STATUSES.has(String(request.status))) return NOT_FOUND;

    const flowType = request.flow_type === "saas" ? "saas" : "agency";
    const purpose: InterviewPurpose = request.purpose === "onboarding" ? "onboarding" : "review";
    const [workspace, interview, flow] = await Promise.all([
      admin.from("workspaces").select("name").eq("id", request.workspace_id).single(),
      admin
        .from("interviews")
        .select("id")
        .eq("request_id", request.id)
        .eq("workspace_id", request.workspace_id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("question_flows")
        .select("questions")
        .is("workspace_id", null)
        .eq("type", flowType)
        .eq("purpose", purpose)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const workspaceName = workspace.data?.name;
    // An onboarding link carries the questions as they were when it was made; editing the list later does not change it.
    const questions = workspaceName ? parseQuestions(purpose === "onboarding" && request.questions_snapshot ? request.questions_snapshot : flow.data?.questions, workspaceName) : null;
    // Fail closed if the flow cannot be loaded; never serve a half-built interview.
    if (!workspaceName || !questions) return NOT_FOUND;

    return {
      ok: true,
      access: {
        requestId: String(request.id),
        workspaceId: String(request.workspace_id),
        interviewId: interview.data?.id ? String(interview.data.id) : null,
        flowType: request.flow_type as InterviewAccess["flowType"],
        purpose,
        tokenHash: hash,
        view: {
          workspaceName,
          clientFirstName: firstName(String(request.client_name)),
          questions,
          consentVersion: consentFor(purpose).version,
          consentText: consentFor(purpose).text,
          purpose,
        },
      },
    };
  };
}
