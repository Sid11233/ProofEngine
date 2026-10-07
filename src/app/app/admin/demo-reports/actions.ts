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

export interface DemoReportActionResult {
  ok: boolean;
  message?: string;
  reauth?: ReauthNeeded;
}

const idSchema = z.uuid();

// Service role, after the PLATFORM_ADMIN_EMAILS check and a recent sign-in, on every call.
async function guard(): Promise<DemoReportActionResult | { userId: string }> {
  const user = await requirePlatformAdmin();
  if (!(await isAuthAttemptAllowed("request-manage", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };
  const reauth = await checkRecentAuth();
  if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  return { userId: user.id };
}

export async function blockDemoAction(demoId: string, block: boolean): Promise<DemoReportActionResult> {
  const g = await guard();
  if (!("userId" in g)) return g;
  const id = idSchema.safeParse(demoId);
  if (!id.success || typeof block !== "boolean") return { ok: false, message: "That demo was not found." };
  const { error } = await createAdminClient().rpc("set_demo_blocked", { demo: id.data, blocked: block });
  if (error) return { ok: false, message: "We could not change that demo." };
  revalidatePath("/app/admin/demo-reports");
  return { ok: true, message: block ? "Demo blocked. It is offline and its workspace cannot publish it." : "Demo unblocked. It is unpublished; the workspace can publish it again." };
}

export async function resolveDemoReportAction(reportId: string, status: string): Promise<DemoReportActionResult> {
  const g = await guard();
  if (!("userId" in g)) return g;
  const parsed = z.object({ id: idSchema, status: z.enum(["actioned", "dismissed", "open"]) }).strict().safeParse({ id: reportId, status });
  if (!parsed.success) return { ok: false, message: "That report was not found." };
  const { data, error } = await createAdminClient().from("demo_reports").update({ status: parsed.data.status }).eq("id", parsed.data.id).select("id");
  if (error || !data?.length) return { ok: false, message: "We could not update that report." };
  revalidatePath("/app/admin/demo-reports");
  return { ok: true, message: "Report updated." };
}
