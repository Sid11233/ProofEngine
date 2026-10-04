import { z } from "zod";

// Every schema is strict: unknown fields are rejected, never silently kept.

export const emailSchema = z.string().trim().toLowerCase().max(254, "Email is too long").pipe(z.email("Enter a valid email address"));

// GoTrue hashes with bcrypt, which ignores everything past 72 bytes.
export const newPasswordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(72, "Use at most 72 characters");

const nextSchema = z.string().max(512).optional();

export const loginSchema = z
  .object({
    email: emailSchema,
    // No length rule on login: it must not leak the password policy or lock out older accounts.
    password: z.string().min(1, "Enter your password").max(72),
    next: nextSchema,
  })
  .strict();

export const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your name").max(100, "Name is too long"),
    email: emailSchema,
    password: newPasswordSchema,
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const mfaCodeSchema = z
  .object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"), next: nextSchema })
  .strict();

// Supabase email OTP types we accept on /auth/confirm.
export const otpTypeSchema = z.enum(["signup", "recovery", "email", "magiclink", "invite", "email_change"]);
