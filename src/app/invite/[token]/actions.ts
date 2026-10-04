"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthAttemptAllowed } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite } from "@/lib/team/service";

export async function acceptInviteAction(token: string): Promise<void> {
  const user = await requireUser();
  // Tokens are 256-bit, so guessing is hopeless; the limit just caps noise and abuse.
  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("invite-accept", { ip, subject: user.id }))) redirect(`/invite/${encodeURIComponent(token)}?error=rate`);

  const accepted = await acceptInvite(await createClient(), token);
  redirect(accepted ? "/app/dashboard" : `/invite/${encodeURIComponent(token)}?error=invalid`);
}
