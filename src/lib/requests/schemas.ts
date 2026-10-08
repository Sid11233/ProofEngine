import { z } from "zod";
import { plainLine } from "@/lib/validation/text";
import { emailSchema } from "@/lib/auth/schemas";

const optionalText = (max: number) =>
  plainLine(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const TONES = ["friendly", "professional", "casual"] as const;

export const createRequestSchema = z
  .object({
    clientName: plainLine(200, { min: 1 }, "Enter the client's name"),
    clientEmail: emailSchema,
    projectType: optionalText(200),
    flowType: z.enum(["agency", "saas"]),
    outcome1: optionalText(100),
    outcome2: optionalText(100),
    outcome3: optionalText(100),
    tone: z.enum(TONES).default("friendly"),
    sendNow: z.enum(["on"]).optional(),
  })
  .strict();

export const createOnboardingSchema = z
  .object({
    clientName: plainLine(200, { min: 1 }, "Enter the client's name"),
    clientEmail: emailSchema,
    clientId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
    sendNow: z.enum(["on"]).optional(),
  })
  .strict();

export const requestIdSchema = z.uuid();

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type CreateOnboardingInput = z.infer<typeof createOnboardingSchema>;

export const focusOutcomesOf = (input: Pick<CreateRequestInput, "outcome1" | "outcome2" | "outcome3">): string[] =>
  [input.outcome1, input.outcome2, input.outcome3].filter((value): value is string => Boolean(value));
