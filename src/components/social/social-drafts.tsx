"use client";

import { useTransition } from "react";
import { CopyButton } from "@/components/motion/copy-button";
import { useToast } from "@/components/motion/toast";

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
  const toast = useToast();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast.show(result.message ?? "Something went wrong.", "error");
    });

  const groups = [...new Set(drafts.map((d) => d.network))];

  return (
    <div className="space-y-6">
      {canEdit && (
        <button type="button" disabled={pending} onClick={() => run(actions.generate)} className={primary}>
          {pending ? "Working…" : drafts.length > 0 ? "Write new drafts" : "Write drafts"}
        </button>
      )}
      {groups.map((network) => (
        <section key={network} className="space-y-3">
          <h2 className="text-lg font-semibold">{drafts.find((d) => d.network === network)?.label}</h2>
          {drafts.filter((d) => d.network === network).map((d) => (
            <article key={d.id} className="space-y-3 rounded-md border border-neutral-300 p-4">
              <p className="whitespace-pre-wrap text-base">{d.body}</p>
              <p className="text-xs text-neutral-600">{d.body.length} / {d.maxChars} characters{d.status !== "draft" && ` · ${d.status === "saved" ? "Saved" : "Posted"}`}</p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={d.body} label="Copy text" onError={(text) => toast.show(text, "error")} />
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
