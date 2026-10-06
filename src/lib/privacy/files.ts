import type { SupabaseClient } from "@supabase/supabase-js";

// Storage cleanup for the privacy routines. Both private buckets hold files under `{workspace_id}/...`
// (logos, interview uploads, exports). Files are removed BEFORE the database rows, and a removal that fails
// throws, so the rows stay and the job tries again instead of leaving files nobody can find.

export const BUCKETS = ["uploads", "exports"] as const;
const PAGE = 100;

/** Every file path under a prefix, folders included recursively. */
export async function listFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`could not list ${bucket}`);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // A folder has no id (it is only a prefix); descend into it.
      if (item.id === null) out.push(...(await listFiles(admin, bucket, path)));
      else out.push(path);
    }
    if ((data ?? []).length < PAGE) return out;
  }
}

export async function removeFiles(admin: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + PAGE));
    if (error) throw new Error(`could not remove files from ${bucket}`);
  }
}

/** Removes every file of a workspace from every bucket and confirms nothing is left. */
export async function deleteWorkspaceFiles(admin: SupabaseClient, workspaceId: string): Promise<number> {
  let removed = 0;
  for (const bucket of BUCKETS) {
    const files = await listFiles(admin, bucket, workspaceId);
    await removeFiles(admin, bucket, files);
    removed += files.length;
    if ((await listFiles(admin, bucket, workspaceId)).length > 0) throw new Error(`files remain in ${bucket}`);
  }
  return removed;
}
