"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { referralStatusSchema } from "@/lib/referrals/schemas";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface ReferralActionResult {
  ok: boolean;
  message?: string;
}

/** Editor and above. The database (column grant + RLS) is the final check on workspace and role. */
export async function setReferralStatusAction(id: string, status: string): Promise<ReferralActionResult> {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return { ok: false, message: "You do not have permission to do that." };
  if (!(await isAuthAttemptAllowed("request-manage", { ip: getClientIp(await headers()), subject: user.id }))) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const parsed = referralStatusSchema.safeParse({ id, status });
  if (!parsed.success) return { ok: false, message: "That is not a valid status." };

  const { data, error } = await (await createClient())
    .from("referrals")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspace.id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "We could not update that referral." };
  revalidatePath("/app/referrals");
  return { ok: true };
}
