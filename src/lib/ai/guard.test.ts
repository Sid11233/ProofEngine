import { describe, expect, it } from "vitest";
import { validateModelText } from "./guard";

const answer = "We cut onboarding time by 40 percent and grew 3x in 6 months.";

describe("validateModelText: acknowledgements", () => {
  it("accepts a short plain acknowledgement", () => {
    expect(validateModelText("Thanks, that is really helpful.", answer, "advance")).toBe("Thanks, that is really helpful.");
  });

  it("accepts numbers the client actually said", () => {
    expect(validateModelText("A 40 percent drop in 6 months is great to hear.", answer, "advance")).not.toBeNull();
  });

  it.each([
    ["an invented number", "That is a huge 90 percent gain."],
    ["an invented dollar figure", "Saving $1M is impressive."],
    ["a currency symbol the client never used", "Saving €5 is nice."],
    ["a link", "See https://evil.example for more."],
    ["a bare domain", "Visit evil.com today."],
    ["an email address", "Write to boss@evil.example please."],
    ["markup", "<b>Great</b> answer."],
    ["markdown emphasis", "That is **great** news."],
    ["a list", "- first point"],
    ["talk of its instructions", "My instructions say to be nice."],
    ["a system prompt mention", "I cannot share the system prompt."],
    ["the wrapper tag name", "The client_answer says thanks."],
    ["an extra question", "Thanks. Anything else?"],
    ["too long", "x".repeat(400)],
    ["nothing", "   "],
  ])("rejects %s", (_label, text) => {
    expect(validateModelText(text, answer, "advance")).toBeNull();
  });
});

describe("validateModelText: probes", () => {
  it("accepts exactly one short question", () => {
    expect(validateModelText("Could you say more about how onboarding changed?", answer, "probe")).not.toBeNull();
  });

  it.each(["Thanks for sharing.", "What changed? And why?", "Tell me more", "Was it 90 percent?"])("rejects %j", (text) => {
    expect(validateModelText(text, answer, "probe")).toBeNull();
  });
});

describe("validateModelText: cleaning", () => {
  it("strips wrapping quotes and collapses whitespace", () => {
    expect(validateModelText('"Thanks   for\n sharing."', answer, "advance")).toBe("Thanks for sharing.");
  });
});
