import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimRef } from "./claim-check";
import { caseStudyContentSchema, type CaseStudyContent } from "./schema";
import type { Issue } from "./claim-check";

export interface ClaimView extends ClaimRef {
  text: string;
  confirmed: boolean;
  edited: boolean;
}

export interface CaseStudyView {
  id: string;
  workspaceId: string;
  status: string;
  slug: string | null;
  declined: boolean;
  version: number;
  templateId: string | null;
  themeSettings: unknown;
  content: CaseStudyContent;
  issues: Issue[];
  claims: ClaimView[];
}

/** Everything the review screen needs, read under the caller's own row-level security. */
export async function loadCaseStudy(supabase: SupabaseClient, id: string): Promise<CaseStudyView | null> {
  const { data: study } = await supabase
    .from("case_studies")
    .select("id, workspace_id, status, slug, client_declined_at, current_version, content, generation_issues, template_id, theme_settings")
    .eq("id", id)
    .maybeSingle();
  if (!study) return null;

  const content = caseStudyContentSchema.safeParse(study.content);
  if (!content.success) return null;

  const { data: claimRows } = await supabase
    .from("claims")
    .select("id, text, source_message_id, source_quote, client_confirmed, edited")
    .eq("case_study_id", id);
  const messageIds = [...new Set((claimRows ?? []).map((c) => String(c.source_message_id)))];
  const { data: messages } = messageIds.length
    ? await supabase.from("interview_messages").select("id, content").in("id", messageIds)
    : { data: [] as Array<{ id: string; content: string }> };
  const contentOf = new Map((messages ?? []).map((m) => [String(m.id), String(m.content)] as const));

  return {
    id: String(study.id),
    workspaceId: String(study.workspace_id),
    status: String(study.status),
    slug: typeof study.slug === "string" ? study.slug : null,
    declined: study.client_declined_at !== null,
    version: Number(study.current_version),
    templateId: typeof study.template_id === "string" ? study.template_id : null,
    themeSettings: study.theme_settings ?? {},
    content: content.data,
    issues: Array.isArray(study.generation_issues) ? (study.generation_issues as Issue[]) : [],
    claims: (claimRows ?? []).map((c) => ({
      id: String(c.id),
      text: String(c.text),
      sourceQuote: String(c.source_quote),
      messageContent: contentOf.get(String(c.source_message_id)) ?? "",
      confirmed: c.client_confirmed === true,
      edited: c.edited === true,
    })),
  };
}
