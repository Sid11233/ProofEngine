import { answerQuestion, type TurnError } from "@/lib/ai/interviewer";
import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { messageSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps } from "@/lib/interview/server";

const STATUS: Record<TurnError, number> = {
  rate_limited: 429, busy: 409, limit_reached: 429, closed: 409, invalid: 400, failed: 500,
};

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, messageSchema);
  if (!guarded.ok) return guarded.response;

  const result = await answerQuestion(getInterviewerDeps(), guarded.access, guarded.body.message, guarded.body.voiceId);
  if (!result.ok) return json({ error: result.error }, STATUS[result.error]);
  return json({ reply: result.reply, progress: result.progress, done: result.done });
}
