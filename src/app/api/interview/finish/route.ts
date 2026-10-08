import "server-only";
import { after } from "next/server";
import { getEmailSender } from "@/lib/email/resend";
import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { finishInterview } from "@/lib/interview/finish";
import { finishSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps } from "@/lib/interview/server";
import { pushToWorkspace } from "@/lib/push/server";
import { notifyInterviewFinished } from "@/lib/interview/notify";
import { notifyReferrals } from "@/lib/referrals/notify";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { unsubscribeSecret } from "@/lib/security/ip-hash";
import { unsubscribeToken } from "@/lib/security/unsubscribe";

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
  const secret = unsubscribeSecret(serverEnv);
  await notifyInterviewFinished(
    { admin, sender: getEmailSender(), appUrl: publicEnv.NEXT_PUBLIC_APP_URL, unsubscribeUrl: (id) => new URL(`/unsubscribe/${unsubscribeToken(secret, id)}`, publicEnv.NEXT_PUBLIC_APP_URL).toString() },
    guarded.access,
    guarded.body.closing?.rating,
  ).catch(() => undefined);
  // Generic push notifications (only to members who switched them on), after the response is sent.
  const workspaceId = guarded.access.workspaceId;
  const hasReferrals = guarded.body.referrals.length > 0;
  after(async () => {
    await pushToWorkspace(workspaceId, "client_completed").catch(() => undefined);
    if (hasReferrals) await pushToWorkspace(workspaceId, "referral_received").catch(() => undefined);
  });
  return json({ ok: true });
}
