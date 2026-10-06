"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { createWorkspaceWithProfile, WorkspaceLimitError } from "@/lib/workspace/create";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { onboardingSchema } from "@/lib/workspace/schemas";
import { fieldErrorsOf, type FieldErrors } from "@/lib/validation/form";

export interface OnboardingResult {
  ok: false;
  message?: string;
  fieldErrors?: FieldErrors;
}

export async function createWorkspaceAction(input: unknown): Promise<OnboardingResult> {
  const user = await requireUser();

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  // Onboarding is for people without a workspace; do not create a second by double-submit.
  if (await getCurrentWorkspace()) redirect("/app/dashboard");

  const ip = getClientIp(await headers());
  if (!(await isAuthAttemptAllowed("workspace", { ip, subject: user.id }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  try {
    await createWorkspaceWithProfile(await createClient(), parsed.data);
  } catch (error) {
    if (error instanceof WorkspaceLimitError) {
      return { ok: false, message: "You have reached the limit of workspaces for one account." };
    }
    return { ok: false, message: "We could not create your workspace. Please try again." };
  }

  // Optional next step: profile links for the social post buttons (skippable).
  redirect("/app/settings/social");
}
