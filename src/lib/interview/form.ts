import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { InterviewAccess } from "@/lib/interview-access-core";
import { normalizeAnswer } from "@/lib/ai/sanitize";
import { tokenSchema } from "./schemas";

export const formSchema = z
  .object({
    token: tokenSchema,
    answers: z
      .array(z.object({ questionId: z.string().min(1).max(40), answer: z.string().trim().min(1, "Please answer every question").max(1000, "Please keep answers under 1000 characters") }).strict())
      .min(1)
      .max(12),
  })
  .strict();

export type FormInput = z.infer<typeof formSchema>;
export type FormResult = { ok: true } | { ok: false; error: "closed" | "invalid" | "limit_reached" | "failed"; message?: string };

const CLOSING = "That is everything I wanted to ask. Thank you so much for your time.";

/**
 * The "simple form" alternative to the chat. Answers go through exactly the same
 * validated database path as chat messages (record_client_message, then the next
 * question as the bot's turn), so the transcript looks the same either way and every
 * cap still applies. Answers must cover the remaining questions, in order.
 */
export async function submitSimpleForm(admin: SupabaseClient, access: InterviewAccess, input: FormInput): Promise<FormResult> {
  const interviewId = access.interviewId;
  if (!interviewId) return { ok: false, error: "closed" };
  const questions = access.view.questions;

  const { data: state } = await admin.from("interviews").select("question_index, status").eq("id", interviewId).eq("workspace_id", access.workspaceId).single();
  if (!state || state.status !== "started") return { ok: false, error: "closed" };
  const start = Number(state.question_index);
  const remaining = questions.slice(start);

  if (remaining.length === 0) return { ok: false, error: "invalid", message: "Every question has already been answered." };
  if (input.answers.length !== remaining.length || remaining.some((q, i) => input.answers[i].questionId !== q.id)) {
    return { ok: false, error: "invalid", message: "The form does not match the remaining questions." };
  }

  for (let i = 0; i < remaining.length; i++) {
    const saved = await admin.rpc("record_client_message", {
      intr: interviewId, ws: access.workspaceId, body: normalizeAnswer(input.answers[i].answer), total_questions: questions.length,
    });
    if (saved.error) return { ok: false, error: saved.error.code === "54000" ? "limit_reached" : "failed" };

    const isLast = start + i + 1 >= questions.length;
    const recorded = await admin.rpc("record_bot_message", {
      intr: interviewId, ws: access.workspaceId, body: isLast ? CLOSING : questions[start + i + 1].text, kind: "advance", tokens: 0, ai_used: false,
    });
    if (recorded.error) return { ok: false, error: "failed" };
  }
  return { ok: true };
}
