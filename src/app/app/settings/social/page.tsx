import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfilesForm } from "@/components/social/profiles-form";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { NETWORKS, NETWORK_INFO } from "@/lib/social/networks";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { saveSocialProfilesAction } from "./actions";

import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Illustration } from "@/components/illustrations/illustration";
export const metadata = { title: pageTitle("Social links") };

export default async function SocialSettingsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  const { data } = await (await createClient()).from("social_profiles").select("network, url").eq("workspace_id", workspace.id);
  const saved = new Map((data ?? []).map((r) => [String(r.network), String(r.url)] as const));

  return (
    <ContentFade className="max-w-3xl space-y-6">
      <PageHeader title="Social links" subtitle="Optional. Add your own profile links and the buttons on your social post drafts open your profile for networks that cannot pre-fill a post. We never connect to your accounts or post for you." art={<Illustration id="SO-3" decorative />} />
      {isAdmin ? (
        <Card><ProfilesForm fields={NETWORKS.map((n) => ({ network: n, label: NETWORK_INFO[n].label, value: saved.get(n) ?? "" }))} save={saveSocialProfilesAction} /></Card>
      ) : (
        <p className="text-sm text-muted">Only admins and owners can change these links.</p>
      )}
      <Link href="/app/dashboard" className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-foreground">Skip for now</Link>
    </ContentFade>
  );
}
