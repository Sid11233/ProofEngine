import { z } from "zod";
import { emailSchema } from "@/lib/auth/schemas";
import { cleanParagraph } from "@/lib/takedown/schemas";
import { plainLine } from "@/lib/validation/text";

// The optional last-screen questions. Everything is untrusted text: stored as plain text, shown as text, and never
// sent to the AI. The email typed here is only ever displayed to the business; we never send mail to it.

const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());
const phone = plainLine(40).refine((v) => /^[0-9+()\-.\s]{5,40}$/.test(v), "Enter a phone number");

export const closingSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: blank(z.string().transform(cleanParagraph).pipe(z.string().max(1000, "Please keep it under 1000 characters"))),
    email: blank(emailSchema),
    phone: blank(phone),
    company: blank(plainLine(200)),
    jobTitle: blank(plainLine(120)),
  })
  .strict();

export type ClosingInput = z.infer<typeof closingSchema>;

export const hasClosing = (c: ClosingInput | undefined): c is ClosingInput => Boolean(c && Object.values(c).some((v) => v !== undefined));
