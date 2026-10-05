import { describe, expect, it } from "vitest";
import { referralEmail } from "./notify";
import { isReachable, referralSchema } from "./schemas";

describe("referral input", () => {
  it("accepts an email or a phone number and cleans the name", () => {
    expect(referralSchema.parse({ name: "  Sam‮  Lee ", contact: "sam@example.com" })).toEqual({ name: "Sam Lee", contact: "sam@example.com" });
    expect(referralSchema.safeParse({ name: "Sam", contact: "+44 20 7946 0958" }).success).toBe(true);
    expect(referralSchema.safeParse({ name: "Sam", contact: "(555) 123-4567" }).success).toBe(true);
  });
  it("rejects anything that is not a way to reach someone, and unknown fields", () => {
    for (const contact of ["", "just words", "12", "sam@", "javascript:alert(1)", "a@b.c", "sam@example.com\nbcc:x@y.com"]) {
      expect(referralSchema.safeParse({ name: "Sam", contact }).success, contact).toBe(false);
    }
    expect(referralSchema.safeParse({ name: "Sam", contact: "sam@example.com", extra: 1 }).success).toBe(false);
    expect(referralSchema.safeParse({ name: "", contact: "sam@example.com" }).success).toBe(false);
    expect(isReachable("x@y.io")).toBe(true);
  });
});

describe("referralEmail", () => {
  it("lists the people, says nobody was contacted, and links to the app", () => {
    const m = referralEmail({ workspaceName: "Acme", referrals: [{ name: "Sam", contact: "sam@example.com" }, { name: "Lee", contact: "+1 555 123 4567" }], link: "https://app.example.com/app/referrals" });
    expect(m.subject).toBe("A client referred 2 people to Acme");
    expect(m.text).toContain("1. Sam (sam@example.com)");
    expect(m.text).toContain("We have not contacted them");
    expect(m.text).toContain("https://app.example.com/app/referrals");
  });
});
