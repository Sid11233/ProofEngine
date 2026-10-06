import { describe, expect, it } from "vitest";
import { matchScore, rankCommunities, tokens, workspaceTags } from "./match";
import { cleanNotes, httpsLink, trackerInputSchema } from "./schemas";

const c = (name: string, niches: string[], audience: string | null = null, needsVerification = true) => ({ name, niches, audience, needsVerification });

describe("workspaceTags", () => {
  it("turns niche and audience words, and their common aliases, into tags", () => {
    const tags = workspaceTags("AI automation for dentists", "Dental practice owners");
    expect(tags.has("ai")).toBe(true);
    expect(tags.has("dentist")).toBe(true);
    expect(workspaceTags("Software company", null).has("saas")).toBe(true);
    expect(workspaceTags("We are a design studio", null).has("design")).toBe(true);
    expect(workspaceTags("We are a design studio", null).has("agency")).toBe(true);
  });
  it("is empty for empty input", () => {
    expect(workspaceTags("", null).size).toBe(0);
    expect(tokens(undefined).size).toBe(0);
  });
});

describe("ranking", () => {
  const tags = workspaceTags("SaaS startup", "Founders of subscription software");
  it("puts tag overlap first, then audience words, then verified, then name", () => {
    const list = [
      c("Zeta designers", ["design"], "Product designers"),
      c("Beta saas", ["saas"], "Founders and operators building subscription software", true),
      c("Alpha saas verified", ["saas"], "Founders", false),
      c("Gamma startups", ["startups"], "Founders of startups"),
    ];
    const ranked = rankCommunities(list, tags);
    expect(ranked.map((r) => r.name)).toEqual(["Beta saas", "Alpha saas verified", "Gamma startups", "Zeta designers"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[3].score).toBe(0);
  });
  it("does not change the input and is stable for a tie", () => {
    const list = [c("B", []), c("A", [])];
    const copy = [...list];
    expect(rankCommunities(list, new Set()).map((r) => r.name)).toEqual(["A", "B"]);
    expect(list).toEqual(copy);
  });
  it("scores 3 per tag and 1 per audience word", () => {
    expect(matchScore(c("x", ["saas", "ai"], null), new Set(["saas", "ai"]))).toBe(6);
    expect(matchScore(c("x", [], "Founders and operators"), new Set(["founder", "operator"]))).toBe(2);
  });
});

describe("links and notes", () => {
  it("only plain https links are ever links", () => {
    expect(httpsLink("https://example.com/a")).toBe("https://example.com/a");
    for (const bad of ["http://example.com", "javascript:alert(1)", "//example.com", "data:text/html,x", "https://u:p@example.com", "", null, 5, "https://" + "a".repeat(600)]) expect(httpsLink(bad), String(bad)).toBeNull();
  });
  it("notes are cleaned and bounded, and unknown fields are rejected", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(cleanNotes("a\u0000b‮\r\n\n\n\nc")).toBe("ab\n\nc");
    expect(trackerInputSchema.parse({ communityId: id, status: "saved", notes: " <b>hi</b> " }).notes).toBe("<b>hi</b>");
    for (const bad of [{ communityId: id, status: "lurking", notes: "" }, { communityId: "x", status: "saved", notes: "" }, { communityId: id, status: "saved", notes: "x".repeat(2001) }, { communityId: id, status: "saved", notes: "", workspaceId: id }]) {
      expect(trackerInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
