import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTemplate, type Template } from "./model";

/** All active templates the database holds, validated. Rows that do not fit the schema are dropped. */
export async function loadTemplates(supabase: SupabaseClient): Promise<Template[]> {
  const { data } = await supabase.from("templates").select("id, name, category, tier, sections, default_theme, active").eq("active", true).order("name");
  return (data ?? []).map(parseTemplate).filter((t): t is Template => t !== null);
}

export async function loadTemplate(supabase: SupabaseClient, id: string): Promise<Template | null> {
  const { data } = await supabase.from("templates").select("id, name, category, tier, sections, default_theme, active").eq("id", id).maybeSingle();
  return data ? parseTemplate(data) : null;
}

/** Ids of templates this workspace owns outright (purchased or granted). */
export async function loadEntitledTemplateIds(supabase: SupabaseClient, workspaceId: string): Promise<Set<string>> {
  const { data } = await supabase.from("template_entitlements").select("template_id").eq("workspace_id", workspaceId);
  return new Set((data ?? []).map((row) => String(row.template_id)));
}

/** The DEFAULT template used before an owner picks one: the first free template by name. */
export function defaultTemplate(templates: Template[]): Template | undefined {
  return templates.find((t) => t.tier === "free" && t.name === "Classic") ?? templates.find((t) => t.tier === "free") ?? templates[0];
}
