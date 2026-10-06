import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { SocialDrafts, type DraftView } from "@/components/social/social-drafts";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { NETWORK_INFO, isNetwork } from "@/lib/social/networks";
import { openUrl } from "@/lib/social/share";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { discardPostAction, generateDraftsAction, setPostStatusAction } from "./actions";

export const metadata = { title: pageTitle("Social posts") };
// Writing drafts waits for the AI service.
export const maxDuration = 60;

export default async function SocialPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");

  const supabase = await createClient();
  const { data: study } = await supabase.from("case_studies").select("id, status, current_version").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!study) notFound();

  const { data: approval } = await supabase.from("approvals").select("social_consent").eq("case_study_id", id).eq("version", study.current_version).maybeSingle();
  const published = study.status === "published";
  const consented = approval?.social_consent === true;

  const [{ data: posts }, { data: profiles }] = await Promise.all([
    supabase.from("social_posts").select("id, network, variant, body, status").eq("case_study_id", id).order("network").order("variant"),
    supabase.from("social_profiles").select("network, url").eq("workspace_id", workspace.id),
  ]);
  const profileOf = new Map((profiles ?? []).map((p) => [String(p.network), String(p.url)] as const));

  const drafts: DraftView[] = (posts ?? []).flatMap((p) => {
    const network = String(p.network);
    if (!isNetwork(network)) return [];
    const body = String(p.body);
    const status = p.status === "saved" || p.status === "posted" ? p.status : "draft";
    return [{ id: String(p.id), label: NETWORK_INFO[network].label, network, body, status, openHref: openUrl(network, body, profileOf.get(network)), maxChars: NETWORK_INFO[network].maxChars }];
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Social posts</h1>
        <p className="mt-1 text-neutral-600">Drafts written only from what your client said. Nothing is posted for you: copy a version, then open the app and post it yourself.</p>
        <Link href={`/app/case-studies/${id}/review`} className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-2">Back to the case study</Link>
      </div>
      {!published && <p className="rounded-md border border-neutral-300 p-4">Publish this case study first. Social posts are only written for published stories.</p>}
      {published && !consented && <p className="rounded-md border border-neutral-300 p-4">The client did not agree to social posts when approving this version, so none can be written.</p>}
      {published && consented && (
        <SocialDrafts
          drafts={drafts}
          canEdit={workspace.role !== "viewer"}
          actions={{ generate: generateDraftsAction.bind(null, id), setStatus: setPostStatusAction, discard: discardPostAction }}
        />
      )}
      <p className="text-sm text-neutral-600">Want the buttons to open your own profiles? <Link href="/app/settings/social" className="underline underline-offset-2">Add your profile links</Link>.</p>
    </div>
  );
}
