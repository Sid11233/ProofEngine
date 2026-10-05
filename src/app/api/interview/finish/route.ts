import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { finishInterview } from "@/lib/interview/finish";
import { finishSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps } from "@/lib/interview/server";

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, finishSchema);
  if (!guarded.ok) return guarded.response;

  const result = await finishInterview(getInterviewerDeps().admin, guarded.access, guarded.body);
  if (!result.ok) return json({ error: result.error }, result.error === "failed" ? 500 : 409);
  return json({ ok: true });
}
