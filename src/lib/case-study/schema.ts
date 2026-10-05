import { z } from "zod";

// A case study is structured JSON, never HTML. Every string is length-limited, stripped of
// control characters, and rejected if it contains something that looks like a tag.

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const HTML_LIKE = /<[A-Za-z!/?]/;

/** True when text contains "<" followed by a letter (or `!`, `/`, `?`), i.e. markup. */
export const looksLikeHtml = (text: string) => HTML_LIKE.test(text);

const safeText = (max: number, { min = 0 }: { min?: number } = {}) =>
  z
    .string()
    .transform((value) => value.replace(CONTROL_CHARS, "").trim())
    .pipe(
      z
        .string()
        .min(min, min > 0 ? "Required" : undefined)
        .max(max, `Keep it under ${max} characters`)
        .refine((value) => !looksLikeHtml(value), "HTML is not allowed"),
    );

export const SECTION_TYPES = ["challenge", "trigger", "solution", "results", "quote", "audience", "cta"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const claimId = z.string().min(1).max(64);

export const metricSchema = z.object({ label: safeText(80, { min: 1 }), value: safeText(40, { min: 1 }), claimId }).strict();
export const quoteSchema = z.object({ text: safeText(500, { min: 1 }), attribution: safeText(120), claimId }).strict();

export const sectionSchema = z
  .object({
    type: z.enum(SECTION_TYPES),
    title: safeText(120, { min: 1 }),
    body: safeText(2000).optional(),
    metrics: z.array(metricSchema).max(8).optional(),
    quote: quoteSchema.optional(),
  })
  .strict();

export const caseStudyContentSchema = z
  .object({
    headline: safeText(120, { min: 1 }),
    client: z
      .object({ name: safeText(120).optional(), company: safeText(120).optional(), role: safeText(120).optional(), logoPath: safeText(300).optional() })
      .strict(),
    sections: z.array(sectionSchema).max(12),
    tags: z.array(safeText(40, { min: 1 })).max(10),
  })
  .strict();

export type CaseStudyContent = z.infer<typeof caseStudyContentSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Metric = z.infer<typeof metricSchema>;
