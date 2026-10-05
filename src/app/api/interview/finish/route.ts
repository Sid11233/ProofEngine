import { getEmailSender } from "@/lib/email/resend";
import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { finishInterview } from "@/lib/interview/finish";
import { finishSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps } from "@/lib/interview/server";
import { notifyReferrals } from "@/lib/referrals/notify";
import { publicEnv } from "@/lib/security/env.public";

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, finishSchema);
  if (!guarded.ok) return guarded.response;

  const { admin } = getInterviewerDeps();
  const result = await finishInterview(admin, guarded.access, guarded.body);
  if (!result.ok) return json({ error: result.error }, result.error === "failed" ? 500 : 409);

  // Best effort: the interview is already finished, so an email problem never fails the client's request.
  if (guarded.body.referrals.length > 0) {
    await notifyReferrals({ admin, sender: getEmailSender(), appUrl: publicEnv.NEXT_PUBLIC_APP_URL }, guarded.access.workspaceId, guarded.body.referrals).catch(() => 0);
  }
  return json({ ok: true });
}
