import { z } from "zod";

// Widget settings. The origins become the embed page's CSP frame-ancestors, so each one is parsed
// down to a bare https origin (no path, query, credentials or wildcard) before it is stored.

export const MAX_ORIGINS = 10;

/** "https://Example.com/anything" -> "https://example.com"; null when it is not a plain https site. */
export function normaliseOrigin(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 255 || /[\s*;,'"<>]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(url.hostname) || !url.hostname.includes(".")) return null;
  return url.origin;
}

/** One origin per line. Returns the clean list or the first line that is not acceptable. */
export function parseOrigins(text: string): { ok: true; origins: string[] } | { ok: false; bad: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const origins: string[] = [];
  for (const line of lines) {
    const origin = normaliseOrigin(line);
    if (!origin) return { ok: false, bad: line.slice(0, 60) };
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { ok: true, origins };
}

export const wallSettingsSchema = z
  .object({
    enabled: z.boolean(),
    origins: z.array(z.string()).max(MAX_ORIGINS, `At most ${MAX_ORIGINS} sites`),
    layout: z.enum(["grid", "list"]),
    maxItems: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((v) => !v.enabled || v.origins.length > 0, { message: "Add at least one site before turning the widget on", path: ["origins"] });

export type WallSettings = z.infer<typeof wallSettingsSchema>;
