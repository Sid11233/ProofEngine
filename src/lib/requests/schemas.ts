import { z } from "zod";
import { emailSchema } from "@/lib/auth/schemas";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const TONES = ["friendly", "professional", "casual"] as const;

export const createRequestSchema = z
  .object({
    clientName: z.string().trim().min(1, "Enter the client's name").max(200, "Keep it under 200 characters"),
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

export const requestIdSchema = z.uuid();

export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const focusOutcomesOf = (input: Pick<CreateRequestInput, "outcome1" | "outcome2" | "outcome3">): string[] =>
  [input.outcome1, input.outcome2, input.outcome3].filter((value): value is string => Boolean(value));
