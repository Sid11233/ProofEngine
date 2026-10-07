"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

/** Admins and owners remove a lead (for example when the person asks). Row level security allows only admins; this checks first. */
export async function deleteLeadAction(demoId: string, leadId: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || (workspace.role !== "owner" && workspace.role !== "admin")) return { ok: false, message: "Only admins can delete leads." };
  const ids = z.object({ demo: z.uuid(), lead: z.uuid() }).strict().safeParse({ demo: demoId, lead: leadId });
  if (!ids.success) return { ok: false, message: "That lead was not found." };
  if (!(await isAuthAttemptAllowed("demo-edit", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };
  const { data, error } = await (await createClient()).from("demo_leads").delete().eq("id", ids.data.lead).eq("demo_id", ids.data.demo).select("id");
  if (error || !data?.length) return { ok: false, message: "We could not delete that lead." };
  revalidatePath(`/app/demos/${ids.data.demo}/results`);
  return { ok: true };
}
