"use client";

import { useState, useTransition } from "react";

export interface DraftView {
  id: string;
  label: string;
  network: string;
  body: string;
  status: "draft" | "saved" | "posted";
  openHref: string;
  maxChars: number;
}

interface Actions {
  generate: () => Promise<{ ok: boolean; message?: string }>;
  setStatus: (input: unknown) => Promise<{ ok: boolean; message?: string }>;
  discard: (id: string) => Promise<{ ok: boolean; message?: string }>;
}

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-400 px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50";

export function SocialDrafts({ drafts, canEdit, actions }: { drafts: DraftView[]; canEdit: boolean; actions: Actions }) {
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const result = await fn();
      setMessage(result.ok ? null : (result.message ?? "Something went wrong."));
    });

  const copy = async (draft: DraftView) => {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(draft.id);
    } catch {
      setMessage("Your browser blocked copying. Select the text and copy it yourself.");
    }
  };

  const groups = [...new Set(drafts.map((d) => d.network))];

  return (
    <div className="space-y-6">
      {canEdit && (
        <button type="button" disabled={pending} onClick={() => run(actions.generate)} className={primary}>
          {pending ? "Working…" : drafts.length > 0 ? "Write new drafts" : "Write drafts"}
        </button>
      )}
      {message && <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900">{message}</p>}
      {groups.map((network) => (
        <section key={network} className="space-y-3">
          <h2 className="text-lg font-semibold">{drafts.find((d) => d.network === network)?.label}</h2>
          {drafts.filter((d) => d.network === network).map((d) => (
            <article key={d.id} className="space-y-3 rounded-md border border-neutral-300 p-4">
              <p className="whitespace-pre-wrap text-base">{d.body}</p>
              <p className="text-xs text-neutral-600">{d.body.length} / {d.maxChars} characters{d.status !== "draft" && ` · ${d.status === "saved" ? "Saved" : "Posted"}`}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => copy(d)} className={btn}>{copied === d.id ? "Copied" : "Copy text"}</button>
                <a href={d.openHref} target="_blank" rel="noopener noreferrer" className={btn}>Open {d.label}</a>
                {canEdit && d.status === "draft" && <button type="button" disabled={pending} onClick={() => run(() => actions.setStatus({ id: d.id, status: "saved" }))} className={btn}>Save this version</button>}
                {canEdit && d.status !== "posted" && <button type="button" disabled={pending} onClick={() => run(() => actions.setStatus({ id: d.id, status: "posted" }))} className={btn}>Mark as posted</button>}
                {canEdit && d.status !== "draft" && <button type="button" disabled={pending} onClick={() => run(() => actions.setStatus({ id: d.id, status: "draft" }))} className={btn}>Undo</button>}
                {canEdit && <button type="button" disabled={pending} onClick={() => run(() => actions.discard(d.id))} className={btn}>Discard</button>}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
