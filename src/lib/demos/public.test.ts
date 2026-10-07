import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";
import { frameAncestorsFor } from "./public";
import { demoEventSchema, leadSchema } from "./public-schemas";
import { normaliseOrigin } from "./service";

describe("embed origins", () => {
  it("keeps only plain https origins", () => {
    expect(frameAncestorsFor(["https://www.example.com", "http://evil.test", "https://a.test/path", "https://*.test", "javascript:x", "https://ok.test:8443", 5, null])).toEqual(["https://www.example.com", "https://ok.test:8443"]);
    expect(frameAncestorsFor("https://x.test")).toEqual([]);
    expect(frameAncestorsFor(Array.from({ length: 30 }, (_, i) => `https://s${i}.test`))).toHaveLength(10);
  });
  it("normalises what an admin types, and refuses the rest", () => {
    expect(normaliseOrigin(" https://WWW.Example.com/some/page?x=1#y ")).toBe("https://www.example.com");
    for (const bad of ["http://example.com", "https://localhost", "https://u:p@example.com", "javascript:alert(1)", "example.com", "https://*.example.com", "", 5, "https://exa mple.com", "https://" + "a".repeat(300) + ".com"]) expect(normaliseOrigin(bad), String(bad)).toBeNull();
  });
  it("the CSP lets only the listed sites frame the page, and nobody when the list is empty", () => {
    const base = { nonce: "n", supabaseUrl: "http://127.0.0.1:54321", isDev: false };
    expect(buildCsp({ ...base, frameAncestors: ["https://a.test", "https://b.test"] })).toContain("frame-ancestors https://a.test https://b.test");
    expect(buildCsp({ ...base, frameAncestors: [] })).toContain("frame-ancestors 'none'");
    expect(buildCsp(base)).toContain("frame-ancestors 'none'");
  });
});

describe("public inputs", () => {
  it("events: known types, a step only on step events, nothing else", () => {
    expect(demoEventSchema.safeParse({ type: "view" }).success).toBe(true);
    expect(demoEventSchema.safeParse({ type: "step", step: 3 }).success).toBe(true);
    for (const bad of [{ type: "lead" }, { type: "view", step: 1 }, { type: "step", step: -1 }, { type: "step", step: 201 }, { type: "view", ua: "x" }, { type: "step", step: 1.5 }]) expect(demoEventSchema.safeParse(bad).success).toBe(false);
  });
  it("leads need a valid email and an explicit consent, reject unknown fields and filled honeypots", () => {
    expect(leadSchema.safeParse({ email: "a@b.co", consent: true }).success).toBe(true);
    expect(leadSchema.safeParse({ email: "a@b.co", name: "Ann", consent: true, step_reached: 2, company: "" }).success).toBe(true);
    for (const bad of [{ email: "a@b.co" }, { email: "a@b.co", consent: false }, { email: "nope", consent: true }, { email: "a@b.co", consent: true, company: "Acme" }, { email: "a@b.co", consent: true, role: "admin" }, { email: "a@b.co", consent: "yes" }, { email: "a".repeat(400) + "@b.co", consent: true }]) expect(leadSchema.safeParse(bad).success).toBe(false);
  });
  it("lead names are cleaned to one plain line", () => {
    const parsed = leadSchema.parse({ email: "a@b.co", name: "  Ann​\n  Lee  ", consent: true });
    expect(parsed.name).toBe("Ann Lee");
  });
});
