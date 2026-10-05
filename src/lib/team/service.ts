import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/email/types";
import { generateToken, hashToken, isWellFormedToken } from "@/lib/security/tokens";
import type { InviteRole, MemberRole } from "./schemas";
import { brand } from "@/lib/brand";

// Team operations over the caller's own Supabase client, so the database (RLS and
// the SECURITY DEFINER functions) is always the final judge. The application layer
// only translates errors into messages. Audit logging happens inside those functions.

export type TeamError = "forbidden" | "conflict" | "limit" | "not_found" | "invalid" | "failed";

export interface Teammate {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: MemberRole;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: InviteRole;
  expiresAt: string;
}

export function classify(error: Pick<PostgrestError, "code">): TeamError {
  switch (error.code) {
    case "42501":
    case "28000":
      return "forbidden";
    case "23505":
      return "conflict";
    case "54000":
      return "limit";
    case "P0002":
      return "not_found";
    case "22023":
    case "23514":
      return "invalid";
    default:
      return "failed";
  }
}

export const TEAM_ERROR_MESSAGES: Record<TeamError, string> = {
  forbidden: "You do not have permission to do that.",
  conflict: "That person is already on the team or has a pending invitation.",
  limit: "You have too many pending invitations. Revoke some first.",
  not_found: "That could not be found. It may have been removed already.",
  invalid: "That request is not valid.",
  failed: "Something went wrong. Please try again.",
};

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error: TeamError };

export interface InviteResult {
  /** The invite link. The raw token exists only in this value and in the email. */
  link: string;
  emailSent: boolean;
}

export function buildInviteLink(appUrl: string, rawToken: string): string {
  return new URL(`/invite/${rawToken}`, appUrl).toString();
}

export async function inviteMember(
  supabase: SupabaseClient,
  input: { workspaceId: string; workspaceName: string; email: string; role: InviteRole },
  deps: { appUrl: string; sender: EmailSender | null },
): Promise<Outcome<InviteResult>> {
  const token = generateToken();
  const { error } = await supabase.rpc("create_invite", {
    ws: input.workspaceId,
    invite_email: input.email,
    invite_role: input.role,
    hash: token.hash,
  });
  if (error) return { ok: false, error: classify(error) };

  const link = buildInviteLink(deps.appUrl, token.raw);
  const emailSent =
    (await deps.sender?.send({
      to: input.email,
      subject: `You have been invited to ${input.workspaceName} on ${brand.name}`,
      text: [
        `You have been invited to join ${input.workspaceName} on ${brand.name} as ${input.role}.`,
        "",
        "Accept the invitation (sign in or create an account with this email address):",
        link,
        "",
        "The link works once and expires in 7 days. If you were not expecting this, ignore this email.",
      ].join("\n"),
    })) ?? false;

  return { ok: true, link, emailSent };
}

export async function revokeInvite(supabase: SupabaseClient, inviteId: string): Promise<Outcome> {
  const { error } = await supabase.rpc("revoke_invite", { invite_id: inviteId });
  return error ? { ok: false, error: classify(error) } : { ok: true };
}

export async function changeMemberRole(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<Outcome> {
  const { error } = await supabase.rpc("change_member_role", { ws: workspaceId, member: userId, new_role: role });
  return error ? { ok: false, error: classify(error) } : { ok: true };
}

export async function removeMember(supabase: SupabaseClient, workspaceId: string, userId: string): Promise<Outcome> {
  const { error } = await supabase.rpc("remove_member", { ws: workspaceId, member: userId });
  return error ? { ok: false, error: classify(error) } : { ok: true };
}

export async function listTeam(supabase: SupabaseClient, workspaceId: string): Promise<Teammate[]> {
  const { data, error } = await supabase.rpc("list_team_members", { ws: workspaceId });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => ({
    userId: String(row.user_id),
    email: typeof row.email === "string" ? row.email : null,
    fullName: typeof row.full_name === "string" ? row.full_name : null,
    role: row.role as MemberRole,
    joinedAt: String(row.joined_at),
  }));
}

export async function listPendingInvites(supabase: SupabaseClient): Promise<PendingInvite[]> {
  // Explicit columns: token_hash is not granted, so `select *` would be refused.
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("id,email,role,expires_at")
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at }));
}

/** What the signed-in invitee sees before accepting. Null for anything invalid. */
export async function previewInvite(
  supabase: SupabaseClient,
  rawToken: string,
): Promise<{ workspaceName: string; role: InviteRole } | null> {
  if (!isWellFormedToken(rawToken)) return null;
  const { data, error } = await supabase.rpc("get_invite_preview", { hash: hashToken(rawToken) });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;
  return { workspaceName: String(row.workspace_name), role: row.role as InviteRole };
}

export async function acceptInvite(supabase: SupabaseClient, rawToken: string): Promise<boolean> {
  if (!isWellFormedToken(rawToken)) return false;
  const { error } = await supabase.rpc("accept_invite", { hash: hashToken(rawToken) });
  return !error;
}
