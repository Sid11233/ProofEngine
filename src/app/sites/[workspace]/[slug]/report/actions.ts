"use server";

import { handleReport, type ReportResult } from "@/lib/takedown/server";

/** Public. Strict zod validation, rate limits, Turnstile and the insert-only database function live in handleReport. */
export async function reportAction(input: unknown): Promise<ReportResult> {
  return handleReport(input);
}
