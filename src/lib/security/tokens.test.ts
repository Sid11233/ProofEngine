import { describe, expect, it } from "vitest";
import { constantTimeEqualHex, generateToken, hashToken, isWellFormedToken } from "./tokens";

describe("tokens", () => {
  it("generates 32 random bytes as 43 url-safe characters", () => {
    const { raw } = generateToken();
    expect(raw).toHaveLength(43);
    expect(isWellFormedToken(raw)).toBe(true);
  });

  it("stores a SHA-256 hash that differs from the raw token", () => {
    const { raw, hash } = generateToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(raw);
    expect(hashToken(raw)).toBe(hash);
  });

  it("matches the SHA-256 of a known value", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken().raw));
    expect(seen.size).toBe(500);
  });

  it.each(["", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, `${"a".repeat(42)}/`, `${"a".repeat(42)} `, "../".repeat(15)])(
    "rejects the malformed token %j",
    (value) => {
      expect(isWellFormedToken(value)).toBe(false);
    },
  );

  it("compares digests in constant time and rejects different lengths", () => {
    const { hash } = generateToken();
    expect(constantTimeEqualHex(hash, hash)).toBe(true);
    expect(constantTimeEqualHex(hash, hashToken("other"))).toBe(false);
    expect(constantTimeEqualHex(hash, hash.slice(0, 63))).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(true);
  });
});
