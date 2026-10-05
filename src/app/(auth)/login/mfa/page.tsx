import { redirect } from "next/navigation";
import { MfaLoginForm } from "@/components/auth/mfa-login-form";
import { safeNextPath } from "@/lib/auth/redirects";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signOutAction, verifyMfaLoginAction } from "../../actions";
import { pageTitle } from "@/lib/brand";
import { brand } from "@/lib/brand";

export const metadata = { title: pageTitle("Two-factor code") };

export default async function MfaLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireUser();
  const { next } = await searchParams;
  const destination = safeNextPath(next);

  // Middleware routes only people who owe a second factor here; double-check.
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel !== "aal2" || aal.currentLevel === "aal2") redirect(destination);

  return (
    <>
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Open your authenticator app and enter the 6-digit code for {brand.name}.
      </p>
      <MfaLoginForm action={verifyMfaLoginAction} next={destination} />
      <form action={signOutAction}>
        <button type="submit" className="text-sm underline underline-offset-2">
          Sign out
        </button>
      </form>
    </>
  );
}
