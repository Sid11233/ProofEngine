import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { MotionPreferenceControl } from "@/components/motion/motion-preference-control";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Illustration } from "@/components/illustrations/illustration";

export const metadata = { title: pageTitle("Motion") };

export default async function MotionSettingsPage() {
  await requireUser();
  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Motion" subtitle="Choose how much the app moves. This is saved in this browser and overrides your device setting." art={<Illustration id="MS-1" decorative />} />
      <Card><MotionPreferenceControl /></Card>
    </ContentFade>
  );
}
