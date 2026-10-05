import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimiter } from "@/lib/security/rate-limit-memory";
import { constantTimeEqualHex, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import { caseStudyContentSchema, type CaseStudyContent } from "./schema";

// The door for client preview links. Like resolveInterview(), it returns the minimum needed
// to draw one page, and the same "not found" for every kind of bad link.

export interface PreviewData {
  content: CaseStudyContent;
  templateId: string | null;
  themeSettings: unknown;
  logoPath: string | null;
}

export type PreviewResult = { ok: true; data: PreviewData } | { ok: false; reason: "not_found" | "rate_limited" };

export interface PreviewDeps {
  admin: SupabaseClient;
  ipLimiter: RateLimiter;
  tokenLimiter: RateLimiter;
  now?: () => number;
}

const NOT_FOUND: PreviewResult = { ok: false, reason: "not_found" };

export function createPreviewResolver({ admin, ipLimiter, tokenLimiter, now = Date.now }: PreviewDeps) {
  return async function resolvePreview(rawToken: string, { ip }: { ip: string }): Promise<PreviewResult> {
    if (!(await ipLimiter.limit(ip)).success) return { ok: false, reason: "rate_limited" };
    if (typeof rawToken !== "string" || !isWellFormedToken(rawToken)) return NOT_FOUND;

    const hash = hashToken(rawToken);
    if (!(await tokenLimiter.limit(hash)).success) return { ok: false, reason: "rate_limited" };

    const { data: link } = await admin
      .from("case_study_previews")
      .select("case_study_id, workspace_id, token_hash, expires_at, revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (!link || !constantTimeEqualHex(String(link.token_hash), hash)) return NOT_FOUND;
    if (link.revoked_at !== null || Date.parse(String(link.expires_at)) <= now()) return NOT_FOUND;

    // Scoped to this one case study and its workspace; nothing else is read.
    const { data: study } = await admin
      .from("case_studies")
      .select("content, status, template_id, theme_settings")
      .eq("id", link.case_study_id)
      .eq("workspace_id", link.workspace_id)
      .maybeSingle();
    if (!study || study.status === "published") return NOT_FOUND;

    // Content that does not pass the schema is never rendered.
    const content = caseStudyContentSchema.safeParse(study.content);
    if (!content.success) return NOT_FOUND;

    return {
      ok: true,
      data: {
        content: content.data,
        templateId: typeof study.template_id === "string" ? study.template_id : null,
        themeSettings: study.theme_settings ?? {},
        logoPath: content.data.client.logoPath ?? null,
      },
    };
  };
}
