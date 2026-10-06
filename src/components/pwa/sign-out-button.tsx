"use client";

import { removePushSubscriptionAction } from "@/app/app/settings/notifications/actions";
import { clearPwaState } from "@/lib/pwa/clear";

/** The sign out form's button: clears this device's caches and push subscription first, then submits. */
export function SignOutButton() {
  return (
    <button
      type="submit"
      className="min-h-11 rounded-md px-3 underline underline-offset-2"
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
      Sign out
    </button>
  );
}
