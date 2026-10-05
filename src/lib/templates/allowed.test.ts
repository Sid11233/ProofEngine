import { describe, expect, it } from "vitest";
import { isTemplateAllowed } from "./allowed";

describe("isTemplateAllowed", () => {
  it("free templates are open to everyone", () => {
    for (const plan of ["free", "pro", "team"]) expect(isTemplateAllowed({ tier: "free", plan, entitled: false })).toBe(true);
  });

  it("pro templates need a pro or team plan, or an entitlement", () => {
    expect(isTemplateAllowed({ tier: "pro", plan: "free", entitled: false })).toBe(false);
    expect(isTemplateAllowed({ tier: "pro", plan: "pro", entitled: false })).toBe(true);
    expect(isTemplateAllowed({ tier: "pro", plan: "team", entitled: false })).toBe(true);
    expect(isTemplateAllowed({ tier: "pro", plan: "free", entitled: true })).toBe(true);
  });

  it("pack templates need a purchase, whatever the plan", () => {
    for (const plan of ["free", "pro", "team"]) expect(isTemplateAllowed({ tier: "pack", plan, entitled: false })).toBe(false);
    expect(isTemplateAllowed({ tier: "pack", plan: "free", entitled: true })).toBe(true);
  });

  it("inactive templates are never allowed", () => {
    expect(isTemplateAllowed({ tier: "free", plan: "team", entitled: true, active: false })).toBe(false);
  });

  it("an unknown plan gets nothing beyond free", () => {
    expect(isTemplateAllowed({ tier: "pro", plan: "enterprise", entitled: false })).toBe(false);
  });
});
