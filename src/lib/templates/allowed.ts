import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplateTier } from "./model";

/**
 * The same rule as the SQL function public.template_allowed(), for places that already have
 * the facts (the gallery shows a lock badge on many templates at once). A unit test checks the
 * two agree on every combination. Publishing never relies on this copy: it uses the database.
 */
export function isTemplateAllowed({ tier, plan, entitled, active = true }: { tier: TemplateTier; plan: string; entitled: boolean; active?: boolean }): boolean {
  if (!active) return false;
  if (tier === "free") return true;
  if (tier === "pro") return plan === "pro" || plan === "team" || entitled;
  return entitled;
}

/** Asks the database. Use this for every template selection and publish action. */
export async function templateAllowed(supabase: SupabaseClient, workspaceId: string, templateId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("template_allowed", { ws: workspaceId, tpl: templateId });
  return !error && data === true;
}
