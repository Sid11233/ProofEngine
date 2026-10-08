import { describe, expect, it } from "vitest";
import { normaliseQuestions, questionListSchema } from "./flow";
import { decideMode } from "@/lib/ai/interviewer";
import { thankYouEmail, ownerAlertEmail } from "@/lib/interview/notify";
import { reminderEmail } from "@/lib/reminders/run";
import { consentFor } from "@/lib/interview/consent";

const q = (over: Record<string, unknown> = {}) => ({ id: "a1", text: "What do you do?", ...over });

describe("onboarding question list", () => {
  it("accepts 1 to 12 questions, with unique ids and text of 3 to 300 characters", () => {
    expect(questionListSchema.safeParse([q()]).success).toBe(true);
    expect(questionListSchema.safeParse([]).success).toBe(false);
    expect(questionListSchema.safeParse(Array.from({ length: 13 }, (_, i) => q({ id: `a${i}` }))).success).toBe(false);
    expect(questionListSchema.safeParse(Array.from({ length: 12 }, (_, i) => q({ id: `a${i}` }))).success).toBe(true);
    expect(questionListSchema.safeParse([q(), q()]).success).toBe(false);
    expect(questionListSchema.safeParse([q({ text: "ab" })]).success).toBe(false);
    expect(questionListSchema.safeParse([q({ text: "x".repeat(301) })]).success).toBe(false);
  });
  it("rejects unknown fields, bad ids and bad keys; strips control characters", () => {
    for (const bad of [{ extra: 1 }, { id: "Has Space" }, { id: "../x" }, { id: "a".repeat(13) }, { key: "results" }]) expect(questionListSchema.safeParse([q(bad)]).success, JSON.stringify(bad)).toBe(false);
    expect(questionListSchema.parse([q({ text: "Hello\u200b there?" })])[0].text).not.toMatch(/[\u0000\u200b]/);
  });
  it("standard questions with story keys become open questions; only 'short' is kept", () => {
    expect(normaliseQuestions([{ id: "o1", text: "x", key: "about" }, { id: "o5", text: "y", key: "short" }, { nope: 1 }, "str"])).toEqual([{ id: "o1", text: "x" }, { id: "o5", text: "y", key: "short" }]);
    expect(normaliseQuestions("nope")).toEqual([]);
  });
});

describe("onboarding behaviour", () => {
  it("short questions are never probed, open thin answers are", () => {
    expect(decideMode("short", "yes", 0)).toBe("advance");
    expect(decideMode("", "yes", 0)).toBe("probe");
    expect(decideMode("", "yes", 2)).toBe("advance");
  });
  it("uses its own consent text, version and emails", () => {
    expect(consentFor("onboarding").version).not.toBe(consentFor("review").version);
    expect(consentFor("onboarding").text).not.toMatch(/case study/i);
    expect(thankYouEmail({ firstName: "Dana", workspaceName: "Acme", unsubscribe: "u", purpose: "onboarding" }).text).not.toMatch(/case study|approved/i);
    expect(ownerAlertEmail({ workspaceName: "Acme", link: "l", purpose: "onboarding" }).subject).toContain("onboarding");
    const r = reminderEmail({ clientName: "Dana", workspaceName: "Acme", link: "l", unsubscribeLink: "u", number: 1, purpose: "onboarding" });
    expect(r.text).toContain("onboarding questions");
    expect(r.text).toContain("Stop them here: u");
  });
});
