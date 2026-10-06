import "server-only";
import { cookies, headers } from "next/headers";
import { getEmailSender } from "@/lib/email/resend";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { hashIp, ipHashSecret, removalSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { removalToken } from "@/lib/security/removal";
import { publicEnv } from "@/lib/security/env.public";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSigningService, type Ctx } from "./access-core";

// Token-authenticated: the signing endpoints are why this file may use the service role (see CLAUDE.md).

let service: ReturnType<typeof createSigningService> | undefined;

export function signingService() {
  const evidenceKey = ipHashSecret(serverEnv);
  service ??= createSigningService({
    admin: createAdminClient(),
    codeSecret: removalSecret(serverEnv),
    hashEvidence: (kind, value) => hashIp(`${evidenceKey}:${kind}`, value),
    sender: getEmailSender(),
    limiters: {
      ip: createRateLimiter({ prefix: "sign:ip", limit: 60, windowSec: 600 }),
      token: createRateLimiter({ prefix: "sign:token", limit: 120, windowSec: 600 }),
      // Code requests and checks: 15 per ten minutes per link on top of the database's own 5 tries per code and 3 codes an hour.
      code: createRateLimiter({ prefix: "sign:code", limit: 15, windowSec: 600 }),
    },
    removalUrl: (caseStudyId) => new URL(`/remove/${removalToken(removalSecret(serverEnv), caseStudyId)}`, publicEnv.NEXT_PUBLIC_APP_URL).toString(),
  });
  return service;
}

export async function requestContext(): Promise<Ctx> {
  const h = await headers();
  return { ip: getClientIp(h), userAgent: (h.get("user-agent") ?? "").slice(0, 300) };
}

const cookieName = (rawToken: string) => `pe_sign_${rawToken.slice(0, 12)}`;

export async function readSession(rawToken: string): Promise<string | undefined> {
  return (await cookies()).get(cookieName(rawToken))?.value;
}

/** The browser's proof that the code was entered: HttpOnly, this path only, 30 minutes. */
export async function writeSession(rawToken: string, session: string): Promise<void> {
  (await cookies()).set(cookieName(rawToken), session, {
    httpOnly: true,
    secure: publicEnv.NEXT_PUBLIC_APP_URL.startsWith("https"),
    sameSite: "strict",
    path: "/sign",
    maxAge: 30 * 60,
  });
}
