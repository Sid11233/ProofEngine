import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterviewAccess } from "@/lib/interview-access-core";
import type { RateLimiter } from "@/lib/security/rate-limit-memory";
import type { AiClient } from "./client";
import { validateModelText, type ReplyMode } from "./guard";
import { buildSystemPrompt, buildTurnMessage, type TranscriptLine } from "./prompts";
import { normalizeAnswer } from "./sanitize";

// The server, not the model, runs the interview: it owns the question list, the
// position, the probe budget and the final wording of every question. The model only
// supplies a short acknowledgement or one follow-up, and that text is validated and
// replaced with a canned line if anything about it looks off. So client text can steer
// the model's phrasing at worst, never what is asked or recorded.

export const MAX_MAIN_QUESTIONS = 6;
export const MAX_PROBES_PER_QUESTION = 2;
export const MAX_MESSAGES = 40;
export const MAX_TOKENS_PER_INTERVIEW = 100_000;
export const MODEL_MAX_TOKENS = 300;
const HISTORY_LINES = 6;

const CANNED_ACKS = ["Thank you, that is really helpful.", "Thanks for sharing that.", "Great, thank you."];
const CANNED_PROBE = "Could you tell me a little more about that, in your own words?";
const CANNED_RESULTS_PROBE = "Could you share a specific result or number, if you are comfortable doing so?";
const CLOSING = "That is everything I wanted to ask. Thank you so much for your time.";

export interface InterviewerDeps {
  admin: SupabaseClient;
  /** Null when no API key is configured: the interview still runs on the canned lines. */
  ai: AiClient | null;
  /** 10 messages per minute per token. */
  messageLimiter: RateLimiter;
  /** Monthly per-workspace AI cap. When it says no, canned lines are used and nothing is spent. */
  canUseAi?: (access: InterviewAccess) => Promise<boolean>;
}

export interface Progress {
  current: number;
  total: number;
}

export type TurnError = "rate_limited" | "busy" | "limit_reached" | "closed" | "invalid" | "failed";
export type TurnResult =
  | { ok: true; reply: string; progress: Progress; done: boolean }
  | { ok: false; error: TurnError };

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Thin answers get a probe (while the budget lasts); detailed ones move on. */
export function decideMode(questionKey: string, answer: string, probeCount: number): ReplyMode {
  if (probeCount >= MAX_PROBES_PER_QUESTION) return "advance";
  // "short" questions ask for a brief fact (a link, a name): never follow up.
  if (questionKey === "short") return "advance";
  const thin = wordCount(answer) < 15 || (questionKey === "results" && !/\d/.test(answer) && wordCount(answer) < 40);
  return thin ? "probe" : "advance";
}

export function progressOf(questionIndex: number, total: number): Progress {
  return { current: Math.min(questionIndex + 1, total), total };
}

const rpcErrorKind = (code: string | undefined): TurnError =>
  code === "54000" ? "limit_reached" : code === "55006" ? "busy" : code === "P0002" ? "closed" : code === "22023" ? "invalid" : "failed";

/** Opens the interview (idempotent) and posts the first question. */
export async function beginInterview(
  admin: SupabaseClient,
  access: InterviewAccess,
  consentVersion: string,
): Promise<{ ok: true; interviewId: string; messages: TranscriptLine[]; progress: Progress } | { ok: false; error: TurnError }> {
  const { data, error } = await admin.rpc("start_interview", { req: access.requestId, ws: access.workspaceId, consent_version: consentVersion });
  const started = Array.isArray(data) ? data[0] : null;
  if (error || !started) return { ok: false, error: rpcErrorKind(error?.code) };

  const interviewId = String(started.interview_id);
  const first = access.view.questions[0].text;
  if (started.created) {
    const { error: botError } = await admin.rpc("record_bot_message", {
      intr: interviewId, ws: access.workspaceId, body: first, kind: "intro", tokens: 0, ai_used: false,
    });
    if (botError) return { ok: false, error: "failed" };
  }
  const state = await loadTranscript(admin, interviewId, access.workspaceId, access.view.questions.length);
  return { ok: true, interviewId, messages: state.messages, progress: state.progress };
}

export interface TranscriptState {
  messages: TranscriptLine[];
  progress: Progress;
  done: boolean;
}

