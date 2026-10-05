import type { SupabaseClient } from "@supabase/supabase-js";
import { nextBestAction, type NextAction, type NextActionFacts } from "./next-action";

// Everything on the dashboard is read through the signed-in user's own Supabase client, so row-level
// security (and the security_invoker views) decide what is visible. This function takes the workspace id
// only to pick one of the user's workspaces; it can never widen what the user may see.

export const REQUEST_STATUSES = ["sent", "completed"] as const;
export const CASE_STUDY_STATUSES = ["draft", "awaiting_client_approval", "approved", "published", "unpublished"] as const;
export const REFERRAL_STATUSES = ["new", "contacted", "won", "dismissed"] as const;

export interface DashboardData {
  funnel: { sent: number; started: number; completed: number; completionRate: number | null };
  caseStudies: Record<(typeof CASE_STUDY_STATUSES)[number], number>;
  views: Array<{ day: string; n: number }>;
  totalViews: number;
  ctaClicks: number;
  referralClicks: number;
  referrals: Record<(typeof REFERRAL_STATUSES)[number], number>;
  usage: { interviews: number; interviewLimit: number | null; aiMessages: number; aiLimit: number };
  next: NextAction;
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function tally<K extends string>(keys: readonly K[], rows: Array<{ status: unknown; n: unknown }>): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) if ((keys as readonly string[]).includes(String(row.status))) out[String(row.status) as K] += Number(row.n);
  return out;
}

/** The last `days` UTC days, oldest first, with zero for days that had no views. */
export function fillDays(rows: Array<{ day: unknown; events: unknown }>, now: number, days = 30): Array<{ day: string; n: number }> {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(String(r.day), (byDay.get(String(r.day)) ?? 0) + Number(r.events));
  return Array.from({ length: days }, (_, i) => {
    const day = isoDay(now - (days - 1 - i) * DAY);
    return { day, n: byDay.get(day) ?? 0 };
  });
}

export async function loadDashboard(
  supabase: SupabaseClient,
  workspaceId: string,
  { plan, aiLimit, now = Date.now() }: { plan: string; aiLimit: number; now?: number },
): Promise<DashboardData> {
  const since = isoDay(now - 29 * DAY);
  const period = new Date(now).toISOString().slice(0, 7) + "-01";
  const staleBefore = new Date(now - 3 * DAY).toISOString();

  const [funnel, statuses, events, referrals, usage, limit, stale, completedStudies] = await Promise.all([
    supabase.from("request_funnel").select("sent, started, completed").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("case_study_status_counts").select("status, n").eq("workspace_id", workspaceId),
    supabase.from("page_event_daily").select("day, type, events").eq("workspace_id", workspaceId).gte("day", since),
    supabase.from("referral_status_counts").select("status, n").eq("workspace_id", workspaceId),
    supabase.from("usage_counters").select("interviews, ai_messages").eq("workspace_id", workspaceId).eq("period", period).maybeSingle(),
    supabase.rpc("plan_interview_limit", { plan }),
    supabase.from("proof_requests_safe").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "sent").lt("created_at", staleBefore),
    supabase.from("interviews").select("id, case_studies:case_studies(id)").eq("workspace_id", workspaceId).eq("status", "completed"),
  ]);

  const sent = Number(funnel.data?.sent ?? 0);
  const completed = Number(funnel.data?.completed ?? 0);
  const caseStudies = tally(CASE_STUDY_STATUSES, statuses.data ?? []);
  const eventRows = (events.data ?? []) as Array<{ day: unknown; type: unknown; events: unknown }>;
  const views = fillDays(eventRows.filter((r) => r.type === "view"), now);
  const sumOf = (type: string) => eventRows.filter((r) => r.type === type).reduce((n, r) => n + Number(r.events), 0);
  const readyToGenerate = (completedStudies.data ?? []).filter((i) => !Array.isArray((i as { case_studies?: unknown }).case_studies) || ((i as { case_studies: unknown[] }).case_studies.length === 0)).length;

  const facts: NextActionFacts = {
    requestsSent: sent,
    requestsStale: stale.count ?? 0,
    readyToGenerate,
    drafts: caseStudies.draft,
    awaitingApproval: caseStudies.awaiting_client_approval,
    readyToPublish: caseStudies.approved + caseStudies.unpublished,
    published: caseStudies.published,
  };

  return {
    funnel: { sent, started: Number(funnel.data?.started ?? 0), completed, completionRate: sent > 0 ? Math.round((completed / sent) * 100) : null },
    caseStudies,
    views,
    totalViews: views.reduce((n, d) => n + d.n, 0),
    ctaClicks: sumOf("cta_click"),
    referralClicks: sumOf("referral_click"),
    referrals: tally(REFERRAL_STATUSES, referrals.data ?? []),
    usage: {
      interviews: Number(usage.data?.interviews ?? 0),
      interviewLimit: typeof limit.data === "number" ? limit.data : null,
      aiMessages: Number(usage.data?.ai_messages ?? 0),
      aiLimit,
    },
    next: nextBestAction(facts),
  };
}
