"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { findEditedClaims, verifyContent, type ClaimRef } from "@/lib/case-study/claim-check";
import { loadCaseStudy } from "@/lib/case-study/load";
import { caseStudyContentSchema } from "@/lib/case-study/schema";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { fieldErrorsOf, type FieldErrors } from "@/lib/validation/form";
import { z } from "zod";

export interface SaveResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  version?: number;
  /** Claims whose number or quote no longer matches the client's words. */
  editedClaims?: number;
}

/**
 * Saves the owner's edits as the next version. The server decides what counts as an edit
 * to a verified claim; the browser's opinion is never used.
 */
export async function saveCaseStudyAction(id: string, content: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return { ok: false, message: "You do not have permission to do that." };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "That case study was not found." };

  const parsed = caseStudyContentSchema.safeParse(content);
  if (!parsed.success) return { ok: false, message: "Some fields are not valid.", fieldErrors: fieldErrorsOf(parsed.error) };

  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("case-study-edit", { ip, subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  const study = await loadCaseStudy(supabase, id);
  if (!study) return { ok: false, message: "That case study was not found." };
  if (study.status === "published") return { ok: false, message: "Unpublish this case study before editing it." };

  const refs = new Map<string, ClaimRef>(study.claims.map((c) => [c.id, c]));
  // Every metric and quote must still point at one of THIS study's claims.
  const unknown = verifyContent(parsed.data, refs).filter((issue) => issue.kind === "unknown_claim");
  if (unknown.length > 0) return { ok: false, message: "A number or quote is not linked to something your client said." };

  const edited = findEditedClaims(parsed.data, refs);
  const { data, error } = await supabase.rpc("save_case_study_edit", {
    study: id,
    new_content: parsed.data,
    edited_claims: [...edited],
  });
  if (error || typeof data !== "number") {
    return { ok: false, message: error?.code === "22023" ? "Unpublish this case study before editing it." : "We could not save your changes. Please try again." };
  }

  revalidatePath(`/app/case-studies/${id}/review`);
  revalidatePath("/app/case-studies");
  return { ok: true, version: data, editedClaims: edited.size };
}
