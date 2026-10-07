import "server-only";
import { NextResponse } from "next/server";
import { leadSchema } from "@/lib/demos/public-schemas";
import { loadPublicDemo } from "@/lib/demos/public";
import { saveDemoLead } from "@/lib/demos/public-service";
import { getClientIp } from "@/lib/security/client-ip";
import { readLimited } from "@/lib/security/body";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

// The demo lead form. A visitor gives an email and ticks a consent box; nothing is stored without both. Public, so:
// same-site only, strict body, honeypot, and two rate limits (per address, per demo). Never logs the email.
const perIp = createRateLimiter({ prefix: "demo-lead:ip", limit: 10, windowSec: 60 * 60 });
const perDemo = createRateLimiter({ prefix: "demo-lead:demo", limit: 300, windowSec: 24 * 60 * 60 });
const json = (body: unknown, status: number, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(request: Request, { params }: { params: Promise<{ workspace: string; slug: string }> }) {
  const { workspace, slug } = await params;
  if (!sameSite(request)) return json({ error: "forbidden" }, 403);
  if (!(await perIp.limit(sha256Hex(getClientIp(request.headers)))).success) return json({ error: "rate_limited" }, 429, { "Retry-After": "600" });
  const bytes = await readLimited(request, 4096);
  if (!bytes) return json({ error: "too_large" }, 413);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: "invalid" }, 400); }
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const demo = await loadPublicDemo(createPublicClient(), workspace, slug);
  // A demo that does not ask for emails collects none, even if someone posts to this address.
  if (!demo || demo.settings.lead_gate === "none") return json({ ok: true }, 200);
  if (!(await perDemo.limit(demo.id)).success) return json({ error: "rate_limited" }, 429, { "Retry-After": "3600" });
  const saved = await saveDemoLead(createAdminClient(), demo.id, parsed.data).catch(() => false);
  return saved ? json({ ok: true }, 200) : json({ error: "failed" }, 500);
}
