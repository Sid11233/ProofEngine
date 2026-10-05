import { beginInterview } from "@/lib/ai/interviewer";
import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { startSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps } from "@/lib/interview/server";

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, startSchema);
  if (!guarded.ok) return guarded.response;

  const result = await beginInterview(getInterviewerDeps().admin, guarded.access, guarded.body.consentVersion);
  if (!result.ok) return json({ error: result.error }, result.error === "closed" ? 404 : 500);
  return json({ messages: result.messages, progress: result.progress });
}
