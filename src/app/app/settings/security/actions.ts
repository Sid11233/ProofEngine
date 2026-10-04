"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isAuthAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { checkRecentAuth, REAUTH_MESSAGE } from "@/lib/auth/recent-auth";
import { mfaCodeSchema } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { createClient } from "@/lib/supabase/server";
import { fieldErrorsOf, type FormState } from "@/lib/validation/form";

export type EnrollResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; message: string };

async function limited(action: "mfa-enroll" | "mfa-manage", userId: string): Promise<boolean> {
  const ip = getClientIp(await headers());
  return !(await isAuthAttemptAllowed(action, { ip, subject: userId }));
}

/** Starts TOTP enrolment: returns a QR code and secret to scan into an authenticator app. */
export async function startMfaEnrollmentAction(): Promise<EnrollResult> {
  const user = await requireUser();
  if (await limited("mfa-manage", user.id)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  if (factors?.totp?.length) return { ok: false, message: "Two-factor authentication is already on." };

  // Abandoned, never-verified enrolments would otherwise block a fresh start.
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
  if (error || !data) return { ok: false, message: "We could not start setup. Please try again." };
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

const confirmSchema = z.object({ factorId: z.uuid(), code: mfaCodeSchema.shape.code }).strict();

/** Finishes enrolment by proving the app produces a valid code. */
export async function confirmMfaEnrollmentAction(factorId: string, code: string): Promise<FormState> {
  const user = await requireUser();
  const parsed = confirmSchema.safeParse({ factorId, code });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  if (await limited("mfa-enroll", user.id)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return { ok: false, message: "That code is not valid. Check your app and try again." };
  return { ok: true, message: "Two-factor authentication is on." };
}

/** Turning protection off is sensitive: it needs a recent sign-in and the second factor. */
export async function disableMfaAction(factorId: string): Promise<FormState> {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(factorId);
  if (!parsed.success) return { ok: false, message: "Unknown authenticator." };

  const reauth = await checkRecentAuth();
  if (reauth) return { ok: false, reauth, message: REAUTH_MESSAGE };
  if (await limited("mfa-manage", user.id)) return { ok: false, message: RATE_LIMITED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data });
  if (error) return { ok: false, message: "We could not turn off two-factor authentication." };
  return { ok: true, message: "Two-factor authentication is off." };
}
