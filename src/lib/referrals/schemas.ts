import { z } from "zod";
import { plainLine } from "@/lib/validation/text";

// A referral typed by a client on the closing screen: a name and one way to reach the person. It is stored
// and shown as text, and the person is never contacted automatically.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?\(?[0-9][0-9 ().-]{5,24}$/;

/** True for something that looks like an email address or a phone number. */
export const isReachable = (value: string) => EMAIL.test(value) || (PHONE.test(value) && value.replace(/\D/g, "").length >= 7);

export const referralSchema = z
  .object({
    name: plainLine(200, { min: 1 }, "Enter their name"),
    contact: plainLine(320, { min: 1 }, "Enter an email or phone number").refine(isReachable, "Enter a valid email or phone number"),
  })
  .strict();

export type ReferralInput = z.infer<typeof referralSchema>;

export const REFERRAL_STATUSES = ["new", "contacted", "won", "dismissed"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
export const referralStatusSchema = z.object({ id: z.uuid(), status: z.enum(REFERRAL_STATUSES) }).strict();
