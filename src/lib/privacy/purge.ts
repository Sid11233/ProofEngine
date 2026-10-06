import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteWorkspaceFiles, removeFiles } from "./files";

// The daily purge job. Each step is independent: one workspace that fails (storage down, a guard) is
// reported and retried tomorrow without blocking the others. Nothing here logs names, emails or ids.

export interface PurgeSummary {
  workspaces: number;
  accounts: number;
  staleRequests: number;
  failures: number;
}

export async function runPurge(admin: SupabaseClient): Promise<PurgeSummary> {
  const summary: PurgeSummary = { workspaces: 0, accounts: 0, staleRequests: 0, failures: 0 };

  // 1. Workspaces whose 30 day grace period is over: files first, then the rows.
  const { data: workspaces } = await admin.rpc("due_workspace_deletions");
  for (const row of (workspaces ?? []) as Array<{ workspace_id: string }>) {
    try {
      await deleteWorkspaceFiles(admin, row.workspace_id);
      const { data, error } = await admin.rpc("hard_delete_workspace", { ws: row.workspace_id });
      if (error) throw new Error("hard delete failed");
      if (data === true) summary.workspaces += 1;
    } catch {
      summary.failures += 1;
    }
  }

  // 2. Accounts whose grace period is over (after their workspaces, so the last-owner guard is not in the way).
  const { data: accounts } = await admin.rpc("due_account_deletions");
  for (const row of (accounts ?? []) as Array<{ user_id: string }>) {
    const { error } = await admin.auth.admin.deleteUser(row.user_id);
    if (error) summary.failures += 1;
    else summary.accounts += 1;
  }

  // 3. Retention: requests that never completed and were idle for 90 days.
  const { data: stale } = await admin.rpc("stale_requests");
  const staleRows = (stale ?? []) as Array<{ request_id: string; paths: string[] }>;
  if (staleRows.length > 0) {
    try {
      await removeFiles(admin, "uploads", staleRows.flatMap((r) => r.paths ?? []));
      const { data: purged, error } = await admin.rpc("purge_requests", { ids: staleRows.map((r) => r.request_id) });
      if (error) throw new Error("purge failed");
      summary.staleRequests += Number(purged ?? 0);
    } catch {
      summary.failures += 1;
    }
  }
  return summary;
}
