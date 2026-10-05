import { describe, expect, it } from "vitest";
import { findEditedClaims, numbersIn, numbersMatch, quoteMatches, redactUnverified, verifyContent, type ClaimRef } from "./claim-check";
import { caseStudyContentSchema, type CaseStudyContent } from "./schema";

const MESSAGE = "We cut onboarding time by 40 percent in March. Support tickets fell from 1,200 to 300 a month.";
const claims = new Map<string, ClaimRef>([
  ["c1", { id: "c1", sourceQuote: "cut onboarding time by 40 percent", messageContent: MESSAGE }],
  ["c2", { id: "c2", sourceQuote: "Support tickets fell from 1,200 to 300 a month", messageContent: MESSAGE }],
]);

const base = (overrides: Partial<CaseStudyContent> = {}): CaseStudyContent =>
  caseStudyContentSchema.parse({
    headline: "Faster onboarding",
    client: {},
    sections: [
      { type: "results", title: "Results", body: "Onboarding got faster.", metrics: [{ label: "Onboarding time", value: "40 percent", claimId: "c1" }] },
      { type: "quote", title: "In their words", quote: { text: "We cut onboarding time", attribution: "T", claimId: "c1" } },
    ],
    tags: ["onboarding"],
    ...overrides,
  });

describe("numbersIn", () => {
  it.each([
    ["by 40 percent", ["40"]],
    ["from 1,200 to 300.", ["1,200", "300"]],
    ["3.5x growth", ["3.5"]],
    ["no figures here", []],
    ["Ends with 40.", ["40"]],
  ])("%j", (text, expected) => expect(numbersIn(text)).toEqual(expected));
});

describe("numbersMatch and quoteMatches", () => {
  it("accepts the client's figures and text without figures", () => {
    expect(numbersMatch("40 percent", claims.get("c1")!)).toBe(true);
    expect(numbersMatch("faster", claims.get("c1")!)).toBe(true);
  });

  it("rejects an invented, rounded or changed figure", () => {
    expect(numbersMatch("90 percent", claims.get("c1")!)).toBe(false);
    expect(numbersMatch("about 50 percent", claims.get("c1")!)).toBe(false);
    expect(numbersMatch("40 to 90 percent", claims.get("c1")!)).toBe(false);
    expect(numbersMatch("1,200", claims.get("c1")!)).toBe(false); // true figure, wrong claim
  });

  it("requires quotes to be exact, case-sensitive pieces of the message", () => {
    const c = claims.get("c1")!;
    expect(quoteMatches("We cut onboarding time by 40 percent in March.", c)).toBe(true);
    expect(quoteMatches("we cut onboarding time", c)).toBe(false);
    expect(quoteMatches("We cut onboarding time by 90 percent", c)).toBe(false);
    expect(quoteMatches("We significantly cut onboarding time", c)).toBe(false);
    expect(quoteMatches("", c)).toBe(false);
    expect(quoteMatches("   ", c)).toBe(false);
  });
});

describe("verifyContent", () => {
  it("passes a faithful draft", () => {
    expect(verifyContent(base(), claims)).toEqual([]);
  });

  it("flags an invented metric value", () => {
    const content = base({ sections: [{ type: "results", title: "R", metrics: [{ label: "Onboarding time", value: "90 percent", claimId: "c1" }] }] });
    expect(verifyContent(content, claims)).toMatchObject([{ kind: "number_mismatch", where: "sections[0].metrics[0]" }]);
  });

  it("flags a metric or quote that points at no claim", () => {
    const content = base({
      sections: [
        { type: "results", title: "R", metrics: [{ label: "L", value: "40", claimId: "ghost" }] },
        { type: "quote", title: "Q", quote: { text: "x", attribution: "a", claimId: "ghost" } },
      ],
    });
    expect(verifyContent(content, claims).map((i) => i.kind)).toEqual(["unknown_claim", "unknown_claim"]);
  });

  it("flags a paraphrased or altered quote", () => {
    const content = base({ sections: [{ type: "quote", title: "Q", quote: { text: "We slashed onboarding time", attribution: "a", claimId: "c1" } }] });
    expect(verifyContent(content, claims)).toMatchObject([{ kind: "quote_mismatch" }]);
  });

  it.each([
    ["headline", { headline: "Saved $1M in 90 days" }],
    ["a title", { sections: [{ type: "results", title: "A 999% jump", body: "ok" }] }],
    ["a body", { sections: [{ type: "results", title: "R", body: "Revenue grew 25% overall." }] }],
    ["a label", { sections: [{ type: "results", title: "R", metrics: [{ label: "Up 7x", value: "40", claimId: "c1" }] }] }],
    ["a tag", { tags: ["top 10"] }],
  ])("flags an unsupported number in %s", (_where, overrides) => {
    const issues = verifyContent(base(overrides as Partial<CaseStudyContent>), claims);
    expect(issues.some((i) => i.kind === "loose_number"), JSON.stringify(issues)).toBe(true);
  });

  it("allows numbers the client said anywhere in the story, in any claim", () => {
    const content = base({ headline: "From 1,200 tickets to 300", sections: [{ type: "results", title: "40 percent faster", body: "In March." }] });
    expect(verifyContent(content, claims)).toEqual([]);
  });
});

