import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./schemas";

const valid = {
  type: "agency",
  name: "Acme Agency",
  niche: "AI automation for dentists",
  audience: "Dental practice owners",
  website: "https://acme.com",
  description: "We build chat assistants that book appointments.",
};

describe("onboardingSchema", () => {
  it("accepts a complete profile and trims text", () => {
    const parsed = onboardingSchema.parse({ ...valid, name: "  Acme Agency  " });
    expect(parsed.name).toBe("Acme Agency");
    expect(parsed.website).toBe("https://acme.com/");
  });

  it("treats an empty website as not provided", () => {
    expect(onboardingSchema.parse({ ...valid, website: "   " }).website).toBeUndefined();
  });

  it("normalises the host and keeps the path", () => {
    expect(onboardingSchema.parse({ ...valid, website: "https://ACME.com/work?x=1" }).website).toBe(
      "https://acme.com/work?x=1",
    );
  });

  it.each([
    "http://acme.com",
    "ftp://acme.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//acme.com",
    "acme.com",
    "https://user:pass@acme.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://10.0.0.5/admin",
    "https://intranet",
    "https://printer.local",
    "https://db.internal",
    `https://acme.com/${"a".repeat(2100)}`,
  ])("rejects the website %j", (website) => {
    expect(onboardingSchema.safeParse({ ...valid, website }).success).toBe(false);
  });

  it("only accepts the two business types", () => {
    expect(onboardingSchema.safeParse({ ...valid, type: "saas" }).success).toBe(true);
    expect(onboardingSchema.safeParse({ ...valid, type: "enterprise" }).success).toBe(false);
  });

  it("rejects unknown fields, so a client cannot smuggle in plan or slug", () => {
    expect(onboardingSchema.safeParse({ ...valid, plan: "team" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, subdomain_slug: "admin" }).success).toBe(false);
  });

  it("enforces the length limits that the database also enforces", () => {
    expect(onboardingSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, niche: "x".repeat(101) }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, audience: "x".repeat(201) }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, description: "x".repeat(301) }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });
});
