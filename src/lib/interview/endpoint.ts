import { NextResponse } from "next/server";
import type { z } from "zod";
import { resolveInterview, type InterviewAccess } from "@/lib/interview-access";

const MAX_BODY_BYTES = 16 * 1024;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
export const notFound = () => json({ error: "not_found" }, 404);

type Guarded<T> = { ok: true; access: InterviewAccess; body: T } | { ok: false; response: NextResponse };

/**
 * Shared front door for every interview endpoint: bounded JSON body, then
 * resolveInterview() (so bad links get the same 404 and the rate limits apply), then
 * strict schema validation. Nothing else in the route runs before this succeeds.
 */
export async function guardInterviewRequest<S extends z.ZodType>(request: Request, schema: S): Promise<Guarded<z.infer<S>>> {
  const text = await request.text().catch(() => null);
  if (text === null || text.length > MAX_BODY_BYTES) return { ok: false, response: json({ error: "invalid" }, 400) };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: json({ error: "invalid" }, 400) };
  }
  const token = typeof raw === "object" && raw !== null ? (raw as { token?: unknown }).token : undefined;

  const resolved = await resolveInterview(typeof token === "string" ? token : "");
  if (!resolved.ok) return { ok: false, response: resolved.reason === "rate_limited" ? json({ error: "rate_limited" }, 429) : notFound() };

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { ok: false, response: json({ error: "invalid", message }, 400) };
  }
  return { ok: true, access: resolved.access, body: parsed.data };
}
