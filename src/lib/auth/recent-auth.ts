import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/security/env.server";
import { getUser } from "./session";
import { DEFAULT_REAUTH_MAX_AGE_MS, isRecentAuth } from "./recent-auth-core";

export type ReauthNeeded = "password" | "mfa" | "oauth";

const maxAgeMs = () =>
  serverEnv.REAUTH_MAX_AGE_SECONDS ? serverEnv.REAUTH_MAX_AGE_SECONDS * 1000 : DEFAULT_REAUTH_MAX_AGE_MS;

/** Does this account have a password to re-enter, or does it sign in only through an OAuth provider? */
export const hasPasswordLogin = (identities: Array<{ provider: string }> | undefined) =>
  (identities ?? []).some((identity) => identity.provider === "email");

/**
 * For sensitive actions (remove a member, change billing, delete a workspace,
 * change email, turn off MFA). Returns what the user must do first, or null when
 * they proved identity recently enough.
 *
 * "Recently" comes from the session token's `amr` claim, which records when the
 * password, OAuth login or authenticator code was last presented. Because it is
 * part of the signed token, a client cannot forge it.
 */
export async function checkRecentAuth(): Promise<ReauthNeeded | null> {
  const user = await getUser();
  if (!user) return "password";

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const usesMfa = aal?.nextLevel === "aal2";
  if (usesMfa && aal.currentLevel !== "aal2") return "mfa";

  const { data } = await supabase.auth.getClaims();
  if (isRecentAuth(data?.claims?.amr, Date.now(), maxAgeMs())) return null;

  if (usesMfa) return hasPasswordLogin(user.identities) ? "password" : "mfa";
  return hasPasswordLogin(user.identities) ? "password" : "oauth";
}

export const REAUTH_MESSAGE = "For your security, confirm it is you before continuing.";
