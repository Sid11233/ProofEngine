import { describe, expect, it } from "vitest";
import { createMemoryLimiter } from "./rate-limit-memory";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createMemoryLimiter", () => {
  it("allows up to the limit, then blocks", async () => {
    const c = clock();
    const limiter = createMemoryLimiter({ limit: 5, windowMs: 15 * 60_000, now: c.now });
    for (let i = 0; i < 5; i++) expect((await limiter.limit("a@b.c")).success).toBe(true);
    const blocked = await limiter.limit("a@b.c");
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("reports remaining attempts", async () => {
    const limiter = createMemoryLimiter({ limit: 3, windowMs: 1000, now: clock().now });
    expect((await limiter.limit("k")).remaining).toBe(2);
    expect((await limiter.limit("k")).remaining).toBe(1);
    expect((await limiter.limit("k")).remaining).toBe(0);
  });

  it("keeps separate counters per identifier", async () => {
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 1000, now: clock().now });
    expect((await limiter.limit("one")).success).toBe(true);
    expect((await limiter.limit("two")).success).toBe(true);
    expect((await limiter.limit("one")).success).toBe(false);
  });

  it("frees capacity as attempts age out of the window", async () => {
    const c = clock();
    const limiter = createMemoryLimiter({ limit: 2, windowMs: 1000, now: c.now });
    await limiter.limit("k");
    c.advance(600);
    await limiter.limit("k");
    expect((await limiter.limit("k")).success).toBe(false);
    c.advance(500); // first attempt is now 1100ms old
    expect((await limiter.limit("k")).success).toBe(true);
  });

  it("does not count blocked attempts against the caller", async () => {
    const c = clock();
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 1000, now: c.now });
    await limiter.limit("k");
    for (let i = 0; i < 50; i++) await limiter.limit("k");
    c.advance(1001);
    expect((await limiter.limit("k")).success).toBe(true);
  });

  it("tells the caller when the window resets", async () => {
    const c = clock(5000);
    const limiter = createMemoryLimiter({ limit: 1, windowMs: 1000, now: c.now });
    await limiter.limit("k");
    expect((await limiter.limit("k")).resetAt).toBe(6000);
  });
});
