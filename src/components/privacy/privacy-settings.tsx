"use client";

import { useState, useTransition } from "react";
import type { PrivacyActionResult } from "@/app/app/settings/privacy/actions";
import { ReauthPrompt } from "@/components/auth/reauth-prompt";

interface Props {
  isOwner: boolean;
  workspaceName: string;
  workspaceDeletion: string | null;
  accountDeletion: string | null;
  actions: {
    requestWorkspace: (input: unknown) => Promise<PrivacyActionResult>;
    cancelWorkspace: () => Promise<PrivacyActionResult>;
    requestAccount: (input: unknown) => Promise<PrivacyActionResult>;
    cancelAccount: () => Promise<PrivacyActionResult>;
  };
}

const field = "block min-h-11 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700";
const button = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 px-5 font-medium disabled:opacity-50 dark:border-neutral-700";
const danger = "inline-flex min-h-11 items-center rounded-md bg-red-800 px-5 font-medium text-white disabled:opacity-50";
const addDays = (iso: string) => new Date(Date.parse(iso) + 30 * 86_400_000).toISOString().slice(0, 10);

export function PrivacySettings({ isOwner, workspaceName, workspaceDeletion, accountDeletion, actions }: Props) {
  const [message, setMessage] = useState<string>();
  const [retry, setRetry] = useState<{ needed: NonNullable<PrivacyActionResult["reauth"]>; run: () => void } | null>(null);
  const [confirmWorkspace, setConfirmWorkspace] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [exporting, setExporting] = useState(false);
  const [pending, start] = useTransition();

  function run(task: () => Promise<PrivacyActionResult>, doneMessage: (r: PrivacyActionResult) => string) {
    setMessage(undefined);
    start(async () => {
      const result = await task();
      if (result.reauth) return setRetry({ needed: result.reauth, run: () => run(task, doneMessage) });
      setRetry(null);
      setMessage(result.ok ? doneMessage(result) : (result.message ?? "Something went wrong."));
    });
  }

  async function exportData() {
    setMessage(undefined);
    setExporting(true);
    try {
      const response = await fetch("/api/export", { method: "POST", credentials: "same-origin" });
      if (response.status === 401) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (body.error === "reauth") return setRetry({ needed: "password", run: () => void exportData() });
      }
      if (!response.ok) return setMessage(response.status === 429 ? "You can export three times an hour. Please try again later." : "We could not create the export.");
      setRetry(null);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `workspace-export-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Your export was downloaded.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-10">
      <div role="status" aria-live="polite">{message ? <p className="rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">{message}</p> : null}</div>
      {retry && <ReauthPrompt needed={retry.needed} onDone={() => retry.run()} />}

      {isOwner && (
        <section aria-labelledby="export-heading" className="space-y-2">
          <h2 id="export-heading" className="text-lg font-semibold">Export your data</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">A zip of JSON files with everything in this workspace: requests, interviews and transcripts, case studies and versions, referrals, approvals and more. It contains your clients&rsquo; personal data, so keep it safe.</p>
          <button type="button" className={button} disabled={exporting} onClick={() => void exportData()}>{exporting ? "Preparing..." : "Download export (zip)"}</button>
        </section>
      )}

      <section aria-labelledby="workspace-heading" className="space-y-3">
        <h2 id="workspace-heading" className="text-lg font-semibold">Delete this workspace</h2>
        {workspaceDeletion ? (
          <>
            <p role="note" className="rounded-md border border-red-700/30 bg-red-50 p-3 text-sm text-red-950">This workspace is scheduled to be deleted for good on <strong>{addDays(workspaceDeletion)}</strong>. Public pages are already offline and every link is revoked.</p>
            {isOwner && <button type="button" className={button} disabled={pending} onClick={() => run(actions.cancelWorkspace, (r) => r.message ?? "Cancelled.")}>Cancel the deletion</button>}
          </>
        ) : isOwner ? (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Everything is deleted after 30 days: interviews, transcripts, uploaded files, claims, case studies and their versions, referrals and the team. Until then you can cancel, but public pages go offline and all links are revoked immediately. Cancel your subscription first.</p>
            <label htmlFor="confirm-workspace" className="block text-sm font-medium">Type the workspace name ({workspaceName}) to confirm</label>
            <input id="confirm-workspace" className={field} value={confirmWorkspace} onChange={(e) => setConfirmWorkspace(e.target.value)} autoComplete="off" maxLength={200} />
            <button type="button" className={danger} disabled={pending || confirmWorkspace.trim() !== workspaceName} onClick={() => run(() => actions.requestWorkspace({ confirm: confirmWorkspace }), (r) => `Scheduled. Everything will be deleted on ${r.scheduledFor}.`)}>Schedule deletion</button>
          </>
        ) : (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Only the workspace owner can delete the workspace.</p>
        )}
      </section>

      <section aria-labelledby="account-heading" className="space-y-3">
        <h2 id="account-heading" className="text-lg font-semibold">Delete your account</h2>
        {accountDeletion ? (
          <>
            <p role="note" className="rounded-md border border-red-700/30 bg-red-50 p-3 text-sm text-red-950">Your account is scheduled to be deleted on <strong>{addDays(accountDeletion)}</strong>.</p>
            <button type="button" className={button} disabled={pending} onClick={() => run(actions.cancelAccount, (r) => r.message ?? "Cancelled.")}>Cancel the deletion</button>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Deletes your sign-in and profile after 30 days, and every workspace you are the only person in. If you are the only owner of a workspace with other members, make someone else an owner first.</p>
            <label htmlFor="confirm-account" className="block text-sm font-medium">Type DELETE to confirm</label>
            <input id="confirm-account" className={field} value={confirmAccount} onChange={(e) => setConfirmAccount(e.target.value)} autoComplete="off" maxLength={20} />
            <button type="button" className={danger} disabled={pending || confirmAccount.trim() !== "DELETE"} onClick={() => run(() => actions.requestAccount({ confirm: confirmAccount }), (r) => `Scheduled. Your account will be deleted on ${r.scheduledFor}.`)}>Schedule account deletion</button>
          </>
        )}
      </section>
    </div>
  );
}
