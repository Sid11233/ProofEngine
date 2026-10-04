"use client";

import { useState, useTransition } from "react";
import type { RequestActionResult } from "@/app/app/requests/actions";
import { LinkOnce } from "./link-once";

interface Props {
  requestId: string;
  status: string;
  canManage: boolean;
  actions: {
    send: (id: string) => Promise<RequestActionResult>;
    remind: (id: string) => Promise<RequestActionResult>;
    regenerate: (id: string) => Promise<RequestActionResult>;
    revoke: (id: string) => Promise<RequestActionResult>;
  };
}

const button =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900";

export function RequestActions({ requestId, status, canManage, actions }: Props) {
  const [result, setResult] = useState<RequestActionResult>();
  const [pending, startTransition] = useTransition();

  if (!canManage) return <p className="text-sm text-neutral-600 dark:text-neutral-400">Only editors and above can manage requests.</p>;
  if (status === "completed") return <p className="text-sm">This interview is complete.</p>;

  const run = (task: (id: string) => Promise<RequestActionResult>) => {
    setResult(undefined);
    startTransition(async () => setResult(await task(requestId)));
  };

  const canSend = status === "draft" || status === "sent";
  const canRemind = status === "sent";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canSend && <button type="button" className={button} disabled={pending} onClick={() => run(actions.send)}>{status === "draft" ? "Send invitation" : "Resend invitation"}</button>}
        {canRemind && <button type="button" className={button} disabled={pending} onClick={() => run(actions.remind)}>Send reminder</button>}
        <button type="button" className={button} disabled={pending} onClick={() => run(actions.regenerate)}>New link</button>
        {status !== "revoked" && (
          <button type="button" className={button} disabled={pending} onClick={() => run(actions.revoke)}>Revoke link</button>
        )}
      </div>
      <div aria-live="polite" role="status" className="space-y-3">
        {result?.message && (
          <p className={result.ok ? "rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100" : "rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"}>
            {result.message}
          </p>
        )}
        {result?.link && <LinkOnce link={result.link} />}
      </div>
    </div>
  );
}
