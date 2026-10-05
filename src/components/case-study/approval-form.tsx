"use client";

import { useState, useTransition } from "react";
import type { DecisionState } from "@/app/approve/[token]/actions";

const button =
  "inline-flex min-h-12 items-center justify-center rounded-md px-5 text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50";

const DONE_COPY = {
  approved: "Thank you. You approved this case study. It will only go live when the team publishes it, and you can ask them to take it down at any time.",
  changes: "Thank you. We sent your note to the team. They will update it and send you a new link.",
  declined: "Understood. This case study will not be published.",
} as const;

export function ApprovalForm({ decide }: { decide: (input: unknown) => Promise<DecisionState> }) {
  const [mode, setMode] = useState<"choose" | "changes" | "decline">("choose");
  const [note, setNote] = useState("");
  const [state, setState] = useState<DecisionState | null>(null);
  const [pending, start] = useTransition();

  const send = (input: unknown) => start(async () => setState(await decide(input)));

  if (state?.ok && state.done) {
    return <p role="status" className="rounded-md border border-green-700/30 bg-green-50 p-4 text-green-950">{DONE_COPY[state.done]}</p>;
  }

  return (
    <div className="space-y-4">
      {state && !state.ok && <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900">{state.message}</p>}
      {mode === "choose" && (
        <div className="flex flex-col gap-3 @sm:flex-row">
          <button type="button" disabled={pending} onClick={() => send({ kind: "approve" })} className={`${button} bg-neutral-900 text-white`}>Approve and allow publishing</button>
          <button type="button" disabled={pending} onClick={() => setMode("changes")} className={`${button} border border-neutral-400`}>Ask for changes</button>
          <button type="button" disabled={pending} onClick={() => setMode("decline")} className={`${button} border border-neutral-400`}>Do not publish</button>
        </div>
      )}
      {mode === "changes" && (
        <form onSubmit={(e) => { e.preventDefault(); send({ kind: "changes", note }); }} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="note">What should change?</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={4} required className="block w-full rounded-md border border-neutral-400 bg-transparent px-3 py-2 text-base" />
          <div className="flex gap-3">
            <button type="submit" disabled={pending || note.trim() === ""} className={`${button} bg-neutral-900 text-white`}>Send to the team</button>
            <button type="button" onClick={() => setMode("choose")} className={`${button} border border-neutral-400`}>Back</button>
          </div>
        </form>
      )}
      {mode === "decline" && (
        <div className="space-y-3">
          <p className="text-sm">The team will not be able to publish this story. This cannot be undone.</p>
          <div className="flex gap-3">
            <button type="button" disabled={pending} onClick={() => send({ kind: "decline" })} className={`${button} bg-red-800 text-white`}>Yes, do not publish</button>
            <button type="button" onClick={() => setMode("choose")} className={`${button} border border-neutral-400`}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
