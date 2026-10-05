import { NextResponse } from "next/server";
import { getEmailSender } from "@/lib/email/resend";
import { runReminders } from "@/lib/reminders/run";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { unsubscribeSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { constantTimeEqualHex } from "@/lib/security/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>`. Anything else, including a missing
// CRON_SECRET (the job is simply off), is the same 401. Counts only in the answer: no names, emails or links.

const failures = createRateLimiter({ prefix: "cron:ip", limit: 20, windowSec: 60 });

function authorised(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  // Compare hashes so the comparison is constant-time and length-independent.
  return constantTimeEqualHex(sha256Hex(header.slice(7)), sha256Hex(secret));
}

export async function GET(request: Request) {
  if (!(await failures.limit(sha256Hex(getClientIp(request.headers)))).success) return new NextResponse(null, { status: 429 });
  if (!authorised(request)) return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });

  const summary = await runReminders({
    admin: createAdminClient(),
    sender: getEmailSender(),
    appUrl: publicEnv.NEXT_PUBLIC_APP_URL,
    unsubscribeSecret: unsubscribeSecret(serverEnv),
  });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
