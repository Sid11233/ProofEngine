import "server-only";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { sha256Hex } from "@/lib/security/hash";

// Each code-entry step has its own bucket so one flow cannot exhaust another's attempts.
export type AuthAction =
  | "login"
  | "signup"
  | "reset"
  | "workspace"
  | "reauth"
  | "mfa-login"
  | "mfa-reauth"
  | "mfa-enroll"
  | "mfa-manage"
  | "team-invite"
  | "team-manage"
  | "invite-accept"
  | "request-manage"
  | "generate"
  | "case-study-edit";

interface Limit {
  limit: number;
  windowSec: number;
}

// Credential-style actions: 5 attempts per 15 minutes per email or user, 20 per hour per IP (Prompt 2.1).
const EMAIL_LIMIT: Limit = { limit: 5, windowSec: 15 * 60 };
const IP_LIMIT: Limit = { limit: 20, windowSec: 60 * 60 };

// Management actions are not guessable secrets, so they get roomier limits.
const OVERRIDES: Partial<Record<AuthAction, { subject: Limit; ip: Limit }>> = {
  "team-invite": { subject: { limit: 20, windowSec: 60 * 60 }, ip: { limit: 60, windowSec: 60 * 60 } },
  "request-manage": { subject: { limit: 60, windowSec: 60 * 60 }, ip: { limit: 120, windowSec: 60 * 60 } },
  generate: { subject: { limit: 10, windowSec: 60 * 60 }, ip: { limit: 30, windowSec: 60 * 60 } },
  "case-study-edit": { subject: { limit: 120, windowSec: 60 * 60 }, ip: { limit: 240, windowSec: 60 * 60 } },
  "team-manage": { subject: { limit: 60, windowSec: 15 * 60 }, ip: { limit: 120, windowSec: 60 * 60 } },
};

const limiters = new Map<AuthAction, { byEmail: RateLimiter; byIp: RateLimiter }>();

function limitersFor(action: AuthAction) {
  let entry = limiters.get(action);
  if (!entry) {
    entry = {
      byEmail: createRateLimiter({ prefix: `auth:${action}:email`, ...(OVERRIDES[action]?.subject ?? EMAIL_LIMIT) }),
      byIp: createRateLimiter({ prefix: `auth:${action}:ip`, ...(OVERRIDES[action]?.ip ?? IP_LIMIT) }),
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
