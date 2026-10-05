import { isIP } from "node:net";
import { z } from "zod";
import { plainLine } from "@/lib/validation/text";

/** https only, no credentials, a real hostname (not an IP or localhost). Stored normalised. */
const websiteSchema = z
  .string()
  .trim()
  .max(2048, "That address is too long")
  .transform((value, ctx) => {
    if (value === "") return undefined;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a full address starting with https://" });
      return z.NEVER;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ok =
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      host.includes(".") &&
      isIP(host) === 0 &&
      !host.endsWith(".local") &&
      !host.endsWith(".internal");
    if (!ok) {
      ctx.addIssue({ code: "custom", message: "Enter a public https:// address, for example https://acme.com" });
      return z.NEVER;
    }
    return url.href;
  });

export const businessTypeSchema = z.enum(["agency", "saas"]);

export const onboardingSchema = z
  .object({
    type: businessTypeSchema,
    name: plainLine(100, { min: 1 }, "Enter your business name"),
    niche: plainLine(100, { min: 1 }, "Tell us your niche"),
    audience: plainLine(200, { min: 1 }, "Tell us who you serve"),
    website: websiteSchema,
    description: plainLine(300, { min: 1 }, "Add a one-line description"),
  })
  .strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;
