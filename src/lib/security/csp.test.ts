import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const base = { nonce: "abc123", supabaseUrl: "https://xyz.supabase.co" };

describe("buildCsp", () => {
  const prod = buildCsp({ ...base, isDev: false });

  it("uses the nonce and no unsafe directives in production", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    // The only 'unsafe-inline' is for style attributes (see the style-src-attr test below).
    expect(prod.replace("style-src-attr 'unsafe-inline'", "")).not.toContain("unsafe-inline");
    expect(prod).not.toContain("unsafe-eval");
  });

  it("locks down framing, plugins, base and forms", () => {
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("allows inline style attributes only, while style elements still need the nonce", () => {
    expect(prod).toContain("style-src-attr 'unsafe-inline'");
    expect(prod).toContain("style-src 'self' 'nonce-abc123'");
    expect(prod).not.toMatch(/style-src(?!-attr) [^;]*unsafe-inline/);
    expect(prod).not.toContain("style-src-elem");
  });

  it("allows framing only Cloudflare's Turnstile", () => {
    expect(prod).toContain("frame-src https://challenges.cloudflare.com");
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
