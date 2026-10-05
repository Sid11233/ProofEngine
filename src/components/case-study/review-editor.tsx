"use client";

import { useMemo, useState, useTransition } from "react";
import { numbersMatch, quoteMatches } from "@/lib/case-study/claim-check";
import { caseStudyContentSchema, type CaseStudyContent } from "@/lib/case-study/schema";
import type { SaveResult } from "@/app/app/case-studies/actions";
import { Flag, Source, type ReviewClaim } from "./claim-parts";

interface Props {
  id: string;
  version: number;
  status: string;
  canEdit: boolean;
  initial: CaseStudyContent;
  claims: ReviewClaim[];
  issues: Array<{ kind: string; where: string; detail: string }>;
  save: (id: string, content: unknown) => Promise<SaveResult>;
}

const inputClass =
  "block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:opacity-70 dark:border-neutral-700 dark:focus-visible:border-neutral-100";

export function ReviewEditor({ id, version, status, canEdit, initial, claims, issues, save }: Props) {
  const [content, setContent] = useState<CaseStudyContent>(initial);
  const [result, setResult] = useState<SaveResult>();
  const [currentVersion, setCurrentVersion] = useState(version);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const claimOf = useMemo(() => new Map(claims.map((c) => [c.id, c] as const)), [claims]);

  const update = (next: CaseStudyContent) => {
    setContent(next);
    setDirty(true);
    setResult(undefined);
  };
  const setSection = (index: number, patch: Partial<CaseStudyContent["sections"][number]>) =>
    update({ ...content, sections: content.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) });

  const check = caseStudyContentSchema.safeParse(content);

  function onSave() {
    startTransition(async () => {
      const outcome = await save(id, content);
      setResult(outcome);
      if (outcome.ok) {
        setDirty(false);
        if (outcome.version) setCurrentVersion(outcome.version);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div role="note" className="rounded-md border border-amber-700/30 bg-amber-50 px-4 py-3 font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        Numbers must match what your client said.
      </div>

      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Version {currentVersion} · status: {status}. Every number and quote below links to the client&rsquo;s own words. Saving creates a new version and returns the study to draft.
      </p>

      {issues.length > 0 && (
        <section aria-labelledby="issues-heading" className="rounded-md border border-neutral-300 p-4 dark:border-neutral-700">
          <h2 id="issues-heading" className="font-semibold">We removed some things we could not verify</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {issues.map((issue, i) => (
              <li key={i}>{issue.detail}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-1.5">
        <label htmlFor="headline" className="block text-sm font-medium">Headline</label>
        <input id="headline" className={inputClass} value={content.headline} maxLength={120} disabled={!canEdit} onChange={(e) => update({ ...content, headline: e.target.value })} />
      </div>

      {content.sections.map((section, index) => (
        <section key={index} className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800" aria-label={`${section.type} section`}>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{section.type}</p>
          <div className="space-y-1.5">
            <label htmlFor={`title-${index}`} className="block text-sm font-medium">Title</label>
            <input id={`title-${index}`} className={inputClass} value={section.title} maxLength={120} disabled={!canEdit} onChange={(e) => setSection(index, { title: e.target.value })} />
          </div>
          {section.body !== undefined && (
            <div className="space-y-1.5">
              <label htmlFor={`body-${index}`} className="block text-sm font-medium">Text</label>
              <textarea id={`body-${index}`} className={inputClass} rows={4} value={section.body} maxLength={2000} disabled={!canEdit} onChange={(e) => setSection(index, { body: e.target.value })} />
            </div>
          )}

          {section.metrics?.map((metric, mIndex) => {
            const claim = claimOf.get(metric.claimId);
            const edited = claim ? !numbersMatch(metric.value, claim) : true;
            const setMetric = (patch: Partial<typeof metric>) =>
              setSection(index, { metrics: section.metrics?.map((m, i) => (i === mIndex ? { ...m, ...patch } : m)) });
            return (
              <div key={mIndex} className="space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor={`label-${index}-${mIndex}`} className="block text-sm font-medium">Metric</label>
                    <input id={`label-${index}-${mIndex}`} className={inputClass} value={metric.label} maxLength={80} disabled={!canEdit} onChange={(e) => setMetric({ label: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`value-${index}-${mIndex}`} className="block text-sm font-medium">Value</label>
                    <input id={`value-${index}-${mIndex}`} className={inputClass} value={metric.value} maxLength={40} disabled={!canEdit} onChange={(e) => setMetric({ value: e.target.value })} />
                  </div>
                </div>
                <Source claim={claim} label={metric.label} />
                <Flag edited={edited} wasConfirmed={claim?.confirmed ?? false} />
              </div>
            );
          })}

          {section.quote && (() => {
            const quote = section.quote;
            const claim = claimOf.get(quote.claimId);
            const edited = claim ? !quoteMatches(quote.text, claim) : true;
            return (
              <div className="space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
                <div className="space-y-1.5">
                  <label htmlFor={`quote-${index}`} className="block text-sm font-medium">Quote</label>
                  <textarea id={`quote-${index}`} className={inputClass} rows={3} value={quote.text} maxLength={500} disabled={!canEdit} onChange={(e) => setSection(index, { quote: { ...quote, text: e.target.value } })} />
                </div>
                <Source claim={claim} label="this quote" />
                <Flag edited={edited} wasConfirmed={claim?.confirmed ?? false} />
              </div>
            );
          })()}
        </section>
      ))}

      <div aria-live="polite" role="status" className="space-y-2">
        {result?.ok && (
          <p className="rounded-md border border-green-700/30 bg-green-50 px-3 py-2 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">
            Saved as version {result.version}.{result.editedClaims ? ` ${result.editedClaims} edited item${result.editedClaims > 1 ? "s" : ""} will need your client's approval.` : ""}
          </p>
        )}
        {result && !result.ok && (
          <p className="rounded-md border border-red-700/30 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{result.message}</p>
        )}
        {!check.success && <p className="text-sm text-red-700 dark:text-red-400">{check.error.issues[0]?.message ?? "Some fields are not valid."}</p>}
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty || !check.success}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-5 py-2 text-base font-medium text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">You can view this case study but not change it.</p>
      )}
    </div>
  );
}
