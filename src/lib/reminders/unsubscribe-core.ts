import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/security/unsubscribe";

// The unsubscribe link in reminder emails. The token proves only that the link came from us; it grants
// "stop emailing about this request" and nothing else (no interview, no data). Every bad link is the same
// "not found", and marking a request twice is harmless.

export type UnsubscribeInfo = { ok: true; workspaceName: string; alreadyDone: boolean } | { ok: false };

export async function describeUnsubscribe(admin: SupabaseClient, secret: string, token: string): Promise<UnsubscribeInfo> {
  const id = verifyUnsubscribeToken(secret, token);
  if (!id) return { ok: false };
  const { data: req } = await admin.from("proof_requests").select("workspace_id, do_not_contact_at").eq("id", id).maybeSingle();
  if (!req) return { ok: false };
  const { data: ws } = await admin.from("workspaces").select("name").eq("id", req.workspace_id).maybeSingle();
  return { ok: true, workspaceName: String(ws?.name ?? "this sender"), alreadyDone: req.do_not_contact_at !== null };
}

export async function applyUnsubscribe(admin: SupabaseClient, secret: string, token: string): Promise<boolean> {
  const id = verifyUnsubscribeToken(secret, token);
  if (!id) return false;
  const { data, error } = await admin.rpc("mark_do_not_contact", { request_id: id });
  return !error && data === true;
}
