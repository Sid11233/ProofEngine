import { afterAll, describe, expect, it } from "vitest";
import { BASE, startStack, stopStack, type Stack } from "./harness";

let stack: Stack | undefined;
afterAll(async () => {
  await stopStack(stack);
});

describe("security.txt (Phase 11)", () => {
  it("is not published until a contact is configured", async () => {
    stack = await startStack();
    expect((await fetch(`${BASE}/.well-known/security.txt`)).status).toBe(404);
  }, 120_000);

  it("is served as plain text with Contact, Expires and Canonical once SECURITY_CONTACT is set", async () => {
    await stopStack(stack);
    stack = await startStack({ SECURITY_CONTACT: "mailto:security@example.com" });
    const res = await fetch(`${BASE}/.well-known/security.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Contact: mailto:security@example.com");
    expect(text).toMatch(/Expires: 20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ/);
    expect(text).toContain(`Canonical: ${BASE}/.well-known/security.txt`);
    const expires = Date.parse(/Expires: (\S+)/.exec(text)![1]);
    expect(expires).toBeGreaterThan(Date.now());
  }, 120_000);
});

describe("browser policy on the live app (audit L5, CORS)", () => {
  it("lets pages connect to the app only, and sets no CORS headers for other origins", async () => {
    const page = await fetch(`${BASE}/login`);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    expect(csp).not.toContain("supabase");

    for (const path of ["/login", "/api/case-studies/generate", "/manifest.webmanifest"]) {
      const res = await fetch(`${BASE}${path}`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
      expect(res.headers.get("access-control-allow-origin"), `${path} allows another origin`).toBeNull();
    }
    const cross = await fetch(`${BASE}/api/case-studies/generate`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect([401, 403, 400, 405]).toContain(cross.status);
    expect(cross.headers.get("access-control-allow-origin")).toBeNull();
  }, 60_000);
});
