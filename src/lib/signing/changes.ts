import { numbersMatch, quoteMatches, type ClaimRef } from "@/lib/case-study/claim-check";
import { readField } from "@/lib/case-study/refine-core";
import type { CaseStudyContent } from "@/lib/case-study/schema";

export interface ChangedField {
  label: string;
  /** Wording before it was rewritten (null when only the client's claim was edited). */
  before: string | null;
  after: string;
  kind: "rewritten" | "edited_quote" | "edited_number";
}

const labelOf = (content: CaseStudyContent, path: string) =>
  path === "headline" ? "Headline" : `${content.sections[Number(path.split(".")[1])]?.title ?? "Section"}`;

/**
 * "What we changed from your words": every AI-rewritten field with its earlier wording, plus quotes and numbers
 * that no longer match what the client said. `originals` maps a field path to the text before it was first refined.
 */
export function changedFields(content: CaseStudyContent, refinedFields: string[], originals: Map<string, string>, claims: Map<string, ClaimRef>): ChangedField[] {
  const out: ChangedField[] = [];
  for (const path of refinedFields) {
    const field = readField(content, path);
    if (field.ok) out.push({ label: labelOf(content, path), before: originals.get(path) ?? null, after: field.text, kind: "rewritten" });
  }
  for (const section of content.sections) {
    if (section.quote) {
      const claim = claims.get(section.quote.claimId);
      if (!claim || !quoteMatches(section.quote.text, claim)) out.push({ label: `${section.title} (quote)`, before: claim?.sourceQuote ?? null, after: section.quote.text, kind: "edited_quote" });
    }
    for (const metric of section.metrics ?? []) {
      const claim = claims.get(metric.claimId);
      if (!claim || !numbersMatch(metric.value, claim)) out.push({ label: `${section.title}: ${metric.label}`, before: claim?.sourceQuote ?? null, after: metric.value, kind: "edited_number" });
    }
  }
  return out;
}
