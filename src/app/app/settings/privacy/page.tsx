import { redirect } from "next/navigation";
import Link from "next/link";
import { PrivacySettings } from "@/components/privacy/privacy-settings";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { cancelAccountDeletionAction, cancelWorkspaceDeletionAction, requestAccountDeletionAction, requestWorkspaceDeletionAction } from "./actions";

export const metadata = { title: pageTitle("Privacy and data") };

export default async function PrivacyPage() {
  const user = await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const { data: profile } = await (await createClient()).from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Privacy and data</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">Export, delete and retention. Read our <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>. Interviews that never finish are deleted automatically after 90 days; an interview can be deleted at any time from its request page.</p>
      </div>
      <PrivacySettings
        isOwner={workspace.role === "owner"}
        workspaceName={workspace.name}
        workspaceDeletion={workspace.deletionRequestedAt}
        accountDeletion={typeof profile?.deletion_requested_at === "string" ? profile.deletion_requested_at : null}
        actions={{ requestWorkspace: requestWorkspaceDeletionAction, cancelWorkspace: cancelWorkspaceDeletionAction, requestAccount: requestAccountDeletionAction, cancelAccount: cancelAccountDeletionAction }}
      />
    </div>
  );
}
