import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { plainLine } from "@/lib/validation/text";
import type { RateLimiter } from "@/lib/security/rate-limit-memory";
import { constantTimeEqualHex, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { caseStudyContentSchema } from "./schema";
import type { PreviewData } from "./preview-access-core";

// The door for client approval links (/approve/<token>). Like resolveInterview() and the preview
// resolver it answers every kind of bad link the same way. The database functions re-check the
// token, its version and the stored content when the client acts, so this is the display check.

export type ApprovalData = PreviewData & { workspaceName: string };
export type ApprovalResult = { ok: true; data: ApprovalData } | { ok: false; reason: "not_found" | "rate_limited" };

export interface ApprovalDeps {
  admin: SupabaseClient;
  ipLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
  now?: () => number;
}

const NOT_FOUND = { ok: false, reason: "not_found" } as const;

export function createApprovalResolver({ admin, ipLimiter, tokenLimiter, now = Date.now }: ApprovalDeps) {
  return async function resolveApproval(rawToken: string, { ip }: { ip: string }): Promise<ApprovalResult> {
    if (!(await ipLimiter.limit(ip)).success) return { ok: false, reason: "rate_limited" };
    if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) return NOT_FOUND;

    const hash = hashToken(rawToken);
    if (!(await tokenLimiter.limit(hash)).success) return { ok: false, reason: "rate_limited" };

    const { data: link } = await admin
      .from("case_study_approval_tokens")
      .select("case_study_id, workspace_id, version, token_hash, expires_at, used_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!link || !constantTimeEqualHex(String(link.token_hash), hash)) return NOT_FOUND;
    if (link.used_at !== null || link.revoked_at !== null || Date.parse(String(link.expires_at)) <= now()) return NOT_FOUND;

    const { data: study } = await admin
      .from("case_studies")
      .select("content, status, current_version, client_declined_at, template_id, theme_settings")
      .eq("id", link.case_study_id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle();
    if (!study || study.status !== "awaiting_client_approval" || study.current_version !== link.version || study.client_declined_at !== null) return NOT_FOUND;

    const content = caseStudyContentSchema.safeParse(study.content);
    if (!content.success) return NOT_FOUND;

    const { data: workspace } = await admin.from("workspaces").select("name").eq("id", link.workspace_id).maybeSingle();
    return {
      ok: true,
      data: {
        content: content.data,
        templateId: typeof study.template_id === "string" ? study.template_id : null,
        themeSettings: study.theme_settings ?? {},
        logoPath: content.data.client.logoPath ?? null,
        workspaceName: typeof workspace?.name === "string" ? workspace.name : "",
      },
    };
  };
}

/** What the client can do. Strict: unknown fields are rejected. */
export const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve") }).strict(),
  z.object({ kind: z.literal("changes"), note: plainLine(1000, { min: 1 }, "Tell us what to change") }).strict(),
  z.object({ kind: z.literal("decline") }).strict(),
]);
export type Decision = z.infer<typeof decisionSchema>;

export type DecisionResult = { ok: true } | { ok: false; reason: "not_found" | "invalid" };

/** Records the client's decision. The database function consumes the token and enforces every rule. */
export async function recordDecision(admin: SupabaseClient, rawToken: string, decision: Decision, ipHash: string): Promise<DecisionResult> {
  if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) return { ok: false, reason: "not_found" };
  const token_hash = hashToken(rawToken);
  const call =
    decision.kind === "approve"
      ? admin.rpc("approve_case_study", { token_hash, ip_hash: ipHash })
      : decision.kind === "changes"
        ? admin.rpc("request_case_study_changes", { token_hash, note: decision.note, ip_hash: ipHash })
        : admin.rpc("decline_case_study", { token_hash, ip_hash: ipHash });
  const { error } = await call;
  if (!error) return { ok: true };
  return { ok: false, reason: error.code === "22023" ? "invalid" : "not_found" };
}
