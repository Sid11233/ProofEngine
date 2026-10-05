import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceAlertAddresses } from "@/lib/email/recipients";
import type { EmailSender } from "@/lib/email/types";
import type { ReferralInput } from "./schemas";

// Tell the workspace owners and admins that a client suggested someone. The referred person is never
// emailed: only the people who run the workspace hear about it, and decide what to do.

export function referralEmail({ workspaceName, referrals, link }: { workspaceName: string; referrals: ReferralInput[]; link: string }) {
  const lines = referrals.map((r, i) => `${i + 1}. ${r.name} (${r.contact})`);
  return {
    subject: referrals.length === 1 ? `A client referred someone to ${workspaceName}` : `A client referred ${referrals.length} people to ${workspaceName}`,
    text: [
      "One of your clients finished their interview and suggested:",
      "",
      ...lines,
      "",
      "We have not contacted them. Follow up yourself, then update the status here:",
      link,
    ].join("\n"),
  };
}

export async function notifyReferrals(
  ctx: { admin: SupabaseClient; sender: EmailSender | null; appUrl: string },
  workspaceId: string,
  referrals: ReferralInput[],
): Promise<number> {
  if (!ctx.sender || referrals.length === 0) return 0;
  const [recipients, { data: ws }] = await Promise.all([
    workspaceAlertAddresses(ctx.admin, workspaceId),
    ctx.admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);
  const message = referralEmail({ workspaceName: String(ws?.name ?? "your workspace"), referrals, link: new URL("/app/referrals", ctx.appUrl).toString() });
  let sent = 0;
  for (const to of recipients) if (await ctx.sender.send({ to, ...message })) sent += 1;
  return sent;
}
