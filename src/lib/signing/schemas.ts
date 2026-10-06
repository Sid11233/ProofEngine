import { z } from "zod";
import { plainLine } from "@/lib/validation/text";
import { isWellFormedCode } from "./code";

export const codeSchema = z.object({ code: z.string().refine(isWellFormedCode, "Enter the 6 digit code") }).strict();

/** Everything the signer submits. Unknown fields are rejected; the email is never part of it. */
export const signSchema = z
  .object({
    signerName: plainLine(200, { min: 2 }, "Enter your full name"),
    company: plainLine(200).optional(),
    role: plainLine(200).optional(),
    displayChoice: z.enum(["full", "first_only", "anonymous"]),
    esignDisclosure: z.literal(true),
    confirmAccuracy: z.literal(true),
    consentSocial: z.boolean(),
    consentMedia: z.boolean(),
    method: z.enum(["drawn", "typed"]),
    /** data:image/png;base64,... for a drawn signature. */
    signatureImage: z.string().max(400_000).optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.method === "typed" || typeof v.signatureImage === "string", { message: "Draw your signature or type your name", path: ["signatureImage"] });
export type SignInput = z.infer<typeof signSchema>;

export const changesSchema = z.object({ note: plainLine(1000, { min: 1 }, "Tell us what to change") }).strict();
