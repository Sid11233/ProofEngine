import { MfaSettings } from "@/components/settings/mfa-settings";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { confirmMfaEnrollmentAction, disableMfaAction, startMfaEnrollmentAction } from "./actions";
import { pageTitle } from "@/lib/brand";

export const metadata = { title: pageTitle("Security") };

export default async function SecurityPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-2xl font-semibold">Security</h1>
      <MfaSettings
        verifiedFactorId={factors?.totp?.[0]?.id ?? null}
        start={startMfaEnrollmentAction}
        confirm={confirmMfaEnrollmentAction}
        disable={disableMfaAction}
      />
    </div>
  );
}
