import "server-only";
import { NextResponse } from "next/server";
import { runPurge } from "@/lib/privacy/purge";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { constantTimeEqualHex } from "@/lib/security/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily privacy job: workspaces and accounts whose 30 day grace period is over, and requests that never
// completed after 90 days. Bearer CRON_SECRET, otherwise 401. The answer is counts only.

const limiter = createRateLimiter({ prefix: "cron-purge:ip", limit: 20, windowSec: 60 });

function authorised(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  return constantTimeEqualHex(sha256Hex(header.slice(7)), sha256Hex(secret));
}

export async function GET(request: Request) {
  if (!(await limiter.limit(sha256Hex(getClientIp(request.headers)))).success) return new NextResponse(null, { status: 429 });
  if (!authorised(request)) return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const summary = await runPurge(createAdminClient());
  return NextResponse.json(summary, { status: summary.failures > 0 ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
