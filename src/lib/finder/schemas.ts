import { z } from "zod";

export const TRACKER_STATUSES = ["saved", "joined", "posted", "dropped"] as const;
export type TrackerStatus = (typeof TRACKER_STATUSES)[number];

// Notes are the user's own words: plain text, bounded, never rendered as markup.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
export const cleanNotes = (value: string) => value.replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/\n{3,}/g, "\n\n").trim();

export const trackerInputSchema = z
  .object({
    communityId: z.uuid(),
    status: z.enum(TRACKER_STATUSES),
    notes: z.string().transform(cleanNotes).pipe(z.string().max(2000, "Keep notes under 2000 characters")),
  })
  .strict();

export const removeTrackerSchema = z.object({ communityId: z.uuid() }).strict();

/** Only a plain https link is ever shown as a link. */
export function httpsLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
