"use client";

import { useState, useTransition } from "react";
import type { BillingActionResult } from "@/app/app/billing/actions";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";

const button = "inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-5 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900";
const secondary = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-5 font-medium disabled:opacity-50 dark:border-neutral-700";

/** Only ever navigates to Stripe's own pages, whatever the server says. */
const isStripe = (url: string) => /^https:\/\/(checkout|billing)\.stripe\.com\//.test(url);

export function BillingActions({ isOwner, canUpgrade, hasCustomer, upgrade, portal }: { isOwner: boolean; canUpgrade: boolean; hasCustomer: boolean; upgrade: () => Promise<BillingActionResult>; portal: () => Promise<BillingActionResult> }) {
  const [message, setMessage] = useState<string>();
  const [retry, setRetry] = useState<{ needed: NonNullable<BillingActionResult["reauth"]>; run: () => void } | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<BillingActionResult>) {
    setMessage(undefined);
    start(async () => {
      const result = await task();
      if (result.reauth) return setRetry({ needed: result.reauth, run: () => run(task) });
      setRetry(null);
      if (result.ok && result.url && isStripe(result.url)) {
        window.location.assign(result.url);
        return;
      }
      setMessage(result.message ?? "Something went wrong.");
    });
  }

  if (!isOwner) return <p className="text-sm text-neutral-600 dark:text-neutral-400">Only the workspace owner can change the plan or payment details.</p>;
  return (
    <div className="space-y-3">
      {retry && <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} />}
      <div className="flex flex-wrap gap-3">
        {canUpgrade && <button type="button" className={button} disabled={pending} onClick={() => run(upgrade)}>Upgrade to Pro</button>}
        {hasCustomer && <button type="button" className={secondary} disabled={pending} onClick={() => run(portal)}>Manage billing</button>}
      </div>
      <div role="status" aria-live="polite">{message ? <p className="text-sm text-red-700 dark:text-red-400">{message}</p> : null}</div>
    </div>
  );
}
