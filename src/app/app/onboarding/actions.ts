"use server";

import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { resetOnboardingFlow, saveOnboardingFlow } from "@/lib/onboarding/flow";
import { buildRequestContext } from "@/lib/requests/context";
import { createOnboardingSchema } from "@/lib/requests/schemas";
import * as requests from "@/lib/requests/service";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsOf, formDataToObject, type FieldErrors } from "@/lib/validation/form";
import { getCurrentWorkspace } from "@/lib/workspace/current";

export interface OnboardingActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** Shown once. Only a fingerprint of the link is stored. */
  link?: string;
  requestId?: string;
}

const FORBIDDEN = "You do not have permission to do that.";

/** Editor or above in the caller's own workspace (from the server, never the request), rate limited. */
async function authorise() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace || workspace.role === "viewer") return null;
  if (!(await isAuthAttemptAllowed("request-manage", { ip: getClientIp(await headers()), subject: user.id }))) return "throttled" as const;
  return { workspace };
}

export async function createOnboardingAction(_prev: OnboardingActionResult, formData: FormData): Promise<OnboardingActionResult> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return { ok: false, message: FORBIDDEN };

  const parsed = createOnboardingSchema.safeParse(formDataToObject(formData, ["clientName", "clientEmail", "clientId", "sendNow"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const { workspace } = auth;
  const result = await requests.createOnboardingRequest(
    await createClient(),
    { id: workspace.id, type: workspace.type === "saas" ? "saas" : "agency" },
    parsed.data,
    buildRequestContext(workspace.name, workspace.plan),
  );
  if (!result.ok) return { ok: false, message: result.error === "not_found" ? "That client was not found." : requests.REQUEST_ERROR_MESSAGES[result.error] };
  revalidatePath("/app/onboarding");
  return {
    ok: true,
    link: result.link,
    requestId: result.requestId,
    message: result.emailSent
      ? "Onboarding created and the invitation sent. Copy the link below if you also want to share it yourself."
      : "Onboarding created. No email was sent (not requested, not configured or failed), so share this link yourself.",
  };
}

export async function saveQuestionsAction(questions: unknown): Promise<{ ok: boolean; message?: string }> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return { ok: false, message: FORBIDDEN };
  const result = await saveOnboardingFlow(await createClient(), { workspaceId: auth.workspace.id, workspaceType: auth.workspace.type === "saas" ? "saas" : "agency" }, questions);
  if (!result.ok) return { ok: false, message: result.error === "invalid" ? (result.message ?? "Please check the questions.") : result.error === "forbidden" ? FORBIDDEN : "We could not save. Please try again." };
  revalidatePath("/app/onboarding/questions");
  return { ok: true, message: "Saved. New onboarding links use these questions; links already sent keep the old ones." };
}

export async function resetQuestionsAction(): Promise<{ ok: boolean; message?: string }> {
  const auth = await authorise();
  if (auth === "throttled") return { ok: false, message: RATE_LIMITED_MESSAGE };
  if (!auth) return { ok: false, message: FORBIDDEN };
  const result = await resetOnboardingFlow(await createClient(), auth.workspace.id);
  if (!result.ok) return { ok: false, message: "We could not reset. Please try again." };
  revalidatePath("/app/onboarding/questions");
  return { ok: true, message: "Back to the standard questions." };
}
