import { redirect } from "next/navigation";
import { FinderList } from "@/components/finder/finder-list";
import { requireUser } from "@/lib/auth/session";
import { pageTitle } from "@/lib/brand";
import { loadFinder } from "@/lib/finder/load";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/current";
import { removeTrackerAction, saveTrackerAction } from "./actions";

export const metadata = { title: pageTitle("Find communities") };

// A curated list (no scraping, no live monitoring) ranked by how well it matches your niche and audience.
export default async function FinderPage() {
  await requireUser();
  const workspace = await getCurrentWorkspace();
  if (!workspace) redirect("/onboarding");
  const supabase = await createClient();
  const canTrack = workspace.role !== "viewer";
  const { data: profile } = await supabase.from("workspaces").select("niche, audience").eq("id", workspace.id).maybeSingle();
  const { communities, tracker, hasNiche } = await loadFinder(supabase, { id: workspace.id, niche: typeof profile?.niche === "string" ? profile.niche : null, audience: typeof profile?.audience === "string" ? profile.audience : null }, { includeTracker: canTrack });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Find communities</h1>
        <p className="mt-1 text-neutral-600 dark:text-neutral-400">Places where your published stories might help someone. Save the ones you want, and keep notes on what you did.</p>
      </div>
      <FinderList communities={communities} tracker={Object.fromEntries(tracker)} canTrack={canTrack} hasNiche={hasNiche} actions={{ save: saveTrackerAction, remove: removeTrackerAction }} />
    </div>
  );
}
