import { describe, expect, it } from "vitest";
import { hashIp, ipHashSecret } from "./ip-hash";

describe("hashIp", () => {
  it("is a stable 64-char hex value that depends on the secret and the address", () => {
    const a = hashIp("secret-one", "203.0.113.5");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp("secret-one", "203.0.113.5")).toBe(a);
    expect(hashIp("secret-two", "203.0.113.5")).not.toBe(a);
    expect(hashIp("secret-one", "203.0.113.6")).not.toBe(a);
  });
});

describe("ipHashSecret", () => {
  it("prefers the configured secret and never returns the service role key", () => {
    expect(ipHashSecret({ IP_HASH_SECRET: "x".repeat(32), SUPABASE_SERVICE_ROLE_KEY: "service-key-value" })).toBe("x".repeat(32));
    const derived = ipHashSecret({ SUPABASE_SERVICE_ROLE_KEY: "service-key-value" });
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain("service-key-value");
  });
});
