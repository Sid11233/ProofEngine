import { z } from "zod";
import { CONSENT_VERSION } from "./consent";

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const startSchema = z
  .object({ token: tokenSchema, consent: z.literal(true), consentVersion: z.literal(CONSENT_VERSION) })
  .strict();

export const messageSchema = z
  .object({ token: tokenSchema, message: z.string().trim().min(1, "Write an answer first").max(1000, "Please keep answers under 1000 characters") })
  .strict();

const referralSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    contact: z.string().trim().min(1).max(320),
  })
  .strict();

export const finishSchema = z
  .object({
    token: tokenSchema,
    publishPermission: z.enum(["full", "first_name", "anonymous"]),
    referrals: z.array(referralSchema).max(3).default([]),
  })
  .strict();

export type FinishInput = z.infer<typeof finishSchema>;
