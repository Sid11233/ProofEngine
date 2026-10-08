import { NextResponse } from "next/server";
import type { z } from "zod";
import { resolveInterview, type InterviewAccess } from "@/lib/interview-access";
import { MAINTENANCE_MESSAGE } from "./breaker";
import { readLimited } from "@/lib/security/body";
import { breakerTripped } from "./server";

const MAX_BODY_BYTES = 16 * 1024;
/** 2 MB file plus form overhead. */
export const MAX_MULTIPART_BYTES = 2 * 1024 * 1024 + 64 * 1024;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const notFound = () => json({ error: "not_found" }, 404);
const maintenance = () => json({ error: "maintenance", message: MAINTENANCE_MESSAGE }, 503);

type Guarded<T> = { ok: true; access: InterviewAccess; body: T } | { ok: false; response: NextResponse };

async function resolveOrRespond(token: string): Promise<{ ok: true; access: InterviewAccess } | { ok: false; response: NextResponse }> {
  const resolved = await resolveInterview(token);
  if (!resolved.ok) return { ok: false, response: resolved.reason === "rate_limited" ? json({ error: "rate_limited" }, 429) : notFound() };
  // Global daily AI spend breaker: pause every interview endpoint once it trips.
  if (await breakerTripped()) return { ok: false, response: maintenance() };
  return { ok: true, access: resolved.access };
}

/**
 * Shared front door for every JSON interview endpoint: bounded body, then
 * resolveInterview() (so bad links get the same 404 and the rate limits apply), then the
 * spend breaker, then strict schema validation. Nothing else in the route runs first.
 */
export async function guardInterviewRequest<S extends z.ZodType>(request: Request, schema: S): Promise<Guarded<z.infer<S>>> {
  const bytes = await readLimited(request, MAX_BODY_BYTES).catch(() => null);
  if (bytes === null) return { ok: false, response: json({ error: "invalid" }, 400) };

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, response: json({ error: "invalid" }, 400) };
  }
  const token = typeof raw === "object" && raw !== null ? (raw as { token?: unknown }).token : undefined;

  const resolved = await resolveOrRespond(typeof token === "string" ? token : "");
  if (!resolved.ok) return resolved;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: json({ error: "invalid", message: parsed.error.issues[0]?.message }, 400) };
  return { ok: true, access: resolved.access, body: parsed.data };
}

/** Same front door for the multipart upload endpoint. */
export async function guardInterviewUpload(request: Request, maxBytes: number = MAX_MULTIPART_BYTES): Promise<Guarded<FormData>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return { ok: false, response: json({ error: "invalid" }, 400) };

  const bytes = await readLimited(request, maxBytes).catch(() => null);
  if (bytes === null) return { ok: false, response: json({ error: "too_large" }, 413) };

  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, { headers: { "content-type": type } }).formData();
  } catch {
    return { ok: false, response: json({ error: "invalid" }, 400) };
  }
  const token = form.get("token");
  const resolved = await resolveOrRespond(typeof token === "string" ? token : "");
  if (!resolved.ok) return resolved;
  return { ok: true, access: resolved.access, body: form };
}
