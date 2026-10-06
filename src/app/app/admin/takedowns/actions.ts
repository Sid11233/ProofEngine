"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { checkRecentAuth, REAUTH_MESSAGE, type ReauthNeeded } from "@/lib/auth/recent-auth";
import { getClientIp } from "@/lib/security/client-ip";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/takedown/admin";

export interface TakedownActionResult {
  ok: boolean;
  message?: string;
  reauth?: ReauthNeeded;
}

const idSchema = z.uuid();

// These use the service role: platform operators act across workspaces, so no workspace role applies.
// Access is the PLATFORM_ADMIN_EMAILS list plus a recent sign-in, checked on every call.
async function guard(): Promise<TakedownActionResult | { userId: string }> {
  const user = await requirePlatformAdmin();
  if (!(await isAuthAttemptAllowed("request-manage", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };
  const reauth = await checkRecentAuth();
  if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  return { userId: user.id };
}

export async function setDisabledAction(studyId: string, disable: boolean): Promise<TakedownActionResult> {
  const g = await guard();
  if (!("userId" in g)) return g;
  const id = idSchema.safeParse(studyId);
  if (!id.success || typeof disable !== "boolean") return { ok: false, message: "That page was not found." };
  const { error } = await createAdminClient().rpc("set_case_study_disabled", { study: id.data, disable });
  if (error) return { ok: false, message: "We could not change that page." };
  revalidatePath("/app/admin/takedowns");
  return { ok: true, message: disable ? "Page disabled. It is no longer public and its workspace cannot publish it." : "Page restored. The workspace can publish it again." };
}

export async function resolveAction(requestId: string, status: string): Promise<TakedownActionResult> {
  const g = await guard();
  if (!("userId" in g)) return g;
  const parsed = z.object({ id: idSchema, status: z.enum(["reviewing", "actioned", "dismissed"]) }).strict().safeParse({ id: requestId, status });
  if (!parsed.success) return { ok: false, message: "That report was not found." };
  const { error } = await createAdminClient().rpc("resolve_takedown", { request: parsed.data.id, new_status: parsed.data.status });
  if (error) return { ok: false, message: "We could not update that report." };
  revalidatePath("/app/admin/takedowns");
  return { ok: true, message: "Report updated." };
}