export async function loadTranscript(admin: SupabaseClient, interviewId: string, workspaceId: string, total: number): Promise<TranscriptState> {
  const [interview, messages] = await Promise.all([
    admin.from("interviews").select("question_index").eq("id", interviewId).eq("workspace_id", workspaceId).single(),
    admin.from("interview_messages").select("role, content").eq("interview_id", interviewId).eq("workspace_id", workspaceId).order("created_at", { ascending: true }).order("id", { ascending: true }),
  ]);
  const index = Number(interview.data?.question_index ?? 0);
  return {
    messages: (messages.data ?? []).map((m) => ({ role: m.role as "client" | "bot", content: String(m.content) })),
    progress: progressOf(index, total),
    done: index >= total,
  };
}

async function recentHistory(admin: SupabaseClient, interviewId: string, workspaceId: string): Promise<TranscriptLine[]> {
  const { data } = await admin
    .from("interview_messages")
    .select("role, content")
    .eq("interview_id", interviewId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LINES);
  return (data ?? []).reverse().map((m) => ({ role: m.role as "client" | "bot", content: String(m.content) }));
}

async function modelText(
  deps: InterviewerDeps,
  access: InterviewAccess,
  mode: ReplyMode,
  answer: string,
  question: { text: string; position: number },
  history: TranscriptLine[],
): Promise<{ text: string | null; tokens: number; called: boolean }> {
  if (!deps.ai) return { text: null, tokens: 0, called: false };
  if (deps.canUseAi && !(await deps.canUseAi(access))) return { text: null, tokens: 0, called: false };
  try {
    const result = await deps.ai.complete({
      system: buildSystemPrompt(access.view.workspaceName, access.purpose),
      messages: [{ role: "user", content: buildTurnMessage({ mode, currentQuestion: question.text, position: question.position, total: access.view.questions.length, history }) }],
      maxTokens: MODEL_MAX_TOKENS,
    });
    return { text: validateModelText(result.text, answer, mode), tokens: result.inputTokens + result.outputTokens, called: true };
  } catch {
    // Provider trouble must never block or corrupt an interview: use the canned line.
    return { text: null, tokens: 0, called: true };
  }
}

/** One turn: save the answer, build a reply, save it, advance. */
export async function answerQuestion(deps: InterviewerDeps, access: InterviewAccess, rawAnswer: string): Promise<TurnResult> {
  const interviewId = access.interviewId;
  if (!interviewId) return { ok: false, error: "closed" };
  const total = access.view.questions.length;
  const answer = normalizeAnswer(rawAnswer);
  if (answer.length === 0 || answer.length > 1000) return { ok: false, error: "invalid" };

  if (!(await deps.messageLimiter.limit(access.tokenHash)).success) return { ok: false, error: "rate_limited" };

  const saved = await deps.admin.rpc("record_client_message", {
    intr: interviewId, ws: access.workspaceId, body: answer, total_questions: total, max_messages: MAX_MESSAGES, max_tokens: MAX_TOKENS_PER_INTERVIEW,
  });
  const row = Array.isArray(saved.data) ? saved.data[0] : null;
  if (saved.error || !row) return { ok: false, error: rpcErrorKind(saved.error?.code) };

  const index = Number(row.question_index);
  const probes = Number(row.probe_count);
  const question = access.view.questions[Math.min(index, total - 1)];
  const key = question.key ?? "";

  const mode = decideMode(key, answer, probes);
  const history = await recentHistory(deps.admin, interviewId, access.workspaceId);
  const generated = await modelText(deps, access, mode, answer, { text: question.text, position: index + 1 }, history);

  let reply: string;
  if (mode === "probe") {
    reply = generated.text ?? (key === "results" ? CANNED_RESULTS_PROBE : CANNED_PROBE);
  } else {
    const ack = generated.text ?? CANNED_ACKS[index % CANNED_ACKS.length];
    const isLast = index + 1 >= total;
    reply = isLast ? `${ack}\n\n${CLOSING}` : `${ack}\n\n${access.view.questions[index + 1].text}`;
  }

  const recorded = await deps.admin.rpc("record_bot_message", {
    intr: interviewId, ws: access.workspaceId, body: reply, kind: mode, tokens: generated.tokens, ai_used: generated.called,
  });
  const state = Array.isArray(recorded.data) ? recorded.data[0] : null;
  if (recorded.error || !state) return { ok: false, error: "failed" };

  const newIndex = Number(state.question_index);
  return { ok: true, reply, progress: progressOf(newIndex, total), done: newIndex >= total };
}
