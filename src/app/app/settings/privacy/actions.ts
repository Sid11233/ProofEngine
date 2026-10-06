"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { checkRecentAuth, REAUTH_MESSAGE, type ReauthNeeded } from "@/lib/auth/recent-auth";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface PrivacyActionResult {
  ok: boolean;
  message?: string;
  reauth?: ReauthNeeded;
  /** When the deletion will happen (ISO date), for requests. */
  scheduledFor?: string;
}

const MESSAGES: Record<string, string> = {
  subscription_active: "Cancel your subscription first (Billing, Manage billing), then request deletion. Nobody should be billed for a workspace that is about to disappear.",
  transfer_ownership: "You are the only owner of a workspace that has other members. Make someone else an owner (Team), or remove the other members, first.",
};

const reasonOf = (message: string | undefined) => Object.keys(MESSAGES).find((k) => message?.includes(k));

type Guard = { error: PrivacyActionResult; workspace?: undefined } | { workspace: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>>; error?: undefined };

async function guard(role?: "owner"): Promise<Guard> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || (role === "owner" && workspace.role !== "owner")) return { error: { ok: false, message: "Only the workspace owner can do that." } };
  if (!(await isAuthAttemptAllowed("privacy", { ip: getClientIp(await headers()), subject: user.id }))) return { error: { ok: false, message: RATE_LIMITED_MESSAGE } };
  const reauth = await checkRecentAuth();
  if (reauth) return { error: { ok: false, reauth, message: REAUTH_MESSAGE } };
  return { workspace };
}

const confirmSchema = z.object({ confirm: z.string().max(200) }).strict();

export async function requestWorkspaceDeletionAction(input: unknown): Promise<PrivacyActionResult> {
  const g = await guard("owner");
  if (g.error) return g.error;
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirm.trim() !== g.workspace.name) return { ok: false, message: "Type the workspace name exactly to confirm." };
  const { data, error } = await (await createClient()).rpc("request_workspace_deletion", { ws: g.workspace.id });
  if (error) return { ok: false, message: MESSAGES[reasonOf(error.message) ?? ""] ?? "We could not schedule the deletion." };
  revalidatePath("/app", "layout");
  return { ok: true, scheduledFor: String(data).slice(0, 10) };
}

export async function cancelWorkspaceDeletionAction(): Promise<PrivacyActionResult> {
  const g = await guard("owner");
  if (g.error) return g.error;
  const { error } = await (await createClient()).rpc("cancel_workspace_deletion", { ws: g.workspace.id });
  if (error) return { ok: false, message: "We could not cancel the deletion." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Deletion cancelled. Links that were revoked stay revoked; create new ones when you need them." };
}

export async function requestAccountDeletionAction(input: unknown): Promise<PrivacyActionResult> {
  const g = await guard();
  if (g.error) return g.error;
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirm.trim() !== "DELETE") return { ok: false, message: "Type DELETE to confirm." };
  const { data, error } = await (await createClient()).rpc("request_account_deletion");
  if (error) return { ok: false, message: MESSAGES[reasonOf(error.message) ?? ""] ?? "We could not schedule the deletion." };
  revalidatePath("/app", "layout");
  return { ok: true, scheduledFor: String(data).slice(0, 10) };
}

export async function cancelAccountDeletionAction(): Promise<PrivacyActionResult> {
  const g = await guard();
  if (g.error) return g.error;
  const { error } = await (await createClient()).rpc("cancel_account_deletion");
  if (error) return { ok: false, message: "We could not cancel the deletion." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Deletion cancelled." };
}
