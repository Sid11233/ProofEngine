import { describe, expect, it } from "vitest";
import { cleanParagraph, reportSchema } from "./schemas";

const ok = { workspace: "acme-studio", slug: "big-win", reason: "This is my company and I did not agree to this.", email: "me@example.com" };

describe("cleanParagraph", () => {
  it("keeps line breaks but strips control, zero-width and bidi characters", () => {
    expect(cleanParagraph("a\u0000b‮c\r\nd\n\n\n\ne​f")).toBe("abc\nd\n\ne" + "f");
  });
});

describe("reportSchema", () => {
  it("accepts a normal report and normalises it", () => {
    const parsed = reportSchema.parse({ ...ok, reason: "  Please remove\r\nthis page now.  ", email: " Me@Example.com " });
    expect(parsed.reason).toBe("Please remove\nthis page now.");
    expect(parsed.email).toBe("Me@Example.com");
  });
  it("rejects unknown fields, bad names, short reasons and bad emails", () => {
    for (const bad of [{ ...ok, extra: 1 }, { ...ok, workspace: "../x" }, { ...ok, slug: "A B" }, { ...ok, reason: "short" }, { ...ok, reason: "x".repeat(2001) }, { ...ok, email: "nope" }, { ...ok, email: "a@b.com\nbcc:x@y.com" }]) {
      expect(reportSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});
