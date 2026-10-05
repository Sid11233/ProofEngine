import { describe, expect, it } from "vitest";
import { createRequestSchema } from "@/lib/requests/schemas";
import { onboardingSchema } from "@/lib/workspace/schemas";
import { signupSchema } from "@/lib/auth/schemas";
import { cleanLine, plainLine } from "./text";

describe("cleanLine", () => {
  it.each([
    ["Acme\r\nBcc: attacker@evil.example", "Acme Bcc: attacker@evil.example"],
    ["Acme\u0000Co", "Acme Co"],
    ["ad​min", "ad min"],
    ["‮evil‬", "evil"],
    ["  many   spaces\t\there ", "many spaces here"],
    ["tab\nnewline", "tab newline"],
  ])("%j -> %j", (input, expected) => expect(cleanLine(input)).toBe(expected));

  it("leaves ordinary text, accents and emoji alone", () => {
    expect(cleanLine("Café Müller 🚀 & Sons")).toBe("Café Müller 🚀 & Sons");
  });
});

describe("plainLine", () => {
  it("applies the length limit after cleaning", () => {
    expect(plainLine(5).safeParse("abcdef").success).toBe(false);
    expect(plainLine(5).safeParse("a​bcd").success).toBe(true);
  });

  it("requires something visible when min is set", () => {
    expect(plainLine(10, { min: 1 }).safeParse("​\u0000  ").success).toBe(false);
  });
});

describe("fields that end up in emails cannot carry line breaks", () => {
  it("workspace name, client name and signup name are single clean lines", () => {
    const ws = onboardingSchema.parse({ type: "agency", name: "Acme\r\nBcc: x@evil.example", niche: "n", audience: "a", website: "", description: "d" });
    expect(ws.name).not.toMatch(/[\r\n]/);
    const req = createRequestSchema.parse({ clientName: "Dana\r\nSubject: spoof", clientEmail: "d@example.test", flowType: "agency", tone: "friendly" });
    expect(req.clientName).not.toMatch(/[\r\n]/);
    const su = signupSchema.parse({ fullName: "Eve\u0000\r\nX", email: "e@example.test", password: "a-long-enough-password" });
    expect(su.fullName).not.toMatch(/[\r\n\u0000]/);
  });
});
