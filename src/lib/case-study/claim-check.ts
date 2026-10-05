import type { CaseStudyContent } from "./schema";

// The rules that tie a case study back to the client's own words. Pure functions, used
// by the generator (to verify a draft), by the review screen (to flag edits as they are
// typed) and by the save action (to decide which claims were edited).

export interface ClaimRef {
  id: string;
  /** Exact words the client said, a substring of `messageContent`. */
  sourceQuote: string;
  /** The full client message the quote came from. */
  messageContent: string;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Numbers in a text, trailing punctuation removed ("40." -> "40", "3,000" kept). */
export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/[.,]+$/, ""));
}

const numberSet = (text: string) => new Set(numbersIn(text));

/** Does every number in `value` appear in the client's quote? Text without numbers always matches. */
export function numbersMatch(value: string, claim: ClaimRef): boolean {
  const allowed = numberSet(claim.sourceQuote);
  return numbersIn(value).every((n) => allowed.has(n));
}

/** A quote must be a word-for-word piece of what the client wrote. */
export function quoteMatches(text: string, claim: ClaimRef): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && claim.messageContent.includes(trimmed);
}

export type IssueKind = "unknown_claim" | "number_mismatch" | "quote_mismatch" | "loose_number";

export interface Issue {
  kind: IssueKind;
  /** Where it was found, e.g. "headline" or "sections[2].metrics[0]". */
  where: string;
  detail: string;
}

/** Every string in the content that is not a metric value or a quote, with its location. */
function freeTextFields(content: CaseStudyContent): Array<{ where: string; text: string }> {
  const fields: Array<{ where: string; text: string }> = [{ where: "headline", text: content.headline }];
  content.sections.forEach((section, i) => {
    fields.push({ where: `sections[${i}].title`, text: section.title });
    if (section.body) fields.push({ where: `sections[${i}].body`, text: section.body });
    section.metrics?.forEach((metric, j) => fields.push({ where: `sections[${i}].metrics[${j}].label`, text: metric.label }));
  });
  content.tags.forEach((tag, i) => fields.push({ where: `tags[${i}]`, text: tag }));
  return fields;
}

/**
 * Checks a case study against the client's claims:
 *  - every metric and quote points at a real claim;
 *  - metric values only contain numbers the client said in that claim's quote;
 *  - quotes are exact pieces of the client's message;
 *  - no other text (headline, titles, bodies, labels, tags) contains a number that no
 *    claim contains ("never add, round or infer numbers").
 */
export function verifyContent(content: CaseStudyContent, claims: Map<string, ClaimRef>): Issue[] {
  const issues: Issue[] = [];
  const allowedEverywhere = new Set<string>();
  for (const claim of claims.values()) for (const n of numbersIn(claim.sourceQuote)) allowedEverywhere.add(n);

  content.sections.forEach((section, i) => {
    section.metrics?.forEach((metric, j) => {
      const where = `sections[${i}].metrics[${j}]`;
      const claim = claims.get(metric.claimId);
      if (!claim) return issues.push({ kind: "unknown_claim", where, detail: `"${metric.label}" does not point at a verified claim` });
      if (!numbersMatch(metric.value, claim)) issues.push({ kind: "number_mismatch", where, detail: `"${metric.value}" is not what the client said` });
    });
    if (section.quote) {
      const where = `sections[${i}].quote`;
      const claim = claims.get(section.quote.claimId);
      if (!claim) return issues.push({ kind: "unknown_claim", where, detail: "A quote does not point at a verified claim" });
      if (!quoteMatches(section.quote.text, claim)) issues.push({ kind: "quote_mismatch", where, detail: "A quote is not word for word what the client said" });
    }
  });

  for (const { where, text } of freeTextFields(content)) {
    const stray = numbersIn(text).filter((n) => !allowedEverywhere.has(n));
    if (stray.length > 0) issues.push({ kind: "loose_number", where, detail: `Contains ${stray.join(", ")}, which the client did not say` });
  }
  return issues;
}

/**
 * Claims whose number or quote no longer matches the client's words in this content.
 * Used when the owner edits: these claims need the client to approve again.
 */
export function findEditedClaims(content: CaseStudyContent, claims: Map<string, ClaimRef>): Set<string> {
  const edited = new Set<string>();
  for (const section of content.sections) {
    for (const metric of section.metrics ?? []) {
      const claim = claims.get(metric.claimId);
      if (claim && !numbersMatch(metric.value, claim)) edited.add(claim.id);
    }
    if (section.quote) {
      const claim = claims.get(section.quote.claimId);
      if (claim && !quoteMatches(section.quote.text, claim)) edited.add(claim.id);
    }
  }
  return edited;
}

/**
 * Makes content safe to save when it failed verification: removes unverifiable metrics and
 * quotes and empties free text containing unverified numbers. Whatever this returns passes
 * verifyContent, so a fabricated figure can never be persisted.
 */
export function redactUnverified(content: CaseStudyContent, claims: Map<string, ClaimRef>): CaseStudyContent {
  const allowed = new Set<string>();
  for (const claim of claims.values()) for (const n of numbersIn(claim.sourceQuote)) allowed.add(n);
  const clean = (text: string) => (numbersIn(text).every((n) => allowed.has(n)) ? text : "");

  return {
    ...content,
    headline: clean(content.headline) || "Customer story",
    sections: content.sections.map((section) => {
      const metrics = (section.metrics ?? []).filter((m) => {
        const claim = claims.get(m.claimId);
        return claim && numbersMatch(m.value, claim) && clean(m.label) !== "";
      });
      const quote = section.quote && claims.get(section.quote.claimId) && quoteMatches(section.quote.text, claims.get(section.quote.claimId)!) ? section.quote : undefined;
      const body = section.body ? clean(section.body) : undefined;
      return {
        type: section.type,
        title: clean(section.title) || section.type,
        ...(body ? { body } : {}),
        ...(metrics.length ? { metrics } : {}),
        ...(quote ? { quote } : {}),
      };
    }),
    tags: content.tags.filter((tag) => clean(tag) !== ""),
  };
}
