"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { headers } from "next/headers";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { loadCaseStudy } from "@/lib/case-study/load";
import { loadTemplate } from "@/lib/templates/load";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface SelectTemplateResult {
  ok: boolean;
  message?: string;
}

/**
 * Switches a case study's template. Only `template_id` and the theme change: the content JSON
 * is never touched, so switching can never alter what the client said. Locked (paid) templates
 * can be selected to preview with a watermark; publishing them is blocked by the database.
 */
export async function selectTemplateAction(studyId: string, templateId: string): Promise<SelectTemplateResult> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return { ok: false, message: "You do not have permission to do that." };
  if (!(await isAuthAttemptAllowed("case-study-edit", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const ids = z.object({ studyId: z.uuid(), templateId: z.uuid() }).strict().safeParse({ studyId, templateId });
  if (!ids.success) return { ok: false, message: "That template could not be used." };

  const supabase = await createClient();
  const study = await loadCaseStudy(supabase, ids.data.studyId);
  if (!study) return { ok: false, message: "That case study was not found." };
  if (study.status === "published") return { ok: false, message: "Unpublish this case study before changing its template." };

  const template = await loadTemplate(supabase, ids.data.templateId);
  if (!template) return { ok: false, message: "That template is not available." };

  // Row-level security makes this editor+ only and keeps it inside the workspace. The payload
  // names only these two columns; content, version and status are not in it.
  const { data, error } = await supabase
    .from("case_studies")
    .update({ template_id: template.id, theme_settings: {} })
    .eq("id", study.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "We could not change the template. Please try again." };

  await supabase.rpc("write_audit_log", { ws: workspace.id, action: "case_study.template", target: study.id });
  revalidatePath(`/app/case-studies/${study.id}/template`);
  return { ok: true, message: `Now using ${template.name}.` };
}
