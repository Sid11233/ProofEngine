import "server-only";
import { getEmailSender } from "@/lib/email/resend";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { unsubscribeSecret } from "@/lib/security/ip-hash";
import { unsubscribeToken } from "@/lib/security/unsubscribe";
import type { Context } from "./service";

/** What request operations need from the server: the app URL, the sender, and the unsubscribe link builder. */
export function buildRequestContext(workspaceName: string, plan: string): Context {
  const secret = unsubscribeSecret(serverEnv);
  return {
    appUrl: publicEnv.NEXT_PUBLIC_APP_URL,
    workspaceName,
    plan,
    sender: getEmailSender(),
    unsubscribeUrl: (requestId) => new URL(`/unsubscribe/${unsubscribeToken(secret, requestId)}`, publicEnv.NEXT_PUBLIC_APP_URL).toString(),
  };
}
