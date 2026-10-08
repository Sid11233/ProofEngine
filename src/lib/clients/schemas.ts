import { z } from "zod";
import { emailSchema } from "@/lib/auth/schemas";
import { cleanParagraph } from "@/lib/takedown/schemas";
import { plainLine } from "@/lib/validation/text";

// Everything the owner types about a client or a project. It is untrusted text: stored as plain text, shown as
// text, and never treated as an instruction. Links are https only and are rendered with rel="noopener noreferrer".

const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const httpsUrl = z
  .string()
  .trim()
  .max(300, "Keep it under 300 characters")
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new Error("bad");
      return url.href;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full https:// address" });
      return z.NEVER;
    }
  });

const REPO_HOSTS = ["github.com", "www.github.com", "gitlab.com", "www.gitlab.com", "bitbucket.org", "www.bitbucket.org"];
const repoUrl = httpsUrl.refine((href) => REPO_HOSTS.includes(new URL(href).hostname) && new URL(href).pathname.length > 1, "Use a github.com, gitlab.com or bitbucket.org link");

const paragraph = (max: number) => z.string().transform(cleanParagraph).pipe(z.string().max(max, `Keep it under ${max} characters`));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker").refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v); }, "Not a real date");

export const CLIENT_STATUSES = ["active", "paused", "finished"] as const;
export const PROJECT_STATUSES = ["planning", "in_progress", "delivered"] as const;
export const LINK_KINDS = ["website", "repo", "design", "docs", "other"] as const;
export const FEEDBACK_SOURCES = ["client", "team"] as const;

export const clientSchema = z
  .object({
    name: plainLine(200, { min: 1 }, "Enter the client's name"),
    contact_name: blank(plainLine(200)),
    contact_email: blank(emailSchema),
    website_url: blank(httpsUrl),
    status: z.enum(CLIENT_STATUSES).default("active"),
    notes: blank(paragraph(2000)),
  })
  .strict();

export const projectSchema = z
  .object({
    name: plainLine(200, { min: 1 }, "Enter the project's name"),
    summary: blank(paragraph(2000)),
    key_facts: blank(paragraph(1500)),
    status: z.enum(PROJECT_STATUSES).default("in_progress"),
    website_url: blank(httpsUrl),
    repo_url: blank(repoUrl),
    notes: blank(paragraph(4000)),
    started_on: blank(date),
    delivered_on: blank(date),
  })
  .strict()
  .refine((p) => !p.started_on || !p.delivered_on || p.delivered_on >= p.started_on, { message: "Delivered before it started?", path: ["delivered_on"] });

export const linkSchema = z.object({ label: plainLine(80, { min: 1 }, "Enter a label"), url: httpsUrl, kind: z.enum(LINK_KINDS).default("other") }).strict();

export const feedbackSchema = z
  .object({
    source: z.enum(FEEDBACK_SOURCES).default("client"),
    author_name: blank(plainLine(120)),
    body: z.string().transform(cleanParagraph).pipe(z.string().min(1, "Enter the feedback").max(2000, "Keep it under 2000 characters")),
  })
  .strict();

export const idSchema = z.uuid();

export type ClientInput = z.infer<typeof clientSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type LinkInput = z.infer<typeof linkSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
