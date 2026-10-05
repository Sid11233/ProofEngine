import "server-only";
import { createAnthropicClient } from "@/lib/ai/client";
import type { InterviewerDeps } from "@/lib/ai/interviewer";
import { getEmailSender } from "@/lib/email/resend";
import { canUseAI } from "@/lib/billing/entitlements";
import { limits } from "@/lib/limits.server";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { serverEnv } from "@/lib/security/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseStore, type UploadStore } from "@/lib/uploads/store";
import { isBreakerTripped } from "./breaker";

interface Wiring {
  deps: InterviewerDeps;
  store: UploadStore;
  startLimiter: RateLimiter;
  uploadLimiter: RateLimiter;
}
let wiring: Wiring | undefined;

function build(): Wiring {
  const admin = createAdminClient();
  return {
    deps: {
      admin,
      ai: serverEnv.ANTHROPIC_API_KEY
        ? createAnthropicClient({ apiKey: serverEnv.ANTHROPIC_API_KEY, model: serverEnv.INTERVIEWER_MODEL })
        : null,
      // 10 messages per minute per token (Prompt 3.4).
      messageLimiter: createRateLimiter({ prefix: "interview:message:token", limit: 10, windowSec: 60 }),
      // Monthly per-workspace AI cap, checked before every model call.
      async canUseAi(access) {
        const period = new Date().toISOString().slice(0, 7) + "-01";
        const [workspace, usage] = await Promise.all([
          admin.from("workspaces").select("plan").eq("id", access.workspaceId).single(),
          admin.from("usage_counters").select("ai_messages").eq("workspace_id", access.workspaceId).eq("period", period).maybeSingle(),
        ]);
        return canUseAI({ plan: String(workspace.data?.plan ?? "free"), usedThisMonth: Number(usage.data?.ai_messages ?? 0), limits }).allowed;
      },
    },
    store: createSupabaseStore(admin),
    // Bot heuristic: at most N interviews started per IP per hour (default 5).
    startLimiter: createRateLimiter({ prefix: "interview:start:ip", limit: limits.interviewStartsPerIpHour, windowSec: 3600 }),
    uploadLimiter: createRateLimiter({ prefix: "interview:upload:token", limit: 10, windowSec: 60 }),
  };
}

const get = () => (wiring ??= build());

export const getInterviewerDeps = () => get().deps;
export const getUploadStore = () => get().store;
export const getStartLimiter = () => get().startLimiter;
export const getUploadLimiter = () => get().uploadLimiter;

/** True while the global daily AI spend breaker is open. Alerts the owner once when it first trips. */
export function breakerTripped(): Promise<boolean> {
  return isBreakerTripped(get().deps.admin, limits.aiDailyTokenLimit, async () => {
    const to = serverEnv.ALERT_EMAIL;
    const sender = getEmailSender();
    if (to && sender) {
      await sender.send({
        to,
        subject: "AI spend limit reached: interviews paused for today",
        text: `Total AI tokens today passed the limit of ${limits.aiDailyTokenLimit}. Interviews are paused until tomorrow (UTC). Raise AI_DAILY_TOKEN_LIMIT if this is expected.`,
      });
    } else {
      console.error("AI daily spend limit reached; set ALERT_EMAIL and Resend to be emailed");
    }
  });
}
