import { guardInterviewUpload, json } from "@/lib/interview/endpoint";
import { getInterviewerDeps, getUploadLimiter, getUploadStore } from "@/lib/interview/server";
import { storeInterviewUpload } from "@/lib/uploads/service";

const MESSAGES: Record<string, string> = {
  too_large: "That file is larger than 2 MB.",
  empty: "That file is empty.",
  bad_extension: "Please upload a PNG, JPG or WebP image.",
  bad_content: "That file does not look like a valid PNG, JPG or WebP image.",
  limit_reached: "You have reached the upload limit for this interview.",
  closed: "This interview is no longer open.",
  failed: "The upload did not work. Please try again.",
};
const STATUS: Record<string, number> = { too_large: 413, closed: 409, limit_reached: 429, failed: 500 };

export async function POST(request: Request) {
  const guarded = await guardInterviewUpload(request);
  if (!guarded.ok) return guarded.response;

  if (!(await getUploadLimiter().limit(guarded.access.tokenHash)).success) return json({ error: "rate_limited" }, 429);

  const kind = guarded.body.get("kind");
  const file = guarded.body.get("file");
  // Only a logo or a headshot, and exactly one real file part.
  if ((kind !== "logo" && kind !== "headshot") || !(file instanceof File)) return json({ error: "invalid", message: MESSAGES.bad_content }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await storeInterviewUpload({ admin: getInterviewerDeps().admin, store: getUploadStore() }, guarded.access, { kind, filename: file.name, bytes });
  if (!result.ok) return json({ error: result.error, message: MESSAGES[result.error] }, STATUS[result.error] ?? 400);
  return json({ ok: true });
}
