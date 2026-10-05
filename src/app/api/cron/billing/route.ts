import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { constantTimeEqualHex } from "@/lib/security/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily: ends 7 day payment grace periods that ran out (Stripe sends no event when time passes).
// Same protection as the reminder job: Bearer CRON_SECRET, otherwise 401.

const limiter = createRateLimiter({ prefix: "cron-billing:ip", limit: 20, windowSec: 60 });

function authorised(request: Request): boolean {
  const secret = serverEnv.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  return constantTimeEqualHex(sha256Hex(header.slice(7)), sha256Hex(secret));
}

export async function GET(request: Request) {
  if (!(await limiter.limit(sha256Hex(getClientIp(request.headers)))).success) return new NextResponse(null, { status: 429 });
  if (!authorised(request)) return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await createAdminClient().rpc("expire_billing_grace");
  if (error) return NextResponse.json({ error: "failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ downgraded: Number(data ?? 0) }, { headers: { "Cache-Control": "no-store" } });
}
