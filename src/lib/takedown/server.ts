import "server-only";
import { headers } from "next/headers";
import { getEmailSender } from "@/lib/email/resend";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { parsePlatformAdmins } from "@/lib/security/env-schema";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { hashIp, ipHashSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportSchema } from "./schemas";
import { submitReport } from "./service";

export type ReportResult = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const perIp = createRateLimiter({ prefix: "takedown:ip", limit: 5, windowSec: 60 * 60 });
const perPage = createRateLimiter({ prefix: "takedown:page", limit: 20, windowSec: 24 * 60 * 60 });

/** Public, unauthenticated, insert-only. Rate limited per IP and per page; Turnstile when configured. */
export async function handleReport(input: unknown): Promise<ReportResult> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "Please check what you entered.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), [i.message]])) };
  }
  const ip = getClientIp(await headers());
  if (!(await perIp.limit(sha256Hex(ip))).success || !(await perPage.limit(`${parsed.data.workspace}/${parsed.data.slug}`)).success) {
    return { ok: false, message: "Too many reports. Please try again later." };
  }
  if (serverEnv.TURNSTILE_SECRET_KEY && !(await verifyTurnstile({ secret: serverEnv.TURNSTILE_SECRET_KEY, token: parsed.data.turnstileToken, ip }))) {
    return { ok: false, message: "We could not verify you are human. Please try again." };
  }

  const outcome = await submitReport(
    { admin: createAdminClient(), sender: getEmailSender(), platformAdmins: parsePlatformAdmins(serverEnv.PLATFORM_ADMIN_EMAILS) ?? [], appUrl: publicEnv.NEXT_PUBLIC_APP_URL },
    parsed.data,
    hashIp(ipHashSecret(serverEnv), ip),
  );
  if (outcome.ok) return { ok: true };
  // The same words whether the page does not exist or this person already reported it.
  return outcome.reason === "failed" ? { ok: false, message: "Something went wrong. Please try again." } : { ok: true };
}
