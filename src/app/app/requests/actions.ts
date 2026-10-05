"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getEmailSender } from "@/lib/email/resend";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";
import { unsubscribeSecret } from "@/lib/security/ip-hash";
import { unsubscribeToken } from "@/lib/security/unsubscribe";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { fieldErrorsOf, formDataToObject, type FieldErrors } from "@/lib/validation/form";
import { createRequestSchema, requestIdSchema } from "@/lib/requests/schemas";
import * as requests from "@/lib/requests/service";

export interface RequestActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** Shown once. The raw token is not stored, so it cannot be shown again. */
  link?: string;
  requestId?: string;
}

const FORBIDDEN: RequestActionResult = { ok: false, message: requests.REQUEST_ERROR_MESSAGES.forbidden };
const fail = (error: requests.RequestError): RequestActionResult => ({ ok: false, message: requests.REQUEST_ERROR_MESSAGES[error] });

/** Authenticates and requires editor+ in the caller's own workspace (taken from the server, not the request). */
async function authorise() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return null;
  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("request-manage", { ip, subject: user.id }))) return "throttled" as const;
  return { workspace };
}

async function context(workspaceName: string): Promise<requests.Context> {
  const secret = unsubscribeSecret(serverEnv);
  return {
    appUrl: publicEnv.NEXT_PUBLIC_APP_URL,
    workspaceName,
    sender: getEmailSender(),
    unsubscribeUrl: (requestId) => new URL(`/unsubscribe/${unsubscribeToken(secret, requestId)}`, publicEnv.NEXT_PUBLIC_APP_URL).toString(),
  };
}

function describe(result: requests.LinkResult, verb: string): RequestActionResult {
  return {
    ok: true,
    link: result.link,
    requestId: result.requestId,
    message: result.emailSent
      ? `${verb} Copy the link below if you also want to share it yourself.`
      : `${verb} No email was sent (email is not configured, failed, or was not requested), so share this link yourself.`,
  };
}

export async function createRequestAction(_prev: RequestActionResult, formData: FormData): Promise<RequestActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return FORBIDDEN;

  const parsed = createRequestSchema.safeParse(
    formDataToObject(formData, ["clientName", "clientEmail", "projectType", "flowType", "outcome1", "outcome2", "outcome3", "tone", "sendNow"]),
  );
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const result = await requests.createRequest(await createClient(), auth.workspace.id, parsed.data, await context(auth.workspace.name));
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/requests");
  return describe(result, parsed.data.sendNow ? "Request created and invitation sent." : "Request created.");
}

type LinkAction = (supabase: Awaited<ReturnType<typeof createClient>>, id: string, ctx: requests.Context) => Promise<requests.RequestOutcome<requests.LinkResult>>;

async function linkAction(requestId: string, run: LinkAction, verb: string): Promise<RequestActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return FORBIDDEN;
  const id = requestIdSchema.safeParse(requestId);
  if (!id.success) return fail("invalid");

  const result = await run(await createClient(), id.data, await context(auth.workspace.name));
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/requests");
  revalidatePath(`/app/requests/${id.data}`);
  return describe(result, verb);
}

export async function sendInviteAction(requestId: string): Promise<RequestActionResult> {
  return linkAction(requestId, requests.sendInvite, "Invitation sent.");
}

export async function sendReminderAction(requestId: string): Promise<RequestActionResult> {
  return linkAction(requestId, requests.sendReminder, "Reminder sent. The previous link no longer works.");
}

export async function regenerateLinkAction(requestId: string): Promise<RequestActionResult> {
  return linkAction(requestId, requests.regenerateLink, "New link created. The previous link no longer works.");
}

export async function revokeRequestAction(requestId: string): Promise<RequestActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return FORBIDDEN;
  const id = requestIdSchema.safeParse(requestId);
  if (!id.success) return fail("invalid");

  const result = await requests.revokeRequest(await createClient(), id.data);
  if (!result.ok) return fail(result.error);
  revalidatePath("/app/requests");
  revalidatePath(`/app/requests/${id.data}`);
  return { ok: true, message: "Link revoked. It stops working immediately." };
}
