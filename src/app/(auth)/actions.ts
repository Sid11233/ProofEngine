"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/auth/schemas";
import { isAuthAttemptAllowed, isIpAttemptAllowed, RATE_LIMITED_MESSAGE } from "@/lib/auth/rate-limits";
import { safeNextPath } from "@/lib/auth/redirects";
import { requireUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/security/client-ip";
import { publicEnv } from "@/lib/security/env.public";
import { createClient } from "@/lib/supabase/server";
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
    // Only reported after the password was correct, so this reveals nothing to a guesser.
    const message =
      error.code === "email_not_confirmed"
        ? "Confirm your email first: check your inbox for the link we sent."
        : INVALID_CREDENTIALS;
    return { ok: false, message };
  }

  const destination = safeNextPath(next);
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/login/mfa?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse(formDataToObject(formData, ["fullName", "email", "password"]));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { fullName, email, password } = parsed.data;

  if (!(await isAuthAttemptAllowed("signup", { ip: await callerIp(), subject: email }))) {
    return { ok: false, message: RATE_LIMITED_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: appUrl("/auth/callback?next=/onboarding"),
      data: { full_name: fullName },
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return { ok: false, fieldErrors: { password: ["Choose a stronger password"] } };
    }
    return { ok: false, message: "We could not create your account. Please try again." };
  }
  if (data.session) redirect("/onboarding");

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
