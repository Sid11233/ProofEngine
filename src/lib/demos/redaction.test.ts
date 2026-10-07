import { describe, expect, it } from "vitest";
import { findSensitive, scanDemoText } from "./redaction";
import { demoContentSchema } from "./schema";

describe("findSensitive", () => {
  it("spots emails, phones, cards, keys and IPs", () => {
    expect(findSensitive("mail jane.doe@acme.com now")).toEqual(["email"]);
    expect(findSensitive("call +1 (415) 555-0132")).toContain("phone");
    expect(findSensitive("card 4242 4242 4242 4242")).toEqual(["card"]);
    expect(findSensitive("key sk_live_abcdefghijklmnop1234")).toContain("secret");
    expect(findSensitive("token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdef12345")).toContain("secret");
    expect(findSensitive("AKIAIOSFODNN7EXAMPLE")).toContain("secret");
    expect(findSensitive("server 192.168.1.20")).toContain("ip");
  });
  it("leaves ordinary text and non-card numbers alone", () => {
    expect(findSensitive("Saved 38% and 1,200 hours in 2025")).toEqual([]);
    expect(findSensitive("Order 1234 5678 9012 3456")).not.toContain("card"); // fails the Luhn check
    expect(findSensitive("version 1.2.3")).toEqual([]);
  });
});

describe("scanDemoText", () => {
  it("reports where, and what kind, but not the text", () => {
    const content = demoContentSchema.parse({ scenes: [{ id: "c1", type: "chat", persona: { name: "Ava", role: "x" }, messages: [{ from: "user", text: "me@x.com", delayMs: 0 }], choices: [] }] });
    expect(scanDemoText(content)).toEqual([{ path: "scenes.0.messages.0", kinds: ["email"] }]);
  });
});
