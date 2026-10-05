"use client";

import { useState, useTransition } from "react";
import type { TakedownActionResult } from "@/app/app/admin/takedowns/actions";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";

export interface TakedownView {
  id: string;
  studyId: string;
  workspaceName: string;
  headline: string;
  publicUrl: string | null;
  reason: string;
  contact: string;
  status: string;
  created: string;
  disabled: boolean;
}

interface Props {
  items: TakedownView[];
  actions: {
    setDisabled: (studyId: string, disable: boolean) => Promise<TakedownActionResult>;
    resolve: (requestId: string, status: string) => Promise<TakedownActionResult>;
  };
}

const button = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-3 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900";

export function TakedownList({ items, actions }: Props) {
  const [status, setStatus] = useState<TakedownActionResult>();
  const [retry, setRetry] = useState<{ needed: NonNullable<TakedownActionResult["reauth"]>; run: () => void } | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<TakedownActionResult>) {
    setStatus(undefined);
    start(async () => {
      const result = await task();
      if (result.reauth) return setRetry({ needed: result.reauth, run: () => run(task) });
      setRetry(null);
      setStatus(result);
    });
  }

  return (
    <div className="space-y-4">
      <div role="status" aria-live="polite">{status?.message ? <p className={status.ok ? "text-sm text-green-800 dark:text-green-300" : "text-sm text-red-700 dark:text-red-400"}>{status.message}</p> : null}</div>
      {retry && <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} />}
      {items.length === 0 ? <p className="text-neutral-600 dark:text-neutral-400">No reports.</p> : null}
      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="space-y-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{item.headline} <span className="font-normal text-neutral-600 dark:text-neutral-400">({item.workspaceName})</span></p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Status: {item.status} · reported {item.created} · {item.contact}{item.disabled ? " · page disabled" : ""}</p>
            {/* Plain text: pre-wrap keeps line breaks, nothing is interpreted as markup. */}
            <p className="whitespace-pre-wrap rounded bg-neutral-100 p-3 text-sm dark:bg-neutral-900" data-testid="report-reason">{item.reason}</p>
            {item.publicUrl ? <p className="text-sm"><a href={item.publicUrl} rel="noopener noreferrer" target="_blank" className="underline underline-offset-2">Open the public page</a></p> : null}
            <div className="flex flex-wrap gap-2">
              {item.disabled ? (
                <button type="button" className={button} disabled={pending} onClick={() => run(() => actions.setDisabled(item.studyId, false))}>Restore page</button>
              ) : (
                <button type="button" className={button} disabled={pending} onClick={() => run(() => actions.setDisabled(item.studyId, true))}>Disable page now</button>
              )}
              <button type="button" className={button} disabled={pending} onClick={() => run(() => actions.resolve(item.id, "reviewing"))}>Mark reviewing</button>
              <button type="button" className={button} disabled={pending} onClick={() => run(() => actions.resolve(item.id, "dismissed"))}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
