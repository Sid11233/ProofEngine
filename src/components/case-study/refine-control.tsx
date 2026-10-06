"use client";

import { useId, useState, useTransition } from "react";
import type { RefineActionResult } from "@/app/app/case-studies/[id]/edit/actions";
import { diffWords } from "@/lib/case-study/diff";
import { INSTRUCTION_MAX, PRESETS, PRESET_LABELS, type Preset } from "@/lib/case-study/refine-core";

export interface RefineActions {
  refine: (input: unknown) => Promise<RefineActionResult>;
  accept: (input: unknown) => Promise<RefineActionResult>;
  restore: (input: unknown) => Promise<RefineActionResult>;
}

interface Props {
  caseStudyId: string;
  fieldPath: string;
  /** What the owner is looking at. */
  currentText: string;
  refined: boolean;
  disabled: boolean;
  actions: RefineActions;
  /** Saves pending edits so the server sees the same text; false when that was not possible. */
  ensureSaved: () => Promise<boolean>;
  onApplied: (fieldPath: string, text: string, version: number, restored: boolean) => void;
}

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900 disabled:opacity-50";

/** The subtle badge for a field that no longer holds the client's own words. */
export function RefinedBadge() {
  return <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600">edited from client&apos;s words</span>;
}

/** "Refine with AI" for one text field: presets, an optional note, a word-level diff, then Accept, Reject or Try again. */
export function RefineControl({ caseStudyId, fieldPath, currentText, refined, disabled, actions, ensureSaved, onApplied }: Props) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [last, setLast] = useState<Preset | null>(null);
  const [suggestion, setSuggestion] = useState<{ original: string; suggested: string; ticket: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => { setSuggestion(null); setMessage(null); setOpen(false); };

  const run = (preset: Preset) =>
    start(async () => {
      setMessage(null);
      setLast(preset);
      if (!(await ensureSaved())) return setMessage("Fix the highlighted fields first, so your latest text is saved.");
      const result = await actions.refine({ caseStudyId, fieldPath, preset, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) });
      if (!result.ok || !result.original || !result.suggested || !result.ticket) return setMessage(result.message ?? "Something went wrong.");
      setSuggestion({ original: result.original, suggested: result.suggested, ticket: result.ticket });
      setOpen(false);
    });

  const accept = () =>
    start(async () => {
      if (!suggestion) return;
      const result = await actions.accept({ caseStudyId, fieldPath, suggested: suggestion.suggested, ticket: suggestion.ticket });
      if (!result.ok || result.version === undefined || result.text === undefined) return setMessage(result.message ?? "Something went wrong.");
      onApplied(fieldPath, result.text, result.version, false);
      reset();
    });

  const restore = () =>
    start(async () => {
      setMessage(null);
      if (!(await ensureSaved())) return setMessage("Fix the highlighted fields first, so your latest text is saved.");
      const result = await actions.restore({ caseStudyId, fieldPath });
      if (!result.ok || result.version === undefined || result.text === undefined) return setMessage(result.message ?? "Something went wrong.");
      onApplied(fieldPath, result.text, result.version, true);
      reset();
    });

  const parts = suggestion ? diffWords(suggestion.original, suggestion.suggested) : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={disabled || pending || currentText.trim() === ""} aria-expanded={open} aria-controls={menuId} onClick={() => { setOpen(!open); setMessage(null); }}>
          Refine with AI
        </button>
        {refined && (
          <>
            <RefinedBadge />
            <button type="button" className={btn} disabled={disabled || pending} onClick={restore}>Restore client&apos;s original wording</button>
          </>
        )}
      </div>

      {open && (
        <div id={menuId} role="group" aria-label="Refine with AI" className="space-y-3 rounded-md border border-neutral-300 p-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button key={preset} type="button" className={btn} disabled={pending} onClick={() => run(preset)}>{PRESET_LABELS[preset]}</button>
            ))}
          </div>
          <div className="space-y-1">
            <label htmlFor={`${menuId}-note`} className="block text-sm font-medium">Optional note ({instruction.length}/{INSTRUCTION_MAX})</label>
            <textarea id={`${menuId}-note`} rows={2} maxLength={INSTRUCTION_MAX} value={instruction} onChange={(e) => setInstruction(e.target.value)} className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base" />
            <p className="text-xs text-neutral-600">Pick a style above. The AI only rephrases: it keeps every number, name and quote.</p>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite" className="text-sm text-neutral-700">{pending ? "Working…" : ""}</div>
      {message && <p role="alert" className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900">{message}</p>}

      {suggestion && (
        <div className="space-y-3 rounded-md border border-neutral-300 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">Now</p>
              <p className="mt-1 whitespace-pre-wrap text-base">
                {parts.filter((p) => p.kind !== "added").map((p, i) => <span key={i} className={p.kind === "removed" ? "bg-red-100 line-through" : undefined}>{p.text}</span>)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">Suggestion</p>
              <p className="mt-1 whitespace-pre-wrap text-base">
                {parts.filter((p) => p.kind !== "removed").map((p, i) => <span key={i} className={p.kind === "added" ? "bg-green-100" : undefined}>{p.text}</span>)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-neutral-900 text-white hover:bg-neutral-800`} disabled={pending} onClick={accept}>Accept</button>
            <button type="button" className={btn} disabled={pending} onClick={reset}>Reject</button>
            <button type="button" className={btn} disabled={pending || !last} onClick={() => last && run(last)}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
