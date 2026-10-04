import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifies a 6-digit authenticator code against the user's verified TOTP factor,
 * lifting the session to AAL2. Takes the caller's client, so it works for the
 * login step, re-authentication and enrolment alike.
 */
export async function verifyTotpCode(supabase: SupabaseClient, code: string): Promise<boolean> {
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (error || !factor) return false;

  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  return !verifyError;
}

export async function needsSecondFactor(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}
