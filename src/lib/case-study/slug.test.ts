import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "./slug";

describe("slugify", () => {
  it("makes a clean address from a headline", () => {
    expect(slugify("How Acme cut onboarding by 40%!")).toBe("how-acme-cut-onboarding-by-40");
    expect(slugify("Café  déjà vu")).toBe("cafe-deja-vu");
  });
  it("falls back when nothing usable is left and caps the length", () => {
    expect(slugify("!!")).toBe("case-study");
    expect(slugify("word ".repeat(40)).length).toBeLessThanOrEqual(60);
  });
  it("only produces valid slugs", () => {
    for (const t of ["<script>alert(1)</script>", "../../etc", "  ", "A--B", "x".repeat(100)]) expect(isValidSlug(slugify(t)), t).toBe(true);
  });
});

describe("isValidSlug", () => {
  it("rejects bad shapes", () => {
    for (const bad of ["a", "-ab", "ab-", "a--b", "Has Space", "UPPER", "a/b"]) expect(isValidSlug(bad), bad).toBe(false);
    expect(isValidSlug("good-one-2")).toBe(true);
  });
});
