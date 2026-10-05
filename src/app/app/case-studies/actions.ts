"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { prepareEdit } from "@/lib/case-study/edit";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import type { FieldErrors } from "@/lib/validation/form";
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

  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("case-study-edit", { ip, subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  const prepared = await prepareEdit(supabase, id, content);
  if (!prepared.ok) return { ok: false, message: prepared.message, fieldErrors: prepared.fieldErrors };

  const { data, error } = await supabase.rpc("save_case_study_edit", {
    study: id,
    new_content: prepared.content,
    edited_claims: prepared.edited,
  });
  if (error || typeof data !== "number") {
    return { ok: false, message: error?.code === "22023" ? "Unpublish this case study before editing it." : "We could not save your changes. Please try again." };
  }
  const edited = new Set(prepared.edited);

  revalidatePath(`/app/case-studies/${id}/review`);
  revalidatePath("/app/case-studies");
  return { ok: true, version: data, editedClaims: edited.size };
}
