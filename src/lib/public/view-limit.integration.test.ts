/** Phase 11 audit M2: every public site route is rate limited, including the logo redirect (npm run test:isolation). */
import { describe, expect, it } from "vitest";
import { GET as logoRoute } from "@/app/sites/[workspace]/[slug]/logo/route";

describe("public logo route", () => {
  it("answers 429 once one address has asked too often, and a different address is unaffected", async () => {
    const call = (ip: string) => logoRoute(new Request("http://acme.localhost/story/logo", { headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ workspace: "no-such-workspace", slug: "no-such-story" }) });
    const statuses: number[] = [];
    for (let i = 0; i < 140; i++) statuses.push((await call("203.0.113.50")).status);
    expect(statuses.slice(0, 100).every((s) => s === 404)).toBe(true);
    expect(statuses.includes(429), "the logo route never rate limited a flood").toBe(true);
    expect((await call("203.0.113.51")).status).toBe(404);
  });
});
