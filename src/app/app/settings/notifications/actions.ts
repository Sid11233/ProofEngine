"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { endpointOnlySchema, preferencesSchema, subscriptionSchema } from "@/lib/push/schemas";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface NotificationActionResult {
  ok: boolean;
  message?: string;
}

async function guard() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { error: "You do not have permission to do that." } as const;
  if (!(await isAuthAttemptAllowed("notifications", { ip: getClientIp(await headers()), subject: user.id }))) return { error: RATE_LIMITED_MESSAGE } as const;
  return { user, workspace } as const;
}

/** Called only after the user pressed a button and the browser granted permission. */
export async function savePushSubscriptionAction(input: unknown): Promise<NotificationActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, message: g.error };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This browser's notification service is not supported." };
  const { error } = await (await createClient()).rpc("save_push_subscription", { ws: g.workspace.id, push_endpoint: parsed.data.endpoint, push_p256dh: parsed.data.p256dh, push_auth: parsed.data.auth });
  if (error) return { ok: false, message: error.code === "54000" ? "You have turned on notifications on 10 devices already. Turn one off first." : "We could not turn notifications on." };
  revalidatePath("/app/settings/notifications");
  return { ok: true };
}

/** Removes this device's subscription. The user's own client is used, so row-level security limits it to their own rows. */
export async function removePushSubscriptionAction(input: unknown): Promise<NotificationActionResult> {
  const user = await requireUser();
  const parsed = endpointOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nothing to remove." };
  await (await createClient()).from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", parsed.data.endpoint);
  revalidatePath("/app/settings/notifications");
  return { ok: true };
}

export async function savePreferencesAction(input: unknown): Promise<NotificationActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, message: g.error };
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Those settings are not valid." };
  const { error } = await (await createClient()).rpc("save_notification_preferences", {
    ws: g.workspace.id,
    on_client_completed: parsed.data.clientCompleted,
    on_approval_received: parsed.data.approvalReceived,
    on_referral_received: parsed.data.referralReceived,
  });
  if (error) return { ok: false, message: "We could not save that." };
  revalidatePath("/app/settings/notifications");
  return { ok: true, message: "Saved." };
}
