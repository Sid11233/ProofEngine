import type { SupabaseClient } from "@supabase/supabase-js";
import { aiMessageLimitFor, type Limits } from "@/lib/limits";
import { isTemplateAllowed, templateAllowed as templateAllowedInDb } from "@/lib/templates/allowed";
import type { TemplateTier } from "@/lib/templates/model";
import { planOf } from "./plans";

// What a workspace's plan lets it do. Server actions and route handlers ask here, never compare plan
// names themselves. These are the application-side answers; the database remains the final authority
// (create_proof_request enforces the interview limit under a lock, the publish trigger uses
// template_allowed(), the public view hides the badge only for paid plans), and tests keep the numbers
// here equal to the SQL.

export interface Decision {
  allowed: boolean;
  /** Plain words for the user when not allowed. */
  reason?: string;
}

/** Can another interview be started this month? */
export function canCreateInterview({ plan, usedThisMonth }: { plan: string; usedThisMonth: number }): Decision {
  const limit = planOf(plan).interviewsPerMonth;
  return usedThisMonth < limit ? { allowed: true } : { allowed: false, reason: `Your ${planOf(plan).label} plan includes ${limit} interviews a month, and you have used them all.` };
}

/** Can another AI message be used this month? Env overrides in `limits` apply. */
export function canUseAI({ plan, usedThisMonth, limits }: { plan: string; usedThisMonth: number; limits: Limits }): Decision {
  return usedThisMonth < aiMessageLimitFor(plan, limits) ? { allowed: true } : { allowed: false, reason: "This month's AI usage limit for your plan has been reached." };
}

/** Is this template included for the workspace? Use for display; publishing asks the database. */
export function templateAllowed({ tier, plan, entitled, active = true }: { tier: TemplateTier; plan: string; entitled: boolean; active?: boolean }): boolean {
  return isTemplateAllowed({ tier, plan, entitled, active });
}

/** The same question answered by the database (publish and template selection use this). */
export const templateAllowedInDatabase = templateAllowedInDb;

/** Does the plan remove the "Powered by" line from public pages? */
export function canRemoveBranding(plan: string): boolean {
  return planOf(plan).removesBranding;
}

/** Interviews used this month, read through the caller's own client (row-level security applies). */
export async function interviewsUsedThisMonth(supabase: SupabaseClient, workspaceId: string, now = Date.now()): Promise<number> {
  const period = new Date(now).toISOString().slice(0, 7) + "-01";
  const { data } = await supabase.from("usage_counters").select("interviews").eq("workspace_id", workspaceId).eq("period", period).maybeSingle();
  return Number(data?.interviews ?? 0);
}
