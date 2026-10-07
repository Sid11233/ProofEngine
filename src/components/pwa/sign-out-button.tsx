"use client";

import { removePushSubscriptionAction } from "@/app/app/settings/notifications/actions";
import { Icon } from "@/components/ui/icons";
import { clearPwaState } from "@/lib/pwa/clear";

/** The sign out form's button (in the account menu): clears this device's caches and push subscription first, then submits. */
export function SignOutButton() {
  return (
    <button
      type="submit"
      role="menuitem"
      className="flex min-h-10 w-full items-center gap-3 rounded-control px-2 text-left text-sm text-foreground hover:bg-black/[0.05]"
      onClick={async (event) => {
        const form = event.currentTarget.form;
        if (!form || form.dataset.cleared === "1") return;
        event.preventDefault();
        try {
          // Forget this device's push subscription on the server while we are still signed in.
          const registration = await navigator.serviceWorker?.getRegistration("/app/");
          const subscription = await registration?.pushManager?.getSubscription();
          if (subscription) await removePushSubscriptionAction({ endpoint: subscription.endpoint });
        } catch {
          /* push was never on, or this browser has no push */
        }
        await clearPwaState();
        form.dataset.cleared = "1";
        form.requestSubmit();
      }}
    >
      <Icon name="logout" className="text-muted" />
      Sign out
    </button>
  );
}