describe("findEditedClaims", () => {
  it("is empty for untouched content", () => {
    expect(findEditedClaims(base(), claims).size).toBe(0);
  });

  it("flags the claim when the owner changes a number or rewrites a quote", () => {
    const changedNumber = base({ sections: [{ type: "results", title: "R", metrics: [{ label: "L", value: "45 percent", claimId: "c1" }] }] });
    expect([...findEditedClaims(changedNumber, claims)]).toEqual(["c1"]);
    const changedQuote = base({ sections: [{ type: "quote", title: "Q", quote: { text: "It was a miracle", attribution: "a", claimId: "c2" } }] });
    expect([...findEditedClaims(changedQuote, claims)]).toEqual(["c2"]);
  });

  it("clears when the edit is reverted, and ignores wording changes that keep the numbers", () => {
    const reworded = base({ sections: [{ type: "results", title: "R", metrics: [{ label: "Time to onboard", value: "40", claimId: "c1" }] }] });
    expect(findEditedClaims(reworded, claims).size).toBe(0);
  });
});

describe("redactUnverified", () => {
  it("leaves a faithful draft untouched", () => {
    const content = base();
    expect(redactUnverified(content, claims)).toEqual(content);
  });

  it("removes fabricated metrics, quotes and numbers, and what remains verifies", () => {
    const bad = base({
      headline: "We saved $1M and grew 900%",
      sections: [
        { type: "results", title: "Results: 900% growth", body: "Revenue up 900%.", metrics: [{ label: "Growth", value: "900%", claimId: "c1" }, { label: "Onboarding", value: "40 percent", claimId: "c1" }] },
        { type: "quote", title: "Quote", quote: { text: "Best product ever, saved us $1M", attribution: "a", claimId: "c1" } },
      ],
      tags: ["900x", "onboarding"],
    });
    expect(verifyContent(bad, claims).length).toBeGreaterThan(0);

    const safe = redactUnverified(bad, claims);
    expect(verifyContent(safe, claims)).toEqual([]);
    expect(JSON.stringify(safe)).not.toMatch(/900|\$1M/);
    expect(safe.sections[0].metrics).toEqual([{ label: "Onboarding", value: "40 percent", claimId: "c1" }]);
    expect(safe.sections[1].quote).toBeUndefined();
    expect(safe.tags).toEqual(["onboarding"]);
    expect(safe.headline).toBe("Customer story");
  });

  it("always produces content that passes verification, however hostile the draft", () => {
    const numbers = ["1", "40", "999", "3.5", "1,200", "7"];
    let seed = 12345;
    const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const text = () => `${["Grew", "Saved", "Up", "Cut"][rand(4)]} ${numbers[rand(numbers.length)]} ${["x", "percent", "hours"][rand(3)]}`;

    for (let i = 0; i < 300; i++) {
      const draft = caseStudyContentSchema.parse({
        headline: text(),
        client: {},
        sections: Array.from({ length: 1 + rand(4) }, () => ({
          type: (["challenge", "results", "quote"] as const)[rand(3)],
          title: text(),
          ...(rand(2) ? { body: text() } : {}),
          ...(rand(2) ? { metrics: [{ label: text(), value: text(), claimId: ["c1", "c2", "nope"][rand(3)] }] } : {}),
          ...(rand(2) ? { quote: { text: [MESSAGE.slice(0, 20), text(), "We cut onboarding"][rand(3)], attribution: "a", claimId: ["c1", "c2", "nope"][rand(3)] } } : {}),
        })),
        tags: [text(), "ok"],
      });
      const issues = verifyContent(redactUnverified(draft, claims), claims);
      expect(issues, `draft ${i}: ${JSON.stringify(draft)}`).toEqual([]);
    }
  });
});
