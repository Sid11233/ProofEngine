import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, newPage, startStack, stopStack, type Stack } from "./harness";

let stack: Stack;

beforeAll(async () => {
  // A DSN that goes nowhere: the app must start, serve pages and keep working when reports cannot be delivered.
  stack = await startStack({ SENTRY_DSN: "https://publickey@o0.ingest.sentry.io/1", ALERT_EMAIL: "ops@example.com" });
}, 120_000);
afterAll(async () => {
  await stopStack(stack);
});

describe("with error reporting configured", () => {
  it("serves pages normally, adds nothing to the browser and keeps the strict CSP", async () => {
    const page = await newPage(stack);
    const res = await page.goto(`${BASE}/login`);
    expect(res?.status()).toBe(200);
    const csp = res?.headers()["content-security-policy"] ?? "";
    expect(csp).not.toContain("sentry");
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    const html = await page.content();
    expect(html.toLowerCase()).not.toContain("sentry");
    // No request leaves the browser for Sentry.
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.reload();
    expect(requests.filter((u) => u.includes("sentry"))).toEqual([]);
  }, 60_000);

  it("keeps answering when failures pile up (the alerting never blocks or breaks a request)", async () => {
    // Unknown interview links: a burst well past the alert threshold.
    const statuses = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const token = Buffer.from(`probe-${i}-${Math.random()}`).toString("base64url").padEnd(43, "A").slice(0, 43);
      const res = await fetch(`${BASE}/i/${token}`, { headers: { "x-forwarded-for": `198.51.100.${(i % 200) + 1}` } });
      statuses.add(res.status);
    }
    expect([...statuses].every((s) => s === 404 || s === 429)).toBe(true);
    expect((await fetch(`${BASE}/login`)).status).toBe(200);
  }, 120_000);
});
