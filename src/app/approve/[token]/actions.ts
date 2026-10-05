"use server";

import { z } from "zod";
import { submitDecision } from "@/lib/case-study/approval-access";

export interface DecisionState {
  ok: boolean;
  message?: string;
  done?: "approved" | "changes" | "declined";
}

const MESSAGES = {
  not_found: "This link is no longer valid. It may have been used already, or the case study was changed. Please ask for a new link.",
  invalid: "That is not possible right now.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  bad_input: "Please check what you entered.",
} as const;

const tokenSchema = z.string().min(20).max(100);

/** Server action posted from the approval page. The token in the URL is the only credential. */
export async function decideAction(token: string, input: unknown): Promise<DecisionState> {
  if (!tokenSchema.safeParse(token).success) return { ok: false, message: MESSAGES.not_found };
  const result = await submitDecision(token, input);
  if (!result.ok) return { ok: false, message: MESSAGES[result.reason] };
  const kind = (input as { kind?: string }).kind;
  return { ok: true, done: kind === "approve" ? "approved" : kind === "changes" ? "changes" : "declined" };
}
