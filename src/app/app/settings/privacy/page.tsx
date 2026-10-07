import { redirect } from "next/navigation";
import Link from "next/link";
import { PrivacySettings } from "@/components/privacy/privacy-settings";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { cancelAccountDeletionAction, cancelWorkspaceDeletionAction, requestAccountDeletionAction, requestWorkspaceDeletionAction } from "./actions";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Privacy and data") };

export default async function PrivacyPage() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const { data: profile } = await (await createClient()).from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();

  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Privacy and data" subtitle={<>Export, delete and retention. Read our <Link href="/privacy" className="font-medium text-foreground hover:underline">privacy policy</Link>. Interviews that never finish are deleted automatically after 90 days; an interview can be deleted at any time from its request page.</>} art={<Illustration id="SY-7" decorative />} />
      <PrivacySettings
        isOwner={workspace.role === "owner"}
        workspaceName={workspace.name}
        workspaceDeletion={workspace.deletionRequestedAt}
        accountDeletion={typeof profile?.deletion_requested_at === "string" ? profile.deletion_requested_at : null}
        actions={{ requestWorkspace: requestWorkspaceDeletionAction, cancelWorkspace: cancelWorkspaceDeletionAction, requestAccount: requestAccountDeletionAction, cancelAccount: cancelAccountDeletionAction }}
      />
    </ContentFade>
  );
}
