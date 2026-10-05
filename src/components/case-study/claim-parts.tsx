import type { ClaimRef } from "@/lib/case-study/claim-check";

export interface ReviewClaim extends ClaimRef {
  text: string;
  confirmed: boolean;
  edited: boolean;
}

/** The client's message with the quoted words highlighted. Plain text nodes only, never HTML. */
function SourceMessage({ claim }: { claim: ClaimRef }) {
  const at = claim.messageContent.indexOf(claim.sourceQuote);
  if (at < 0) return <p className="whitespace-pre-wrap break-words">{claim.messageContent}</p>;
  const end = at + claim.sourceQuote.length;
  return (
    <p className="whitespace-pre-wrap break-words">
      {claim.messageContent.slice(0, at)}
      <mark className="rounded bg-yellow-200 px-0.5 text-neutral-900">{claim.messageContent.slice(at, end)}</mark>
      {claim.messageContent.slice(end)}
    </p>
  );
}

export function Source({ claim, label }: { claim: ReviewClaim | undefined; label: string }) {
  if (!claim) return <p className="text-sm text-red-700 dark:text-red-400">No source: this should not be published.</p>;
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2">Source for {label}</summary>
      <div className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-600 dark:text-neutral-400">What your client wrote</p>
        <SourceMessage claim={claim} />
      </div>
    </details>
  );
}

export function Flag({ edited, wasConfirmed }: { edited: boolean; wasConfirmed: boolean }) {
  if (!edited) return null;
  return (
    <p role="status" className="rounded-md border border-amber-700/30 bg-amber-50 px-2 py-1 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      Edited: this no longer matches what your client said, so they must approve it again{wasConfirmed ? " (their earlier approval no longer applies)" : ""}.
    </p>
  );
}

