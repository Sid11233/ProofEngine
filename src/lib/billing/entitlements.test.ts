import { describe, expect, it } from "vitest";
import { resolveLimits } from "@/lib/limits";
import { canCreateInterview, canRemoveBranding, canUseAI, templateAllowed } from "./entitlements";
import { PLANS, planForPrice, planOf } from "./plans";

describe("plans", () => {
  it("treats unknown or tampered plan values as free", () => {
    for (const v of ["", "enterprise", "PRO", null, undefined, 5, { plan: "pro" }]) expect(planOf(v).id, String(v)).toBe("free");
    expect(planOf("pro").id).toBe("pro");
  });
  it("maps only the configured price id to a plan", () => {
    const env = { STRIPE_PRICE_PRO: "price_abc123" };
    expect(planForPrice("price_abc123", env)).toBe("pro");
    for (const v of ["price_other", "", null, undefined, "PRICE_ABC123"]) expect(planForPrice(v, env), String(v)).toBeNull();
    expect(planForPrice("price_abc123", {})).toBeNull();
  });
});

describe("canCreateInterview", () => {
  it("blocks the interview after the plan's monthly allowance", () => {
    expect(canCreateInterview({ plan: "free", usedThisMonth: 2 }).allowed).toBe(true);
    const blocked = canCreateInterview({ plan: "free", usedThisMonth: 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("3 interviews");
    expect(canCreateInterview({ plan: "pro", usedThisMonth: 3 }).allowed).toBe(true);
    expect(canCreateInterview({ plan: "pro", usedThisMonth: 100 }).allowed).toBe(false);
    expect(canCreateInterview({ plan: "made-up", usedThisMonth: 3 }).allowed, "unknown plan counts as free").toBe(false);
  });
});

describe("canUseAI and canRemoveBranding", () => {
  const limits = resolveLimits({});
  it("uses the plan's AI allowance, with env overrides applied", () => {
    expect(canUseAI({ plan: "free", usedThisMonth: 99, limits }).allowed).toBe(true);
    expect(canUseAI({ plan: "free", usedThisMonth: 100, limits }).allowed).toBe(false);
    expect(canUseAI({ plan: "pro", usedThisMonth: 100, limits }).allowed).toBe(true);
    expect(canUseAI({ plan: "free", usedThisMonth: 100, limits: resolveLimits({ AI_MESSAGES_FREE: "500" }) }).allowed).toBe(true);
  });
  it("removes the badge only on paid plans", () => {
    expect(canRemoveBranding("free")).toBe(false);
    expect(canRemoveBranding("pro")).toBe(true);
    expect(canRemoveBranding("team")).toBe(true);
    expect(canRemoveBranding("bogus")).toBe(false);
  });
});

describe("templateAllowed", () => {
  it("free templates for everyone, pro templates from the pro plan or an entitlement, packs only by entitlement", () => {
    expect(templateAllowed({ tier: "free", plan: "free", entitled: false })).toBe(true);
    expect(templateAllowed({ tier: "pro", plan: "free", entitled: false })).toBe(false);
    expect(templateAllowed({ tier: "pro", plan: "pro", entitled: false })).toBe(true);
    expect(templateAllowed({ tier: "pro", plan: "free", entitled: true })).toBe(true);
    expect(templateAllowed({ tier: "pack", plan: "pro", entitled: false })).toBe(false);
    expect(templateAllowed({ tier: "free", plan: "pro", entitled: true, active: false })).toBe(false);
  });
  it("agrees with the plan table", () => {
    for (const plan of Object.values(PLANS)) expect(templateAllowed({ tier: "pro", plan: plan.id, entitled: false }), plan.id).toBe(plan.proTemplates);
  });
});
