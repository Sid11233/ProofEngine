import "server-only";
import { createAnthropicClient } from "@/lib/ai/client";
import type { InterviewerDeps } from "@/lib/ai/interviewer";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { serverEnv } from "@/lib/security/env.server";
import { createAdminClient } from "@/lib/supabase/admin";

let deps: InterviewerDeps | undefined;

/** Production wiring for the interview endpoints. */
export function getInterviewerDeps(): InterviewerDeps {
  deps ??= {
    admin: createAdminClient(),
    ai: serverEnv.ANTHROPIC_API_KEY
      ? createAnthropicClient({ apiKey: serverEnv.ANTHROPIC_API_KEY, model: serverEnv.INTERVIEWER_MODEL })
      : null,
    // 10 messages per minute per token (Prompt 3.4).
    messageLimiter: createRateLimiter({ prefix: "interview:message:token", limit: 10, windowSec: 60 }),
  };
  return deps;
}
