import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe("verifyTurnstile", () => {
  it("is true only when Cloudflare says success", async () => {
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: reply({ success: true }) })).toBe(true);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: reply({ success: false }) })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: reply({ success: "true" }) })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: reply({}) })).toBe(false);
  });

  it("fails closed on missing or oversized tokens, HTTP errors and network failures", async () => {
    const never = reply({ success: true });
    expect(await verifyTurnstile({ secret: "s", token: undefined, fetchImpl: never })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "", fetchImpl: never })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "x".repeat(3000), fetchImpl: never })).toBe(false);
    expect(never).not.toHaveBeenCalled();
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: reply({ success: true }, false) })).toBe(false);
    expect(await verifyTurnstile({ secret: "s", token: "t", fetchImpl: vi.fn(async () => { throw new Error("down"); }) })).toBe(false);
  });

  it("sends the secret, token and client IP to Cloudflare", async () => {
    const fetchImpl = reply({ success: true });
    await verifyTurnstile({ secret: "the-secret", token: "the-token", ip: "203.0.113.9", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = String(init.body);
    expect(body).toContain("secret=the-secret");
    expect(body).toContain("response=the-token");
    expect(body).toContain("remoteip=203.0.113.9");
  });

  it("does not forward an unknown IP", async () => {
    const fetchImpl = reply({ success: true });
    await verifyTurnstile({ secret: "s", token: "t", ip: "unknown", fetchImpl });
    expect(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain("remoteip");
  });
});
