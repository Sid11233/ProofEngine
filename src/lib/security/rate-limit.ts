import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { serverEnv } from "./env.server";
import { createMemoryLimiter, type RateLimiter } from "./rate-limit-memory";

export type { RateLimiter, RateLimitResult } from "./rate-limit-memory";

export interface RateLimitConfig {
  /** Namespaces the counters, e.g. "auth:login:email". */
  prefix: string;
  limit: number;
  windowSec: number;
}

let warnedAboutMemory = false;

/**
 * Upstash-backed limiter when configured, otherwise in-memory. If Redis errors at
 * request time we degrade to the in-memory limiter rather than letting traffic
 * through unlimited.
 */
export function createRateLimiter({ prefix, limit, windowSec }: RateLimitConfig): RateLimiter {
  const memory = createMemoryLimiter({ limit, windowMs: windowSec * 1000 });
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = serverEnv;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production" && !warnedAboutMemory) {
      warnedAboutMemory = true;
      console.warn("Rate limiting is per-instance: UPSTASH_REDIS_REST_URL/TOKEN are not set.");
    }
    return memory;
  }

  const redis = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
    prefix: `pe:${prefix}`,
  });

  return {
    async limit(identifier) {
      try {
        const result = await redis.limit(identifier);
        return { success: result.success, remaining: result.remaining, resetAt: result.reset };
      } catch {
        console.error("Rate limiter unavailable, using in-memory fallback");
        return memory.limit(identifier);
      }
    },
  };
}
