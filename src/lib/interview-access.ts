import "server-only";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/client-ip";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { signal } from "@/lib/monitoring/signals";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/security/hash";
import { createResolver, type ResolveResult } from "./interview-access-core";

export type { InterviewAccess, InterviewPublicView, InterviewQuestion, ResolveResult } from "./interview-access-core";

type Resolver = ReturnType<typeof createResolver>;
let resolver: Resolver | undefined;

function getResolver(): Resolver {
  resolver ??= createResolver({
    admin: createAdminClient(),
    // 30 requests per minute per IP, 60 per minute per token (Prompt 3.2).
    ipLimiter: createRateLimiter({ prefix: "interview:resolve:ip", limit: 30, windowSec: 60 }),
    tokenLimiter: createRateLimiter({ prefix: "interview:resolve:token", limit: 60, windowSec: 60 }),
  });
  return resolver;
}

/**
 * Every interview page and endpoint calls this first. Returns the minimal context
 * for one interview, or a generic "not found" for any bad link.
 */
export async function resolveInterview(rawToken: string): Promise<ResolveResult> {
  const ip = getClientIp(await headers());
  const result = await getResolver()(rawToken, { ip: sha256Hex(ip) });
  // A burst of unknown links is how link guessing looks from the server's side.
  if (!result.ok && result.reason === "not_found") signal("interview_token_miss");
  return result;
}
