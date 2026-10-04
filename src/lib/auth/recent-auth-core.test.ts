import { describe, expect, it } from "vitest";
import { DEFAULT_REAUTH_MAX_AGE_MS, isRecentAuth, latestAuthTime } from "./recent-auth-core";

const now = Date.parse("2026-10-04T12:00:00Z");
const at = (msAgo: number) => Math.floor((now - msAgo) / 1000);

describe("latestAuthTime", () => {
  it("takes the newest timestamp across methods", () => {
    const amr = [
      { method: "password", timestamp: at(60 * 60_000) },
      { method: "totp", timestamp: at(30_000) },
    ];
    expect(latestAuthTime(amr, now)).toBe(at(30_000) * 1000);
  });

  it("ignores junk, missing timestamps and legacy string entries", () => {
    expect(latestAuthTime(["password"], now)).toBeNull();
    expect(latestAuthTime([{ method: "password" }, null, 5, { timestamp: "x" }], now)).toBeNull();
    expect(latestAuthTime(undefined, now)).toBeNull();
    expect(latestAuthTime("password", now)).toBeNull();
  });

  it("ignores timestamps from the future", () => {
    expect(latestAuthTime([{ timestamp: at(-10 * 60_000) }], now)).toBeNull();
  });
});

describe("isRecentAuth", () => {
  it("accepts a proof inside the 10 minute window", () => {
    expect(isRecentAuth([{ timestamp: at(0) }], now)).toBe(true);
    expect(isRecentAuth([{ timestamp: at(9 * 60_000) }], now)).toBe(true);
  });

  it("rejects an older proof", () => {
    expect(isRecentAuth([{ timestamp: at(DEFAULT_REAUTH_MAX_AGE_MS + 5_000) }], now)).toBe(false);
    expect(isRecentAuth([{ timestamp: at(24 * 3600_000) }], now)).toBe(false);
  });

  it("rejects when there is no usable proof", () => {
    expect(isRecentAuth([], now)).toBe(false);
    expect(isRecentAuth(undefined, now)).toBe(false);
  });

  it("tolerates a little clock skew and honours a custom window", () => {
    expect(isRecentAuth([{ timestamp: Math.floor((now + 30_000) / 1000) }], now)).toBe(true);
    expect(isRecentAuth([{ timestamp: at(5_000) }], now, 2_000)).toBe(false);
    expect(isRecentAuth([{ timestamp: at(1_000) }], now, 2_000)).toBe(true);
  });
});
