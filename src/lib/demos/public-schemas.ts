import { z } from "zod";
import { plainLine } from "@/lib/validation/text";

// What the public demo page may send. Strict: unknown fields are rejected.

export const DEMO_EVENT_TYPES = ["view", "step", "complete", "cta_click"] as const;

export const demoEventSchema = z
  .object({ type: z.enum(DEMO_EVENT_TYPES), step: z.number().int().min(0).max(200).optional() })
  .strict()
  .refine((e) => e.type === "step" || e.step === undefined, "step is only for step events");

export const leadSchema = z
  .object({
    email: plainLine(320, { min: 3 }, "Enter your email").pipe(z.email("Enter a valid email")),
    name: plainLine(200).optional(),
    consent: z.literal(true, "Please tick the box to continue"),
    step_reached: z.number().int().min(0).max(200).optional(),
    // A honeypot: people never see it, so a filled value means a bot.
    company: z.string().max(0).optional(),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict();

export const CONSENT_VERSION = "demo-lead-v1";
/** Shown next to the tick box. Lives in code and in consent_texts under CONSENT_VERSION; both are placeholders until a lawyer reviews them. */
export const CONSENT_LABEL = "I agree that the business that made this demo may store my name and email address and contact me about it. I can ask them to delete my details at any time.";

export type DemoEventInput = z.infer<typeof demoEventSchema>;
export type LeadInput = z.infer<typeof leadSchema>;
