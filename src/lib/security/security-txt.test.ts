import { describe, expect, it } from "vitest";
import { SECURITY_CONTACT_PATTERN, securityTxt } from "./security-txt";

describe("securityTxt", () => {
  const now = new Date("2026-10-06T10:00:00.123Z");
  it("has the required Contact and Expires fields and a canonical URL", () => {
    const text = securityTxt({ contact: "mailto:security@example.com", appUrl: "https://app.example.com", now });
    expect(text).toContain("Contact: mailto:security@example.com\n");
    expect(text).toContain("Expires: 2027-04-04T10:00:00Z\n");
    expect(text).toContain("Canonical: https://app.example.com/.well-known/security.txt\n");
    expect(text.endsWith("\n")).toBe(true);
  });
  it("accepts only mailto and https contacts", () => {
    for (const ok of ["mailto:security@example.com", "https://example.com/security"]) expect(SECURITY_CONTACT_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["security@example.com", "http://example.com", "javascript:alert(1)", "mailto:a b@example.com", "https://example.com/x\nContact: evil"]) expect(SECURITY_CONTACT_PATTERN.test(bad), bad).toBe(false);
  });
});
