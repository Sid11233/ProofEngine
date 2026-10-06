import "server-only";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { removalSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmRemoval, describeRemoval, type RemovalInfo } from "./removal-core";

const limiter = createRateLimiter({ prefix: "removal:ip", limit: 20, windowSec: 60 });

/** Token-authenticated: the only reason this file uses the service role. */
export async function lookupRemoval(token: string): Promise<RemovalInfo | { ok: false; limited: true }> {
  if (!(await limiter.limit(sha256Hex(getClientIp(await headers())))).success) return { ok: false, limited: true };
  return describeRemoval(createAdminClient(), removalSecret(serverEnv), token);
}

export async function performRemoval(token: string): Promise<"done" | "invalid" | "limited"> {
  if (!(await limiter.limit(sha256Hex(getClientIp(await headers())))).success) return "limited";
  try {
    return (await confirmRemoval(createAdminClient(), removalSecret(serverEnv), token)) ? "done" : "invalid";
  } catch {
    return "invalid";
  }
}
