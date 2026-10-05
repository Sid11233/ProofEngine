import { describe, expect, it } from "vitest";
import { getClientIp, trustsProxyHeaders } from "./client-ip";

const headers = (init: Record<string, string>) => new Headers(init);

describe("getClientIp", () => {
  it("prefers x-real-ip", () => {
    expect(getClientIp(headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("uses the first x-forwarded-for entry", () => {
    expect(getClientIp(headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("accepts IPv6", () => {
    expect(getClientIp(headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it.each(["not-an-ip", "1.2.3.4.5", "999.1.1.1", "127.0.0.1; drop table"])(
    "refuses to use %j as a rate-limit key",
    (value) => {
      expect(getClientIp(headers({ "x-forwarded-for": value }))).toBe("unknown");
    },
  );

  it("is unknown when no header is present", () => {
    expect(getClientIp(headers({}))).toBe("unknown");
  });
});

describe("trusting proxy headers", () => {
  const forged = headers({ "x-forwarded-for": "198.51.100.77" });

  it("accepts them on Vercel and in development", () => {
    expect(getClientIp(forged, { VERCEL: "1", NODE_ENV: "production" })).toBe("198.51.100.77");
    expect(getClientIp(forged, { NODE_ENV: "development" })).toBe("198.51.100.77");
    expect(getClientIp(forged, { NODE_ENV: "test" })).toBe("198.51.100.77");
  });

  it("ignores them in production when no trusted proxy is declared, so a client cannot choose its own bucket", () => {
    expect(getClientIp(forged, { NODE_ENV: "production" })).toBe("unknown");
    expect(getClientIp(headers({ "x-real-ip": "203.0.113.5" }), { NODE_ENV: "production" })).toBe("unknown");
  });

  it("can be switched on or off explicitly", () => {
    expect(getClientIp(forged, { NODE_ENV: "production", TRUST_PROXY_HEADERS: "1" })).toBe("198.51.100.77");
    expect(getClientIp(forged, { VERCEL: "1", NODE_ENV: "production", TRUST_PROXY_HEADERS: "0" })).toBe("unknown");
    expect(trustsProxyHeaders({ NODE_ENV: "production", TRUST_PROXY_HEADERS: "yes" })).toBe(false);
  });
});
