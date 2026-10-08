import { z } from "zod";
import { referralSchema } from "@/lib/referrals/schemas";
import { closingSchema } from "./closing";

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const startSchema = z
  .object({ token: tokenSchema, consent: z.literal(true), consentVersion: z.string().min(1).max(50), turnstileToken: z.string().max(2048).optional() })
  .strict();

export const messageSchema = z
  .object({ token: tokenSchema, message: z.string().trim().min(1, "Write an answer first").max(1000, "Please keep answers under 1000 characters"), voiceId: z.uuid().optional() })
  .strict();

export const finishSchema = z
  .object({
    token: tokenSchema,
    // Reviews need it; onboarding links ignore it (checked in finishInterview).
    publishPermission: z.enum(["full", "first_name", "anonymous"]).optional(),
    referrals: z.array(referralSchema).max(3).default([]),
    closing: closingSchema.optional(),
  })
  .strict();

export type FinishInput = z.infer<typeof finishSchema>;
