import type { SupabaseClient } from "@supabase/supabase-js";

export interface DemoResults {
  views: number;
  completions: number;
  ctaClicks: number;
  leads: number;
  /** For each step (by position), how many visitors reached it. */
  steps: number[];
}

const TYPES = ["view", "complete", "cta_click", "lead"] as const;
const STEP_ROWS = 20_000;

/** Counts for one demo through the user's own client (row level security keeps it to their workspace). */
export async function loadDemoResults(supabase: SupabaseClient, demoId: string, sceneCount: number): Promise<DemoResults> {
  const counts = await Promise.all(TYPES.map(async (type) => (await supabase.from("demo_events").select("id", { count: "exact", head: true }).eq("demo_id", demoId).eq("type", type)).count ?? 0));
  const { data } = await supabase.from("demo_events").select("step_index").eq("demo_id", demoId).eq("type", "step").limit(STEP_ROWS);
  const steps = Array.from({ length: sceneCount }, () => 0);
  for (const row of data ?? []) {
    const i = Number(row.step_index);
    if (Number.isInteger(i) && i >= 0 && i < sceneCount) steps[i] += 1;
  }
  // The first scene is shown to everyone who viewed the demo.
  if (sceneCount > 0) steps[0] = counts[0];
  return { views: counts[0], completions: counts[1], ctaClicks: counts[2], leads: counts[3], steps };
}
