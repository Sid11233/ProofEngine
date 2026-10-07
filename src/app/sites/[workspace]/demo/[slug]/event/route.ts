import "server-only";
import { NextResponse } from "next/server";
import { createDeduper } from "@/lib/analytics/dedupe";
import { demoEventSchema } from "@/lib/demos/public-schemas";
import { loadPublicDemo } from "@/lib/demos/public";
import { recordDemoEvent } from "@/lib/demos/public-service";
import { getClientIp } from "@/lib/security/client-ip";
import { readLimited } from "@/lib/security/body";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

// Demo analytics: public, same-site only, tiny strict body, rate limited. Stores (type, step, time) and nothing
// about the visitor. The IP and user agent only feed an in-memory, daily-rotating de-duplication key.
const limiter = createRateLimiter({ prefix: "demo-events:ip", limit: 120, windowSec: 60 });
const deduper = createDeduper();
const empty = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request, { params }: { params: Promise<{ workspace: string; slug: string }> }) {
  const { workspace, slug } = await params;
  if (!sameSite(request)) return empty(403);
  const ip = getClientIp(request.headers);
  if (!(await limiter.limit(sha256Hex(ip))).success) return empty(429);
  const bytes = await readLimited(request, 512);
  if (!bytes) return empty(413);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return empty(400); }
  const parsed = demoEventSchema.safeParse(body);
  if (!parsed.success) return empty(400);

  // Always 204 from here: no oracle for which demos exist. Repeats from the same visitor today are not stored.
  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  const page = `${workspace}/${slug}/${parsed.data.step ?? ""}`;
  if (demo && deduper.firstTime({ ip, userAgent: request.headers.get("user-agent") ?? "", page, type: parsed.data.type })) {
    await recordDemoEvent(createAdminClient(), demo.id, parsed.data).catch(() => false);
  }
  return empty(204);
}
