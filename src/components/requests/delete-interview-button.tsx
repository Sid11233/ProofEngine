"use client";

import { useState, useTransition } from "react";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";

type Result = { ok: boolean; message?: string; reauth?: "password" | "mfa" | "oauth" };

/** Two-step, because it cannot be undone: the transcript, uploads, claims and referrals are removed for good. */
export function DeleteInterviewButton({ interviewId, remove }: { interviewId: string | null; remove: (input: unknown) => Promise<Result> }) {
  const [armed, setArmed] = useState(false);
  const [message, setMessage] = useState<Result>();
  const [retry, setRetry] = useState<{ needed: NonNullable<Result["reauth"]>; run: () => void } | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      if (!interviewId) return;
      const result = await remove({ interviewId });
      if (result.reauth) return setRetry({ needed: result.reauth, run });
      setRetry(null);
      setMessage(result);
      if (result.ok) setArmed(false);
    });
  }

  return (
    <div className="space-y-2">
      {retry && <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} />}
      {!interviewId ? null : !armed ? (
        <button type="button" className="inline-flex min-h-11 items-center rounded-md border border-red-700/40 px-4 text-sm font-medium text-red-900 dark:text-red-200" onClick={() => setArmed(true)}>Delete this interview</button>
      ) : (
        <div role="alertdialog" aria-label="Delete this interview" className="space-y-2 rounded-md border border-red-700/30 bg-red-50 p-3 text-sm text-red-950">
          <p>This permanently deletes the transcript, uploaded files, claims and referrals of this interview, and takes any case study built on it offline. It cannot be undone.</p>
          <div className="flex gap-2">
            <button type="button" disabled={pending} className="inline-flex min-h-11 items-center rounded-md bg-red-800 px-4 font-medium text-white disabled:opacity-50" onClick={run}>Yes, delete it</button>
            <button type="button" disabled={pending} className="inline-flex min-h-11 items-center rounded-md border border-neutral-400 px-4" onClick={() => setArmed(false)}>Keep it</button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">{message ? <p className={message.ok ? "text-sm text-green-800" : "text-sm text-red-700"}>{message.message}</p> : null}</div>
    </div>
  );
}
