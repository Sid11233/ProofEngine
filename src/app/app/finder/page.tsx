import { redirect } from "next/navigation";
import { FinderList } from "@/components/finder/finder-list";
import { Illustration } from "@/components/illustrations/illustration";
import { ContentFade } from "@/components/motion/content-fade";
import { PageHeader } from "@/components/ui/page-header";
import { getUser, requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadFinder } from "@/lib/finder/load";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdminEmail } from "@/lib/takedown/admin";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { removeTrackerAction, saveTrackerAction } from "./actions";

export const metadata = { title: pageTitle("Find communities") };

// A curated list (no scraping, no live monitoring) ranked by how well it matches your niche and audience.
export default async function FinderPage() {
  await requireUser();
  const [user, workspace] = await Promise.all([getUser(), getCurrentWorkspace()]);
  if (!workspace) redirect("/onboarding");
  const supabase = await createClient();
  const canTrack = workspace.role !== "viewer";
  const { data: profile } = await supabase.from("workspaces").select("niche, audience").eq("id", workspace.id).maybeSingle();
  const { communities, tracker, hasNiche } = await loadFinder(supabase, { id: workspace.id, niche: typeof profile?.niche === "string" ? profile.niche : null, audience: typeof profile?.audience === "string" ? profile.audience : null }, { includeTracker: canTrack });
  const showUnverified = Boolean(user?.email_confirmed_at && isPlatformAdminEmail(user.email));

  return (
    <ContentFade className="space-y-6">
      <PageHeader title="Find communities" subtitle="Places where your stories might help someone." art={<Illustration id="FD-1" decorative />} />
      <FinderList communities={communities} tracker={Object.fromEntries(tracker)} canTrack={canTrack} hasNiche={hasNiche} showUnverified={showUnverified} actions={{ save: saveTrackerAction, remove: removeTrackerAction }} />
    </ContentFade>
  );
}
