import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnthropicClient } from "@/lib/ai/client";
import { isAuthAttemptAllowed } from "@/lib/auth/rate-limits";
import { getUser } from "@/lib/auth/session";
import { generateCaseStudy, type GenerateError } from "@/lib/case-study/generator";
import { aiMessageLimitFor } from "@/lib/limits";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { isSameOrigin } from "@/lib/security/origin";
import { limits } from "@/lib/limits.server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export const maxDuration = 60;

const bodySchema = z.object({ interviewId: z.uuid() }).strict();
const DEFAULT_GENERATOR_MODEL = "claude-sonnet-5-5";
/** Extraction, one draft and one retry. */
const CALLS_PER_GENERATION = 3;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

const STATUS: Record<GenerateError, number> = {
  not_found: 404, not_complete: 409, exists: 409, no_claims: 422, ai_failed: 502, forbidden: 403, failed: 500,
};
const MESSAGES: Record<GenerateError, string> = {
  not_found: "That interview was not found.",
  not_complete: "The interview must be completed, with the client's consent, first.",
  exists: "A case study already exists for this interview.",
  no_claims: "We could not find anything the client said that we can verify. Check the transcript.",
  ai_failed: "The AI service did not respond. Please try again.",
  forbidden: "You do not have permission to do that.",
  failed: "Something went wrong. Please try again.",
};

export async function POST(request: Request) {
  if (!isSameOrigin(request, publicEnv.NEXT_PUBLIC_APP_URL)) return json({ error: "forbidden" }, 403);

  const user = await getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);

  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return json({ error: "forbidden", message: MESSAGES.forbidden }, 403);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);

  if (!(await isAuthAttemptAllowed("generate", { ip: getClientIp(request.headers), subject: user.id }))) {
    return json({ error: "rate_limited", message: "Too many generations. Please wait a while." }, 429);
  }
  if (!serverEnv.ANTHROPIC_API_KEY) {
    return json({ error: "ai_not_configured", message: "AI is not configured on this server yet." }, 503);
  }

  const supabase = await createClient();

  // Monthly AI cap for the workspace: a clear error here, because the owner chose to spend it.
  const period = new Date().toISOString().slice(0, 7) + "-01";
  const { data: usage } = await supabase.from("usage_counters").select("ai_messages").eq("workspace_id", workspace.id).eq("period", period).maybeSingle();
  if (Number(usage?.ai_messages ?? 0) + CALLS_PER_GENERATION > aiMessageLimitFor(workspace.plan, limits)) {
    return json({ error: "ai_limit", message: "Your workspace has used its AI allowance for this month." }, 429);
  }

  const ai = createAnthropicClient({
    apiKey: serverEnv.ANTHROPIC_API_KEY,
    model: serverEnv.GENERATOR_MODEL ?? DEFAULT_GENERATOR_MODEL,
    timeoutMs: 50_000,
  });
  const result = await generateCaseStudy({ supabase, ai }, { workspaceId: workspace.id, interviewId: parsed.data.interviewId });
  if (!result.ok) return json({ error: result.error, message: MESSAGES[result.error] }, STATUS[result.error]);
  return json({ caseStudyId: result.caseStudyId, issues: result.issues.length });
}
