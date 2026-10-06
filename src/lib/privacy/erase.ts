import type { SupabaseClient } from "@supabase/supabase-js";
import { removeFiles } from "./files";

/**
 * The client's "remove my story": deletes the case study, its interview and the request (their name and
 * email) for good, including every uploaded file and the logo. Files first, then rows.
 */
export async function eraseStory(admin: SupabaseClient, caseStudyId: string): Promise<boolean> {
  const { data: study } = await admin.from("case_studies").select("content").eq("id", caseStudyId).maybeSingle();
  if (!study) return false;
  const { data: paths } = await admin.rpc("story_upload_paths", { study: caseStudyId });
  const logo = (study.content as { client?: { logoPath?: unknown } } | null)?.client?.logoPath;
  const files = [...((paths ?? []) as string[]), ...(typeof logo === "string" ? [logo] : [])];
  await removeFiles(admin, "uploads", files);
  const { data, error } = await admin.rpc("erase_story", { study: caseStudyId });
  if (error) throw new Error("erase failed");
  return data === true;
}
