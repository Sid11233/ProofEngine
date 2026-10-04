"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { checkRecentAuth, REAUTH_MESSAGE, type ReauthNeeded } from "@/lib/auth/recent-auth";
import { requireUser } from "@/lib/auth/session";
import { getEmailSender } from "@/lib/email/resend";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspace/current";
import { fieldErrorsOf, formDataToObject, type FieldErrors } from "@/lib/validation/form";
import { changeRoleSchema, inviteSchema, removeMemberSchema, revokeInviteSchema } from "@/lib/team/schemas";
import * as team from "@/lib/team/service";

export interface TeamActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  reauth?: ReauthNeeded;
  /** Shown once to the admin, in case the email does not arrive. */
  inviteLink?: string;
}

const FORBIDDEN: TeamActionResult = { ok: false, message: team.TEAM_ERROR_MESSAGES.forbidden };

/** Authenticates, loads the caller's workspace from the server (never from the request) and checks the minimum role. */
async function authorise(minimum: "admin" | "member"): Promise<{ workspace: CurrentWorkspace; userId: string } | null> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return null;
  if (minimum === "admin" && workspace.role !== "owner" && workspace.role !== "admin") return null;
  return { workspace, userId: user.id };
}

async function throttled(action: "team-invite" | "team-manage", userId: string): Promise<boolean> {
  const ip = getClientIp(await headers());
  return !(await isAuthAttemptAllowed(action, { ip, subject: userId }));
}

const fail = (error: team.TeamError): TeamActionResult => ({ ok: false, message: team.TEAM_ERROR_MESSAGES[error] });

export async function inviteMemberAction(_prev: TeamActionResult, formData: FormData): Promise<TeamActionResult> {
  const auth = await authorise("admin");
  if (!auth) return FORBIDDEN;

  const parsed = inviteSchema.safeParse(formDataToObject(formData, ["email", "role"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  if (await throttled("team-invite", auth.userId)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const result = await team.inviteMember(
    await createClient(),
    { workspaceId: auth.workspace.id, workspaceName: auth.workspace.name, ...parsed.data },
    { appUrl: publicEnv.NEXT_PUBLIC_APP_URL, sender: getEmailSender() },
  );
  if (!result.ok) return fail(result.error);

  revalidatePath("/app/settings/team");
  return {
    ok: true,
    inviteLink: result.link,
    message: result.emailSent
      ? "Invitation sent. You can also share the link below."
      : "Invitation created. Email is not configured or failed, so share this link yourself.",
  };
}

export async function revokeInviteAction(inviteId: string): Promise<TeamActionResult> {
  const auth = await authorise("admin");
  if (!auth) return FORBIDDEN;
  const parsed = revokeInviteSchema.safeParse({ inviteId });
  if (!parsed.success) return fail("invalid");
  if (await throttled("team-manage", auth.userId)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const result = await team.revokeInvite(await createClient(), parsed.data.inviteId);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/settings/team");
  return { ok: true, message: "Invitation revoked." };
}

export async function changeRoleAction(userId: string, role: string): Promise<TeamActionResult> {
  const auth = await authorise("admin");
  if (!auth) return FORBIDDEN;
  const parsed = changeRoleSchema.safeParse({ userId, role });
  if (!parsed.success) return fail("invalid");
  if (parsed.data.userId === auth.userId) return { ok: false, message: "You cannot change your own role." };
  if (await throttled("team-manage", auth.userId)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  // Handing out or taking away ownership is as sensitive as removing someone.
  if (parsed.data.role === "owner") {
    const reauth = await checkRecentAuth();
    if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  }

  const result = await team.changeMemberRole(await createClient(), auth.workspace.id, parsed.data.userId, parsed.data.role);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/settings/team");
  return { ok: true, message: "Role updated." };
}

export async function removeMemberAction(userId: string): Promise<TeamActionResult> {
  const auth = await authorise("member");
  if (!auth) return FORBIDDEN;
  const parsed = removeMemberSchema.safeParse({ userId });
  if (!parsed.success) return fail("invalid");
  const leaving = parsed.data.userId === auth.userId;
  // Only admin+ may remove other people; anyone may remove themselves.
  if (!leaving && auth.workspace.role !== "owner" && auth.workspace.role !== "admin") return FORBIDDEN;
  if (await throttled("team-manage", auth.userId)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  // Removing a member is a sensitive action: recent sign-in required.
  if (!leaving) {
    const reauth = await checkRecentAuth();
    if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  }

  const result = await team.removeMember(await createClient(), auth.workspace.id, parsed.data.userId);
  if (!result.ok) return fail(result.error);
  if (leaving) redirect("/app/dashboard");
  revalidatePath("/app/settings/team");
  return { ok: true, message: "Member removed." };
}
