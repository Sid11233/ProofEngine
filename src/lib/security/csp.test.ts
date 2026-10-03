import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const base = { nonce: "abc123", supabaseUrl: "https://xyz.supabase.co" };

describe("buildCsp", () => {
  const prod = buildCsp({ ...base, isDev: false });

  it("uses the nonce and no unsafe directives in production", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-inline");
    expect(prod).not.toContain("unsafe-eval");
  });

  it("locks down framing, plugins, base and forms", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("allows only the Supabase origin for data connections", () => {
    expect(prod).toContain("connect-src 'self' https://xyz.supabase.co wss://xyz.supabase.co");
  });

  it("relaxes only what dev tooling needs", () => {
    const dev = buildCsp({ ...base, isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});
