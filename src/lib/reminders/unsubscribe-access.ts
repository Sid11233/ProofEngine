import "server-only";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { unsubscribeSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyUnsubscribe, describeUnsubscribe, type UnsubscribeInfo } from "./unsubscribe-core";

const limiter = createRateLimiter({ prefix: "unsubscribe:ip", limit: 30, windowSec: 60 });

/** Token-authenticated: the only reason this file uses the service role. */
export async function lookupUnsubscribe(token: string): Promise<UnsubscribeInfo | { ok: false; limited: true }> {
  if (!(await limiter.limit(sha256Hex(getClientIp(await headers())))).success) return { ok: false, limited: true };
  return describeUnsubscribe(createAdminClient(), unsubscribeSecret(serverEnv), token);
}

export async function confirmUnsubscribe(token: string): Promise<"done" | "invalid" | "limited"> {
  if (!(await limiter.limit(sha256Hex(getClientIp(await headers())))).success) return "limited";
  return (await applyUnsubscribe(createAdminClient(), unsubscribeSecret(serverEnv), token)) ? "done" : "invalid";
}
