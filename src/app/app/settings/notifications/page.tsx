import "server-only";
import { redirect } from "next/navigation";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { serverEnv } from "@/lib/security/env.server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { removePushSubscriptionAction, savePreferencesAction, savePushSubscriptionAction } from "./actions";

export const metadata = { title: pageTitle("Notifications") };

// Preferences are read through the user's own client (row-level security: only their own row).
export default async function NotificationsPage() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const { data } = await (await createClient())
    .from("notification_preferences")
    .select("client_completed, approval_received, referral_received")
    .eq("user_id", user.id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">Optional push notifications for this workspace. Everything is off until you turn it on.</p>
      </div>
      <NotificationSettings
        vapidKey={serverEnv.VAPID_PUBLIC_KEY ?? null}
        initial={{ clientCompleted: data?.client_completed === true, approvalReceived: data?.approval_received === true, referralReceived: data?.referral_received === true }}
        actions={{ savePreferences: savePreferencesAction, saveSubscription: savePushSubscriptionAction, removeSubscription: removePushSubscriptionAction }}
      />
    </div>
  );
}
