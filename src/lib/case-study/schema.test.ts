import { describe, expect, it } from "vitest";
import { caseStudyContentSchema, looksLikeHtml } from "./schema";

const valid = {
  headline: "Cutting onboarding time",
  client: { name: "Taylor" },
  sections: [
    { type: "challenge", title: "The challenge", body: "Onboarding was slow." },
    { type: "results", title: "Results", metrics: [{ label: "Onboarding time", value: "40%", claimId: "c1" }] },
    { type: "quote", title: "In their words", quote: { text: "It was much faster", attribution: "Taylor", claimId: "c2" } },
  ],
  tags: ["onboarding"],
};

const withHeadline = (headline: string) => caseStudyContentSchema.safeParse({ ...valid, headline });

describe("caseStudyContentSchema", () => {
  it("accepts a well-formed case study", () => {
    expect(caseStudyContentSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "Hello <b>world</b>",
    "<!-- comment -->",
    "<?php echo 1 ?>",
    "</div>",
    "a <a href='javascript:alert(1)'>click</a>",
    "x<svg/onload=alert(1)>",
  ])("rejects markup in any text field: %s", (payload) => {
    expect(withHeadline(payload).success).toBe(false);
    const inBody = { ...valid, sections: [{ type: "challenge", title: "T", body: payload }] };
    expect(caseStudyContentSchema.safeParse(inBody).success).toBe(false);
    const inMetric = { ...valid, sections: [{ type: "results", title: "T", metrics: [{ label: payload, value: "1", claimId: "c" }] }] };
    expect(caseStudyContentSchema.safeParse(inMetric).success).toBe(false);
    const inQuote = { ...valid, sections: [{ type: "quote", title: "T", quote: { text: payload, attribution: "A", claimId: "c" } }] };
    expect(caseStudyContentSchema.safeParse(inQuote).success).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, tags: [payload] }).success).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, client: { name: payload } }).success).toBe(false);
  });

  it("allows ordinary comparisons and symbols that are not markup", () => {
    expect(withHeadline("Under 5 days, saving > 20% of time & money").success).toBe(true);
    expect(looksLikeHtml("3 < 5")).toBe(false);
    expect(looksLikeHtml("a<b")).toBe(true);
  });

  it("strips control, zero-width and bidi characters", () => {
    const parsed = caseStudyContentSchema.parse({ ...valid, headline: "Fast\u0000 on​boarding‮" });
    expect(parsed.headline).toBe("Fast onboarding");
  });

  it("hides markup split by an invisible character from the check only if the stripped text is clean", () => {
    // "<" + zero-width + "script": after stripping this becomes real markup, so it must be rejected.
    expect(withHeadline("<​script>alert(1)</script>").success).toBe(false);
  });

  it("enforces max lengths on every string", () => {
    expect(withHeadline("x".repeat(121)).success).toBe(false);
    expect(withHeadline("x".repeat(120)).success).toBe(true);
    const long = (section: object) => caseStudyContentSchema.safeParse({ ...valid, sections: [section] }).success;
    expect(long({ type: "challenge", title: "t".repeat(121) })).toBe(false);
    expect(long({ type: "challenge", title: "t", body: "b".repeat(2001) })).toBe(false);
    expect(long({ type: "quote", title: "t", quote: { text: "q".repeat(501), attribution: "a", claimId: "c" } })).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, tags: new Array(11).fill("t") }).success).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: new Array(13).fill(valid.sections[0]) }).success).toBe(false);
  });

  it("requires every metric and quote to carry a claimId", () => {
    const metric = { type: "results", title: "T", metrics: [{ label: "L", value: "1" }] };
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: [metric] }).success).toBe(false);
    const quote = { type: "quote", title: "T", quote: { text: "x", attribution: "a" } };
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: [quote] }).success).toBe(false);
    const empty = { type: "results", title: "T", metrics: [{ label: "L", value: "1", claimId: "" }] };
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: [empty] }).success).toBe(false);
  });

  it("rejects unknown fields and section types", () => {
    expect(caseStudyContentSchema.safeParse({ ...valid, html: "<p>x</p>" }).success).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: [{ type: "banner", title: "t" }] }).success).toBe(false);
    expect(caseStudyContentSchema.safeParse({ ...valid, sections: [{ type: "challenge", title: "t", style: "x" }] }).success).toBe(false);
  });

  it("rejects non-object and missing parts", () => {
    for (const input of [null, "x", 5, [], {}, { headline: "x" }]) expect(caseStudyContentSchema.safeParse(input).success).toBe(false);
  });
});
