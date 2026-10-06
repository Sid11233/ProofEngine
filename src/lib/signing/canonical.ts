import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, so the same data always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface SignedFacts {
  content: unknown;
  consentTextVersion: string;
  consent: { web: boolean; social: boolean; media: boolean };
  signerName: string;
}

/** SHA-256 over the canonical JSON of what the signer agreed to: the content, the wording version, the choices and the name. */
export function contentHash(facts: SignedFacts): string {
  return createHash("sha256")
    .update(
      canonicalJson({ content: facts.content, consent_text_version: facts.consentTextVersion, consent: facts.consent, signer_name: facts.signerName.trim() }),
      "utf8",
    )
    .digest("hex");
}
