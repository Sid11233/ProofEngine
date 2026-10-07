"use server";

import "server-only";
import { headers } from "next/headers";
import { loadPublicDemo } from "@/lib/demos/public";
import { saveDemoReport } from "@/lib/demos/public-service";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { reportSchema } from "@/lib/takedown/schemas";

const perIp = createRateLimiter({ prefix: "demo-report:ip", limit: 5, windowSec: 60 * 60 });
const perDemo = createRateLimiter({ prefix: "demo-report:demo", limit: 20, windowSec: 24 * 60 * 60 });

/** Public and insert-only. A report never removes a demo by itself; the platform team reviews it. */
export async function reportDemoAction(input: unknown): Promise<{ ok: boolean; message?: string }> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check what you entered." };
  const ip = getClientIp(await headers());
  if (!(await perIp.limit(sha256Hex(ip))).success || !(await perDemo.limit(`${parsed.data.workspace}/${parsed.data.slug}`)).success) return { ok: false, message: "Too many reports. Please try again later." };
  if (serverEnv.TURNSTILE_SECRET_KEY && !(await verifyTurnstile({ secret: serverEnv.TURNSTILE_SECRET_KEY, token: parsed.data.turnstileToken, ip }))) return { ok: false, message: "We could not verify you are human. Please try again." };

  const demo = await loadPublicDemo(createPublicClient(), parsed.data.workspace, parsed.data.slug);
  // The same answer whether or not the demo exists.
  if (demo) await saveDemoReport(createAdminClient(), demo.id, { reason: parsed.data.reason, email: parsed.data.email }).catch(() => false);
  return { ok: true };
}
