"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkRecentAuth, hasPasswordLogin } from "@/lib/auth/recent-auth";
import { needsSecondFactor, verifyTotpCode } from "@/lib/auth/mfa";
import {
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/auth/schemas";
import { isAuthAttemptAllowed, isIpAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { safeNextPath } from "@/lib/auth/redirects";
import { requireUser } from "@/lib/auth/session";
import { describeSignupError } from "@/lib/auth/signup-errors";
import { signal } from "@/lib/monitoring/signals";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { createClient, createStatelessClient } from "@/lib/supabase/server";
import { fieldErrorsOf, formDataToObject, type FormState } from "@/lib/validation/form";

// One message for wrong email and wrong password, so the form cannot be used to
// discover which emails have accounts.
const INVALID_CREDENTIALS = "Invalid email or password.";

const appUrl = (path: string) => new URL(path, publicEnv.NEXT_PUBLIC_APP_URL).toString();

async function callerIp() {
  return getClientIp(await headers());
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(formDataToObject(formData, ["email", "password", "next"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { email, password, next } = parsed.data;

  if (!(await isAuthAttemptAllowed("login", { ip: await callerIp(), subject: email }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    signal("failed_login");
    // Only reported after the password was correct, so this reveals nothing to a guesser.
    const message =
      error.code === "email_not_confirmed"
        ? "Confirm your email first: check your inbox for the link we sent."
        : INVALID_CREDENTIALS;
    return { ok: false, message };
  }

  const destination = safeNextPath(next);
  if (await needsSecondFactor(supabase)) {
    redirect(`/login/mfa?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(formDataToObject(formData, ["fullName", "email", "password", "next"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { fullName, email, password } = parsed.data;
  // Where to go after signup: an invite link if that is what brought them, else onboarding.
  const destination = safeNextPath(parsed.data.next, "/onboarding");

  if (!(await isAuthAttemptAllowed("signup", { ip: await callerIp(), subject: email }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: appUrl(`/auth/callback?next=${encodeURIComponent(destination)}`),
      data: { full_name: fullName },
    },
  });

  if (error) {
    // The code and status only (never the email): the Vercel log then says WHY sign-ups fail.
    console.error("Sign-up failed", error.code ?? "no_code", error.status ?? 0);
    const failure = describeSignupError(error.code);
    return failure.field ? { ok: false, fieldErrors: { [failure.field]: [failure.message] } } : { ok: false, message: failure.message };
  }
  if (data.session) redirect(destination);

  // Same answer whether or not the email already has an account.
  return { ok: true, message: "Check your email for a confirmation link to finish signing up." };
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(formDataToObject(formData, ["email"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { email } = parsed.data;

  if (!(await isAuthAttemptAllowed("reset", { ip: await callerIp(), subject: email }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createClient();
  // Errors are deliberately ignored: the response must not depend on the account existing.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: appUrl("/auth/callback?next=/reset-password"),
  });
  return { ok: true, message: "If an account exists for that email, we have sent a reset link." };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData, ["password", "confirmPassword"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const user = await requireUser();
  if (!(await isAuthAttemptAllowed("reset", { ip: await callerIp(), subject: user.id }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  // Changing the password is the most valuable thing a stolen session could do (it locks the
  // owner out and makes the takeover permanent), so a live session is not enough: the user must
  // have just proved who they are, which opening a fresh reset link or signing in does.
  const reauth = await checkRecentAuth();
  if (reauth === "mfa") redirect("/login/mfa?next=/reset-password");
  if (reauth) {
    return { ok: false, message: "For your security this session is too old to change the password. Request a new reset link, or sign in again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "weak_password") {
      return { ok: false, fieldErrors: { password: ["Choose a stronger password"] } };
    }
    if (error.code === "same_password") {
      return { ok: false, fieldErrors: { password: ["Choose a password you have not used before"] } };
    }
    return { ok: false, message: "We could not update your password. Request a new reset link and try again." };
  }

  // A password change should end every other session (a stolen one included).
  await supabase.auth.signOut({ scope: "others" });
  redirect("/app/dashboard");
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next")?.toString());
  if (!(await isIpAttemptAllowed("oauth", await callerIp()))) redirect("/login?error=rate");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: appUrl(`/auth/callback?next=${encodeURIComponent(next)}`) },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const INVALID_CODE = "That code is not valid. Check your authenticator app and try again.";

/** Second step of sign-in for users with two-factor enabled. */
export async function verifyMfaLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData, ["code", "next"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  // Six digits is guessable, so attempts are throttled per user and per IP.
  if (!(await isAuthAttemptAllowed("mfa-login", { ip: await callerIp(), subject: user.id }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createClient();
  if (!(await verifyTotpCode(supabase, parsed.data.code))) return { ok: false, message: INVALID_CODE };
  redirect(safeNextPath(parsed.data.next));
}

/**
 * Re-enter the password to prove it is still the account owner at the keyboard.
 *
 * Without two-factor, a fresh password sign-in refreshes the session. With it, the
 * password is checked on a throwaway client so the user keeps their two-factor
 * session (a normal sign-in would drop them to a lower level and lock them out of
 * the code step); the authenticator code then refreshes the session instead.
 */
export async function reauthPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const password = formDataToObject(formData, ["password"]).password;
  if (!password || password.length > 72) return { ok: false, fieldErrors: { password: ["Enter your password"] } };

  if (!(await isAuthAttemptAllowed("reauth", { ip: await callerIp(), subject: user.id }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }
  if (!user.email || !hasPasswordLogin(user.identities)) {
    return { ok: false, reauth: "oauth", message: "Sign in with Google again to confirm it is you." };
  }

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aal?.nextLevel === "aal2") {
    const probe = createStatelessClient();
    const { error } = await probe.auth.signInWithPassword({ email: user.email, password });
    if (error) return { ok: false, message: "Incorrect password." };
    return { ok: false, reauth: "mfa", message: "Now enter the code from your authenticator app." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (error) return { ok: false, message: "Incorrect password." };
  return { ok: true };
}

export async function reauthMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = mfaCodeSchema.safeParse(formDataToObject(formData, ["code"]));
  if (!parsed.success) return { ok: false, reauth: "mfa", fieldErrors: fieldErrorsOf(parsed.error) };

  if (!(await isAuthAttemptAllowed("mfa-reauth", { ip: await callerIp(), subject: user.id }))) {
    return { ok: false, reauth: "mfa", message: RATE_LIMITED_MESSAGE };
  }
  const supabase = await createClient();
  if (!(await verifyTotpCode(supabase, parsed.data.code))) {
    return { ok: false, reauth: "mfa", message: INVALID_CODE };
  }
  return { ok: true };
}
