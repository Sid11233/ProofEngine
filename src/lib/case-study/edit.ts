import type { SupabaseClient } from "@supabase/supabase-js";
import { findEditedClaims, verifyContent, type ClaimRef } from "./claim-check";
import { loadCaseStudy, type CaseStudyView } from "./load";
import { caseStudyContentSchema, type CaseStudyContent } from "./schema";
import type { FieldErrors } from "@/lib/validation/form";
import { fieldErrorsOf } from "@/lib/validation/form";

export type PrepareResult =
  | { ok: true; study: CaseStudyView; content: CaseStudyContent; edited: string[] }
  | { ok: false; message: string; fieldErrors?: FieldErrors };

/**
 * Everything a save needs, decided on the server and never taken from the browser:
 * the content is validated against the schema, every metric and quote must still point at one
 * of THIS study's claims, and the set of claims whose number or quote no longer matches the
 * client's words is computed here.
 */
export async function prepareEdit(supabase: SupabaseClient, id: string, content: unknown): Promise<PrepareResult> {
  const parsed = caseStudyContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, message: "Some fields are not valid.", fieldErrors: fieldErrorsOf(parsed.error) };

  const study = await loadCaseStudy(supabase, id);
  if (!study) return { ok: false, message: "That case study was not found." };
  if (study.status === "published") return { ok: false, message: "Unpublish this case study before editing it." };

  const refs = new Map<string, ClaimRef>(study.claims.map((c) => [c.id, c]));
  if (verifyContent(parsed.data, refs).some((issue) => issue.kind === "unknown_claim")) {
    return { ok: false, message: "A number or quote is not linked to something your client said." };
  }
  return { ok: true, study, content: parsed.data, edited: [...findEditedClaims(parsed.data, refs)] };
}
