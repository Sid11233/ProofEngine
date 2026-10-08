import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { plainLine } from "@/lib/validation/text";

// The onboarding question list: the business's own "CMS". Editors change the questions; a link snapshots them when it
// is made, so editing never changes an interview that was already sent. Question text is plain text, and the client's
// answers to it are untrusted data like any other.

export const MAX_ONBOARDING_QUESTIONS = 12;
export const MIN_ONBOARDING_QUESTIONS = 1;

export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/, "Bad question id"),
    text: plainLine(300, { min: 3 }, "Write the question (at least 3 characters)"),
    // 'short' = wants a brief fact (a link, a name): the interviewer does not follow up. Anything else is an open question.
    key: z.enum(["short", "open"]).optional(),
  })
  .strict();

export const questionListSchema = z
  .array(questionSchema)
  .min(MIN_ONBOARDING_QUESTIONS, "Keep at least one question")
  .max(MAX_ONBOARDING_QUESTIONS, `At most ${MAX_ONBOARDING_QUESTIONS} questions`)
  .refine((list) => new Set(list.map((q) => q.id)).size === list.length, "Question ids must be unique");

export type OnboardingQuestion = z.infer<typeof questionSchema>;

export interface EffectiveFlow {
  questions: OnboardingQuestion[];
  /** True when the workspace has its own list; false when the standard questions are in use. */
  custom: boolean;
}

/** Normalises stored questions: unknown keys (about, goals, ...) from the standard list become open questions. */
export function normaliseQuestions(raw: unknown): OnboardingQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: OnboardingQuestion[] = [];
  for (const item of raw) {
    const q = item as { id?: unknown; text?: unknown; key?: unknown };
    if (typeof q?.id !== "string" || typeof q.text !== "string") continue;
    out.push({ id: q.id, text: q.text, ...(q.key === "short" ? { key: "short" as const } : {}) });
  }
  return out;
}

/** The workspace's own list if it has one, otherwise the standard list for its type. Reads through the user's client (RLS). */
export async function loadEffectiveFlow(supabase: SupabaseClient, workspaceId: string, workspaceType: "agency" | "saas"): Promise<EffectiveFlow | null> {
  const { data } = await supabase.from("question_flows").select("workspace_id, type, questions").eq("purpose", "onboarding");
  const rows = data ?? [];
  const own = rows.find((r) => r.workspace_id === workspaceId);
  const chosen = own ?? rows.find((r) => r.workspace_id === null && r.type === workspaceType);
  if (!chosen) return null;
  const questions = normaliseQuestions(chosen.questions);
  return questions.length > 0 ? { questions, custom: Boolean(own) } : null;
}

export type FlowError = "invalid" | "forbidden" | "failed";

export async function saveOnboardingFlow(
  supabase: SupabaseClient,
  ctx: { workspaceId: string; workspaceType: "agency" | "saas" },
  raw: unknown,
): Promise<{ ok: true } | { ok: false; error: FlowError; message?: string }> {
  const parsed = questionListSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", message: parsed.error.issues[0]?.message };
  const questions = parsed.data.map((q) => ({ id: q.id, text: q.text, ...(q.key === "short" ? { key: "short" } : {}) }));
  const { data: existing } = await supabase.from("question_flows").select("id").eq("workspace_id", ctx.workspaceId).eq("purpose", "onboarding").maybeSingle();
  const { error } = existing
    ? await supabase.from("question_flows").update({ questions }).eq("id", existing.id)
    : await supabase.from("question_flows").insert({ workspace_id: ctx.workspaceId, type: ctx.workspaceType, name: "Our onboarding questions", questions, purpose: "onboarding" });
  return error ? { ok: false, error: error.code === "42501" ? "forbidden" : "failed" } : { ok: true };
}

export async function resetOnboardingFlow(supabase: SupabaseClient, workspaceId: string): Promise<{ ok: true } | { ok: false; error: FlowError }> {
  const { error } = await supabase.from("question_flows").delete().eq("workspace_id", workspaceId).eq("purpose", "onboarding");
  return error ? { ok: false, error: error.code === "42501" ? "forbidden" : "failed" } : { ok: true };
}
