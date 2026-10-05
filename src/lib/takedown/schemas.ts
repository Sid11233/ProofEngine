import { z } from "zod";
import { cleanLine, plainLine } from "@/lib/validation/text";

// A report from a member of the public. Everything is untrusted: it is stored as plain text, shown as
// text, and put in plain-text emails only.

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Multi-line plain text: control, zero-width and bidi characters removed, line breaks kept (at most 2 in a row). */
export const cleanParagraph = (value: string) =>
  value.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const slugPart = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);

export const reportSchema = z
  .object({
    workspace: slugPart,
    slug: slugPart,
    reason: z.string().transform(cleanParagraph).pipe(z.string().min(10, "Please tell us a little more (at least 10 characters)").max(2000, "Keep it under 2000 characters")),
    email: plainLine(320, { min: 3 }, "Enter an email so we can reply").pipe(z.email("Enter a valid email")),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict();

export type ReportInput = z.infer<typeof reportSchema>;

export { cleanLine };
