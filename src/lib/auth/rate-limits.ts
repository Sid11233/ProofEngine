import "server-only";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/hash";

export type AuthAction = "login" | "signup" | "reset" | "mfa";

// 5 attempts per 15 minutes per email, 20 per hour per IP (Prompt 2.1).
const EMAIL_LIMIT = { limit: 5, windowSec: 15 * 60 };
const IP_LIMIT = { limit: 20, windowSec: 60 * 60 };

const limiters = new Map<AuthAction, { byEmail: RateLimiter; byIp: RateLimiter }>();

function limitersFor(action: AuthAction) {
  let entry = limiters.get(action);
  if (!entry) {
    entry = {
      byEmail: createRateLimiter({ prefix: `auth:${action}:email`, ...EMAIL_LIMIT }),
      byIp: createRateLimiter({ prefix: `auth:${action}:ip`, ...IP_LIMIT }),
    };
    limiters.set(action, entry);
  }
  return entry;
}

/**
 * Counts one attempt against both the IP and the email (or user id) and says
 * whether it may proceed. Identifiers are hashed so no email or IP is stored in Redis.
 */
export async function isAuthAttemptAllowed(
  action: AuthAction,
  { ip, subject }: { ip: string; subject: string },
): Promise<boolean> {
  const { byEmail, byIp } = limitersFor(action);
  const [ipResult, subjectResult] = await Promise.all([
    byIp.limit(sha256Hex(ip)),
    byEmail.limit(sha256Hex(subject.toLowerCase())),
  ]);
  return ipResult.success && subjectResult.success;
}

const ipOnly = new Map<string, RateLimiter>();

/** IP-only check, for flows that have no email yet (e.g. starting Google sign-in). */
export async function isIpAttemptAllowed(action: string, ip: string): Promise<boolean> {
  let limiter = ipOnly.get(action);
  if (!limiter) {
    limiter = createRateLimiter({ prefix: `auth:${action}:ip`, ...IP_LIMIT });
    ipOnly.set(action, limiter);
  }
  return (await limiter.limit(sha256Hex(ip))).success;
}

export const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";
