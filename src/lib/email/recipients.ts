import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Emails of a workspace's owners and admins, for alerts (a referral arrived, a page was reported).
 * Server only: it reads profiles with the service role, so callers must already be on a trusted path.
 */
export async function workspaceAlertAddresses(admin: SupabaseClient, workspaceId: string): Promise<string[]> {
  const { data: members } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).in("role", ["owner", "admin"]);
  const ids = (members ?? []).map((m) => String(m.user_id));
  if (ids.length === 0) return [];
  const { data: profiles } = await admin.from("profiles").select("email").in("id", ids);
  return [...new Set((profiles ?? []).map((p) => String(p.email ?? "")).filter((e) => e.includes("@")))];
}
