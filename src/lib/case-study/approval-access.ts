import "server-only";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { hashIp, ipHashSecret } from "@/lib/security/ip-hash";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createApprovalResolver, decisionSchema, recordDecision, type ApprovalResult, type DecisionResult } from "./approval-access-core";

let resolver: ReturnType<typeof createApprovalResolver> | undefined;
let decisionLimiter: ReturnType<typeof createRateLimiter> | undefined;

/** Token-authenticated: the only reason this file may use the service role. 30 requests per minute per IP, 60 per token. */
export async function resolveApproval(rawToken: string): Promise<ApprovalResult> {
  resolver ??= createApprovalResolver({
    admin: createAdminClient(),
    ipLimiter: createRateLimiter({ prefix: "approve:ip", limit: 30, windowSec: 60 }),
    tokenLimiter: createRateLimiter({ prefix: "approve:token", limit: 60, windowSec: 60 }),
  });
  return resolver(rawToken, { ip: sha256Hex(getClientIp(await headers())) });
}

/** Validates the decision strictly, rate limits, then lets the database consume the token. */
export async function submitDecision(rawToken: string, input: unknown): Promise<DecisionResult | { ok: false; reason: "rate_limited" | "bad_input" }> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "bad_input" };
  const ip = getClientIp(await headers());
  decisionLimiter ??= createRateLimiter({ prefix: "approve:decide", limit: 10, windowSec: 600 });
  if (!(await decisionLimiter.limit(sha256Hex(ip))).success) return { ok: false, reason: "rate_limited" };
  return recordDecision(createAdminClient(), rawToken, parsed.data, hashIp(ipHashSecret(serverEnv), ip));
}
