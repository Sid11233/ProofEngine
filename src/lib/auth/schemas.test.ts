import { describe, expect, it } from "vitest";
import { forgotPasswordSchema, loginSchema, mfaCodeSchema, otpTypeSchema, resetPasswordSchema, signupSchema } from "./schemas";
import { fieldErrorsOf, formDataToObject } from "@/lib/validation/form";

const goodPassword = "correct-horse-battery";

describe("signupSchema", () => {
  it("normalises the email and trims the name", () => {
    const parsed = signupSchema.parse({ fullName: "  Ada Lovelace ", email: "  ADA@Example.COM ", password: goodPassword });
    expect(parsed).toEqual({ fullName: "Ada Lovelace", email: "ada@example.com", password: goodPassword });
  });

  it("enforces a 12 to 72 character password", () => {
    const base = { fullName: "Ada", email: "ada@example.com" };
    expect(signupSchema.safeParse({ ...base, password: "short-pass1" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "a".repeat(12) }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, password: "a".repeat(73) }).success).toBe(false);
  });

  it("rejects unknown fields instead of ignoring them", () => {
    const result = signupSchema.safeParse({ fullName: "Ada", email: "ada@example.com", password: goodPassword, role: "owner" });
    expect(result.success).toBe(false);
  });

  it.each(["not-an-email", "a@b", "a b@example.com", "", `${"a".repeat(250)}@example.com`])("rejects the email %j", (email) => {
    expect(signupSchema.safeParse({ fullName: "Ada", email, password: goodPassword }).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("does not apply the signup password policy, so it leaks nothing about it", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "x" }).success).toBe(true);
  });

  it("bounds the next parameter", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "x", next: "/".padEnd(600, "a") }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires the two passwords to match", () => {
    const result = resetPasswordSchema.safeParse({ password: goodPassword, confirmPassword: "different-password!" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsOf(result.error).confirmPassword).toEqual(["Passwords do not match"]);
  });
});

describe("other schemas", () => {
  it("forgot-password only takes an email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@example.com", extra: 1 }).success).toBe(false);
  });

  it("MFA codes are exactly six digits", () => {
    expect(mfaCodeSchema.safeParse({ code: "123456" }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", "123 456", ""]) {
      expect(mfaCodeSchema.safeParse({ code }).success).toBe(false);
    }
  });

  it("only known email OTP types are accepted", () => {
    expect(otpTypeSchema.safeParse("recovery").success).toBe(true);
    expect(otpTypeSchema.safeParse("sms").success).toBe(false);
    expect(otpTypeSchema.safeParse(null).success).toBe(false);
  });
});

describe("formDataToObject", () => {
  it("keeps only the named string fields, dropping framework and attacker-supplied extras", () => {
    const form = new FormData();
    form.set("email", "a@example.com");
    form.set("password", "pw");
    form.set("$ACTION_ID_abc", "x");
    form.set("role", "owner");
    form.set("upload", new Blob(["x"]), "file.txt");
    expect(formDataToObject(form, ["email", "password", "upload"])).toEqual({ email: "a@example.com", password: "pw" });
  });
});

describe("password reset bounds (audit L4)", () => {
  it("rejects an enormous confirmation field instead of comparing it", () => {
    const password = "Correct-horse-battery-9";
    expect(resetPasswordSchema.safeParse({ password, confirmPassword: password }).success).toBe(true);
    const huge = resetPasswordSchema.safeParse({ password, confirmPassword: "x".repeat(100_000) });
    expect(huge.success).toBe(false);
    // Refused for its size up front, not merely for not matching.
    expect(huge.success ? [] : huge.error.issues.filter((i) => i.code === "too_big" && i.path[0] === "confirmPassword")).toHaveLength(1);
    expect(resetPasswordSchema.safeParse({ password, confirmPassword: password, extra: 1 }).success).toBe(false);
  });
});

