import "server-only";
import webpush from "web-push";
import { brand } from "@/lib/brand";
import { serverEnv } from "@/lib/security/env.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyWorkspace, type PushEvent, type PushSender } from "./notify";

/** The real sender, or null until the VAPID keys are configured (push is then simply off). */
export function getPushSender(): PushSender | null {
  const publicKey = serverEnv.VAPID_PUBLIC_KEY;
  const privateKey = serverEnv.VAPID_PRIVATE_KEY;
  const subject = serverEnv.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return {
    async send(target, payload) {
      try {
        const result = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          { vapidDetails: { subject, publicKey, privateKey }, TTL: 3600, timeout: 8000 },
        );
        return { statusCode: result.statusCode };
      } catch (error) {
        return { statusCode: typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 0 };
      }
    },
  };
}

/** Fire and forget after an event. Safe to call anywhere on the server; failures are swallowed. */
export async function pushToWorkspace(workspaceId: string, event: PushEvent): Promise<void> {
  const sender = getPushSender();
  if (!sender) return;
  await notifyWorkspace({ admin: createAdminClient(), sender, title: brand.name }, workspaceId, event);
}
