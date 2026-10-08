import "server-only";
import { DEFAULT_TRANSCRIBE_MODEL, DEFAULT_TRANSCRIBE_URL, transcribeAudio } from "@/lib/ai/transcribe";
import { guardInterviewUpload, json } from "@/lib/interview/endpoint";
import { getInterviewerDeps, getVoiceLimiter, getVoiceStore } from "@/lib/interview/server";
import { MAX_VOICE_BYTES, recordVoice, VOICE_CONSENT_VERSION, type VoiceError } from "@/lib/interview/voice";
import { serverEnv } from "@/lib/security/env.server";

const MESSAGES: Record<VoiceError | "not_configured" | "rate_limited" | "unavailable", string> = {
  closed: "This interview is no longer open.",
  too_large: "That recording is too long. Please keep it under two minutes, or type your answer.",
  empty: "The recording was empty. Please try again, or type your answer.",
  bad_audio: "We could not read that recording. Please try again, or type your answer.",
  limit_reached: "You have used all the recordings for this interview. Please type your answer.",
  transcribe_failed: "We could not turn that recording into text. Please try again, or type your answer.",
  failed: "The recording did not work. Please try again, or type your answer.",
  not_configured: "Voice answers are not available. Please type your answer.",
  rate_limited: "Please wait a moment before recording again.",
  unavailable: "Voice answers are not available right now. Please type your answer.",
};
const STATUS: Record<string, number> = { too_large: 413, limit_reached: 429, closed: 409, failed: 500, transcribe_failed: 502, not_configured: 503, rate_limited: 429, unavailable: 503 };
const fail = (error: keyof typeof MESSAGES) => json({ error, message: MESSAGES[error] }, STATUS[error] ?? 400);

export async function POST(request: Request) {
  const guarded = await guardInterviewUpload(request, MAX_VOICE_BYTES + 64 * 1024);
  if (!guarded.ok) return guarded.response;
  if (!serverEnv.OPENAI_API_KEY) return fail("not_configured");
  if (!(await getVoiceLimiter().limit(guarded.access.tokenHash)).success) return fail("rate_limited");

  const file = guarded.body.get("audio");
  // The browser must have shown this version of the notice before it sent a recording.
  if (!(file instanceof File) || guarded.body.get("consentVersion") !== VOICE_CONSENT_VERSION) return json({ error: "invalid", message: MESSAGES.bad_audio }, 400);

  // Same monthly AI allowance as the chat: when it is used up, the client types instead.
  const deps = getInterviewerDeps();
  if (deps.canUseAi && !(await deps.canUseAi(guarded.access))) return fail("unavailable");

  const apiKey = serverEnv.OPENAI_API_KEY;
  const result = await recordVoice(
    { admin: deps.admin, store: getVoiceStore(), transcribe: (bytes, mime) => transcribeAudio({ apiKey, model: serverEnv.TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL, url: serverEnv.TRANSCRIBE_API_URL ?? DEFAULT_TRANSCRIBE_URL }, bytes, mime) },
    guarded.access,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (!result.ok) return fail(result.error);
  return json({ voiceId: result.voiceId, text: result.text });
}
