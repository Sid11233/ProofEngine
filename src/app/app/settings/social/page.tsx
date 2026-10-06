import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfilesForm } from "@/components/social/profiles-form";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { NETWORKS, NETWORK_INFO } from "@/lib/social/networks";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { saveSocialProfilesAction } from "./actions";

export const metadata = { title: pageTitle("Social links") };

export default async function SocialSettingsPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  const { data } = await (await createClient()).from("social_profiles").select("network, url").eq("workspace_id", workspace.id);
  const saved = new Map((data ?? []).map((r) => [String(r.network), String(r.url)] as const));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Social links</h1>
        <p className="mt-1 text-neutral-600">Optional. Add your own profile links and the buttons on your social post drafts open your profile for networks that cannot pre-fill a post. We never connect to your accounts or post for you.</p>
      </div>
      {isAdmin ? (
        <ProfilesForm fields={NETWORKS.map((n) => ({ network: n, label: NETWORK_INFO[n].label, value: saved.get(n) ?? "" }))} save={saveSocialProfilesAction} />
      ) : (
        <p>Only admins and owners can change these links.</p>
      )}
      <Link href="/app/dashboard" className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">Skip for now</Link>
    </div>
  );
}
