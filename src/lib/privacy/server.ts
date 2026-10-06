import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeFiles } from "./files";

/**
 * Removes uploaded files after the calling action has authenticated the user, checked their role in the
 * workspace and read the paths through their own client (so they can only be paths of that workspace).
 */
export async function removeUploadFiles(workspaceId: string, paths: string[]): Promise<void> {
  const own = paths.filter((p) => p.startsWith(`${workspaceId}/`));
  if (own.length !== paths.length) throw new Error("path outside the workspace");
  await removeFiles(createAdminClient(), "uploads", own);
}
