import { describe, expect, it } from "vitest";
import { isBareStarter, startersFor } from "./starters";

describe("starters", () => {
  it("never contain digits, links or money, so they cannot put a figure in a client's mouth", () => {
    for (const key of ["challenge", "trigger", "solution", "results", "quote", "audience", undefined, "unknown"]) {
      for (const s of startersFor(key)) {
        expect(s).not.toMatch(/\d|https?:|www\.|[$€£%]/);
        expect(s.length).toBeLessThanOrEqual(60);
      }
    }
  });
  it("use the story part when known and a generic set otherwise", () => {
    expect(startersFor("results")[0]).toContain("Since then");
    expect(startersFor("custom-thing")).toEqual(startersFor(undefined));
  });
  it("a bare starter cannot be sent, an edited one can", () => {
    expect(isBareStarter("We were struggling with…")).toBe(true);
    expect(isBareStarter("  ")).toBe(true);
    expect(isBareStarter("We were struggling with slow onboarding")).toBe(false);
  });
});
