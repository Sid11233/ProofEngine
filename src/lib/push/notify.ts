import type { SupabaseClient } from "@supabase/supabase-js";
import { isAllowedPushEndpoint } from "./endpoint";

// Notifications are deliberately generic. The text below is the whole message: no client name, no company,
// no quote, no transcript, no number. The link goes to a page that still requires sign in.

export type PushEvent = "client_completed" | "approval_received" | "referral_received";

export const PUSH_MESSAGES: Record<PushEvent, { body: string; url: string }> = {
  client_completed: { body: "A client finished their interview", url: "/app/requests" },
  approval_received: { body: "A client approved a case study", url: "/app/case-studies" },
  referral_received: { body: "A client suggested someone", url: "/app/referrals" },
};

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one prepared payload. Returns the push service's HTTP status (0 = network failure). */
export interface PushSender {
  send(target: PushTarget, payload: string): Promise<{ statusCode: number }>;
}

export function pushPayload(event: PushEvent, title: string): string {
  const { body, url } = PUSH_MESSAGES[event];
  return JSON.stringify({ title, body, url });
}

export interface PushSummary {
  sent: number;
  removed: number;
  failed: number;
}

/** Tells the members of a workspace who switched this event on. Never throws; subscriptions that are gone are deleted. */
export async function notifyWorkspace(
  ctx: { admin: SupabaseClient; sender: PushSender | null; title: string },
  workspaceId: string,
  event: PushEvent,
): Promise<PushSummary> {
  const summary: PushSummary = { sent: 0, removed: 0, failed: 0 };
  if (!ctx.sender) return summary;
  try {
    const { data } = await ctx.admin.rpc("push_targets", { ws: workspaceId, event });
    const payload = pushPayload(event, ctx.title);
    for (const target of (data ?? []) as PushTarget[]) {
      if (!isAllowedPushEndpoint(target.endpoint)) {
        // Should be impossible (checked on save); drop it rather than ever contact an unknown host.
        await ctx.admin.rpc("remove_push_subscription", { sub: target.id });
        summary.removed += 1;
        continue;
      }
      const { statusCode } = await ctx.sender.send(target, payload);
      if (statusCode >= 200 && statusCode < 300) summary.sent += 1;
      else if (statusCode === 404 || statusCode === 410) {
        await ctx.admin.rpc("remove_push_subscription", { sub: target.id });
        summary.removed += 1;
      } else summary.failed += 1;
    }
  } catch {
    summary.failed += 1;
  }
  return summary;
}
