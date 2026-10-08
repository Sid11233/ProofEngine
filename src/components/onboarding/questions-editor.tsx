"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { TextArea } from "@/components/ui/fields";
import { MAX_ONBOARDING_QUESTIONS, type OnboardingQuestion } from "@/lib/onboarding/flow";

const newId = () => `n${Math.random().toString(36).slice(2, 8)}`;

/** The onboarding questions "CMS": add, reorder, edit and remove. The server validates everything again on save. */
export function QuestionsEditor({ initial, custom, workspaceName, save, reset }: {
  initial: OnboardingQuestion[];
  custom: boolean;
  workspaceName: string;
  save: (questions: unknown) => Promise<{ ok: boolean; message?: string }>;
  reset: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [questions, setQuestions] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; message?: string }>();
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const change = (fn: (q: OnboardingQuestion[]) => OnboardingQuestion[]) => { setQuestions(fn); setDirty(true); setStatus(undefined); };
  const move = (i: number, d: -1 | 1) => change((list) => { const j = i + d; if (j < 0 || j >= list.length) return list; const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next; });

  return (
    <div className="space-y-4">
      <Callout tone="info">
        These are the questions your clients are asked. Use <code>{"{{workspace}}"}</code> for your business name ({workspaceName}). Links you already sent keep the questions they had; new links use this list.
      </Callout>
      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.id} className="space-y-2 rounded-card border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Question {i + 1}</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="quiet" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</Button>
                <Button size="sm" variant="quiet" aria-label={`Move question ${i + 1} down`} disabled={i === questions.length - 1} onClick={() => move(i, 1)}>Down</Button>
                <Button size="sm" variant="quiet" aria-label={`Remove question ${i + 1}`} disabled={questions.length <= 1} onClick={() => change((l) => l.filter((_, j) => j !== i))}>Remove</Button>
              </span>
            </div>
            <TextArea aria-label={`Question ${i + 1} text`} rows={2} maxLength={300} value={q.text} onChange={(e) => change((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <Checkbox checked={q.key === "short"} onChange={(e) => change((l) => l.map((x, j) => (j === i ? { id: x.id, text: x.text, ...(e.target.checked ? { key: "short" as const } : {}) } : x)))}>Short answer (a link, a name or a date): do not ask follow-up questions</Checkbox>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={questions.length >= MAX_ONBOARDING_QUESTIONS} onClick={() => change((l) => [...l, { id: newId(), text: "" }])}>Add a question</Button>
        <Button loading={pending} disabled={!dirty} onClick={() => start(async () => { const r = await save(questions); setStatus(r); if (r.ok) setDirty(false); })}>Save questions</Button>
        {custom ? <Button variant="quiet" disabled={pending} onClick={() => { if (window.confirm("Go back to the standard questions? Your own list will be deleted.")) start(async () => { const r = await reset(); setStatus(r); if (r.ok) window.location.reload(); }); }}>Reset to standard</Button> : null}
      </div>
      <p role="status" aria-live="polite" className={`text-sm ${status?.ok ? "text-[#166534]" : "text-[#b42318]"}`}>{status?.message ?? ""}</p>
      <p className="text-xs text-muted">{questions.length} of {MAX_ONBOARDING_QUESTIONS} questions. The AI only ever asks these questions, plus short follow-ups for open ones.</p>
    </div>
  );
}
