import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyRemovalToken } from "@/lib/security/removal";
import { eraseStory } from "./erase";

// The client's "remove my story" link. The token proves we issued it for that case study; opening the page
// changes nothing, a separate confirming click deletes. Every bad link is the same "not found".

export type RemovalInfo = { ok: true; workspaceName: string } | { ok: false };

export async function describeRemoval(admin: SupabaseClient, secret: string, token: string): Promise<RemovalInfo> {
  const id = verifyRemovalToken(secret, token);
  if (!id) return { ok: false };
  const { data: study } = await admin.from("case_studies").select("workspace_id").eq("id", id).maybeSingle();
  if (!study) return { ok: false };
  const { data: ws } = await admin.from("workspaces").select("name").eq("id", study.workspace_id).maybeSingle();
  return { ok: true, workspaceName: String(ws?.name ?? "this company") };
}

export async function confirmRemoval(admin: SupabaseClient, secret: string, token: string): Promise<boolean> {
  const id = verifyRemovalToken(secret, token);
  if (!id) return false;
  return eraseStory(admin, id);
}
