import { z } from "zod";

/** The hostname of a referring page, lower-case, or null for anything that is not a plain http(s) URL. */
export function referrerHost(raw: string | undefined | null): string | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

export const EVENT_TYPES = ["view", "cta_click", "referral_click"] as const;

/** What the page's beacon sends. `referrer` is the raw document.referrer; only its hostname is kept. */
export const eventSchema = z
  .object({
    type: z.enum(EVENT_TYPES),
    referrer: z.string().max(2048).optional(),
  })
  .strict();

export type PageEvent = z.infer<typeof eventSchema>;
