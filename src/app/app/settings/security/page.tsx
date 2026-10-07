import { MfaSettings } from "@/components/settings/mfa-settings";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { confirmMfaEnrollmentAction, disableMfaAction, startMfaEnrollmentAction } from "./actions";
import { pageTitle } from "@/lib/brand";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Security") };

export default async function SecurityPage() {
  await requireUser();
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();

  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Security" subtitle="Protect your workspace with a second step when you sign in." art={<Illustration id="IV-2" decorative />} />
      <Card><MfaSettings
        verifiedFactorId={factors?.totp?.[0]?.id ?? null}
        start={startMfaEnrollmentAction}
        confirm={confirmMfaEnrollmentAction}
        disable={disableMfaAction}
      /></Card>
    </ContentFade>
  );
}
