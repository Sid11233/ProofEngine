import type { SupabaseClient } from "@supabase/supabase-js";
import { httpsLink, TRACKER_STATUSES, type TrackerStatus } from "./schemas";
import { rankCommunities, workspaceTags } from "./match";

// Read through the signed-in user's own client: communities are readable by everyone signed in, the tracker
// only by editors and above of the workspace (row-level security decides, not this code).

export interface CommunityView {
  id: string;
  name: string;
  platform: string;
  url: string;
  niches: string[];
  audience: string | null;
  rulesSummary: string | null;
  selfPromoPolicy: string | null;
  needsVerification: boolean;
  lastVerifiedAt: string | null;
  score: number;
}

export interface TrackerEntry {
  status: TrackerStatus;
  notes: string;
  updated: string;
}

export async function loadFinder(supabase: SupabaseClient, workspace: { id: string; niche: string | null; audience: string | null }, { includeTracker }: { includeTracker: boolean }) {
  const [{ data: rows }, tracker] = await Promise.all([
    supabase.from("communities").select("id, name, platform, url, niches, audience, rules_summary, self_promo_policy, needs_verification, last_verified_at").order("name").limit(500),
    includeTracker ? supabase.from("workspace_communities").select("community_id, status, notes, updated_at").eq("workspace_id", workspace.id) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const communities = (rows ?? []).flatMap((r) => {
    // A row without a plain https link is dropped rather than shown.
    const url = httpsLink(r.url);
    if (!url) return [];
    return [{
      id: String(r.id),
      name: String(r.name),
      platform: String(r.platform),
      url,
      niches: Array.isArray(r.niches) ? r.niches.map(String) : [],
      audience: typeof r.audience === "string" ? r.audience : null,
      rulesSummary: typeof r.rules_summary === "string" ? r.rules_summary : null,
      selfPromoPolicy: typeof r.self_promo_policy === "string" ? r.self_promo_policy : null,
      needsVerification: r.needs_verification !== false,
      lastVerifiedAt: typeof r.last_verified_at === "string" ? r.last_verified_at : null,
    }];
  });

  const tags = workspaceTags(workspace.niche, workspace.audience);
  const ranked: CommunityView[] = rankCommunities(communities, tags);
  const entries = new Map<string, TrackerEntry>();
  for (const t of tracker.data ?? []) {
    if ((TRACKER_STATUSES as readonly string[]).includes(String(t.status))) {
      entries.set(String(t.community_id), { status: String(t.status) as TrackerStatus, notes: typeof t.notes === "string" ? t.notes : "", updated: String(t.updated_at).slice(0, 10) });
    }
  }
  return { communities: ranked, tracker: entries, hasNiche: tags.size > 0 };
}
