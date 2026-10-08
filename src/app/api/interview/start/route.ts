import "server-only";
import { beginInterview } from "@/lib/ai/interviewer";
import { guardInterviewRequest, json } from "@/lib/interview/endpoint";
import { startSchema } from "@/lib/interview/schemas";
import { getInterviewerDeps, getStartLimiter } from "@/lib/interview/server";
import { getClientIp } from "@/lib/security/client-ip";
import { serverEnv } from "@/lib/security/env.server";
import { sha256Hex } from "@/lib/security/hash";
import { verifyTurnstile } from "@/lib/security/turnstile";

export async function POST(request: Request) {
  const guarded = await guardInterviewRequest(request, startSchema);
  if (!guarded.ok) return guarded.response;

  // The browser must have seen the consent text for THIS link's purpose.
  if (guarded.body.consentVersion !== guarded.access.view.consentVersion) return json({ error: "invalid" }, 400);

  const ip = getClientIp(request.headers);

  // Bot check, verified server-side. Skipped only while no secret key is configured.
  if (serverEnv.TURNSTILE_SECRET_KEY) {
    const human = await verifyTurnstile({ secret: serverEnv.TURNSTILE_SECRET_KEY, token: guarded.body.turnstileToken, ip });
    if (!human) return json({ error: "invalid", message: "Please complete the verification and try again." }, 400);
  }

  // Bot heuristic: only a few interviews may be started from one address per hour.
  if (!(await getStartLimiter().limit(sha256Hex(ip))).success) {
    return json({ error: "rate_limited", message: "Too many interviews were started from your network. Please try again later." }, 429);
  }

  const result = await beginInterview(getInterviewerDeps().admin, guarded.access, guarded.body.consentVersion);
  if (!result.ok) return json({ error: result.error }, result.error === "closed" ? 404 : 500);
  return json({ messages: result.messages, progress: result.progress });
}
