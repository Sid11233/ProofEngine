import { getClientIp } from "@/lib/security/client-ip";
import { sha256Hex } from "@/lib/security/hash";
import { createRateLimiter } from "@/lib/security/rate-limit";

// One IP limit for every public page and file on a workspace site (the story, the home page, the report
// form, the logo): 120 requests a minute per address. Public pages hit the database, so none of them may
// be an unlimited door.

const limiter = createRateLimiter({ prefix: "site:ip", limit: 120, windowSec: 60 });

export async function publicViewAllowed(requestHeaders: Pick<Headers, "get">): Promise<boolean> {
  return (await limiter.limit(sha256Hex(getClientIp(requestHeaders)))).success;
}

/** The plain "slow down" page body used by the public pages. */
export const TOO_MANY_REQUESTS_TEXT = "Too many requests. Please try again in a minute.";
