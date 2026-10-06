import "server-only";
import { NextResponse } from "next/server";
import { createDeduper } from "@/lib/analytics/dedupe";
import { recordPageEvent } from "@/lib/analytics/record";
import { eventSchema } from "@/lib/analytics/schemas";
import { getClientIp } from "@/lib/security/client-ip";
import { readLimited } from "@/lib/security/body";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// Privacy-light analytics. Public and unauthenticated, so: same-origin only, tiny strict body, rate limited,
// and the only thing written is (type, page, referrer hostname, time) through a service-role-only function.
// The IP and user agent are used only to build an in-memory, daily-rotating de-duplication key.

const limiter = createRateLimiter({ prefix: "events:ip", limit: 60, windowSec: 60 });
const deduper = createDeduper();
const NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const empty = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/** The beacon is a same-origin fetch, so Origin must be this very site. */
function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ workspace: string; slug: string }> }) {
  const { workspace, slug } = await params;
  if (!NAME.test(workspace) || !NAME.test(slug)) return empty(404);
  if (!sameSite(request)) return empty(403);

  const ip = getClientIp(request.headers);
  if (!(await limiter.limit(sha256Hex(ip))).success) return empty(429);

  const bytes = await readLimited(request, 2048);
  if (!bytes) return empty(413);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return empty(400);
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return empty(400);

  // Repeats from the same visitor today are acknowledged but not stored. Always 204: no oracle for what exists.
  if (deduper.firstTime({ ip, userAgent: request.headers.get("user-agent") ?? "", page: `${workspace}/${slug}`, type: parsed.data.type })) {
    await recordPageEvent(createAdminClient(), workspace, slug, parsed.data).catch(() => false);
  }
  return empty(204);
}
