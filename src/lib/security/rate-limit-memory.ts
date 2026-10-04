// In-process sliding-window limiter. Used in tests and local development, and as
// the fallback when Redis is not configured or is unreachable. In production this
// is per server instance, so it only slows an attacker down: configure Upstash
// before launch (docs/limits.md).

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Epoch ms when the oldest counted attempt leaves the window. */
  resetAt: number;
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

const MAX_TRACKED_KEYS = 10_000;

export function createMemoryLimiter({
  limit,
  windowMs,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const hits = new Map<string, number[]>();

  function prune(current: number) {
    for (const [key, times] of hits) {
      if (times.every((t) => t <= current - windowMs)) hits.delete(key);
    }
  }

  return {
    async limit(identifier) {
      const current = now();
      const recent = (hits.get(identifier) ?? []).filter((t) => t > current - windowMs);

      if (recent.length >= limit) {
        hits.set(identifier, recent);
        return { success: false, remaining: 0, resetAt: recent[0] + windowMs };
      }

      recent.push(current);
      hits.set(identifier, recent);
      if (hits.size > MAX_TRACKED_KEYS) prune(current);
      return { success: true, remaining: limit - recent.length, resetAt: recent[0] + windowMs };
    },
  };
}
