import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { formSchema, submitSimpleForm } from "@/lib/interview/form";
import { getInterviewerDeps } from "@/lib/interview/server";

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, formSchema);
  if (!guarded.ok) return guarded.response;

  const result = await submitSimpleForm(getInterviewerDeps().admin, guarded.access, guarded.body);
  if (!result.ok) return json({ error: result.error, message: result.message }, result.error === "failed" ? 500 : result.error === "limit_reached" ? 429 : 409);
  return json({ ok: true, done: true });
}
