import type { SupabaseClient } from "@supabase/supabase-js";
import { caseStudyContentSchema, type CaseStudyContent } from "@/lib/case-study/schema";
import { parseTemplate, type Template } from "@/lib/templates/model";

// Reads published case studies through the public_case_studies view with the ANON key: there is no
// session and no service role here, so the only data reachable is what the view deliberately exposes.

const WORKSPACE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export interface PublicStudy {
  workspaceSlug: string;
  workspaceName: string;
  slug: string;
  content: CaseStudyContent;
  template: Template | null;
  themeSettings: unknown;
  logoPath: string | null;
  showBadge: boolean;
  /** https URL of the workspace's own website, for the call-to-action link; null when unset or not https. */
  website: string | null;
  publishedAt: string | null;
}

export interface PublicListItem {
  slug: string;
  headline: string;
  clientName: string | null;
  publishedAt: string | null;
}

const COLUMNS =
  "workspace_slug, workspace_name, show_badge, slug, content, logo_path, theme_settings, published_at, template_id, template_name, template_category, template_tier, template_sections, template_default_theme, template_active, workspace_website";

type Row = Record<string, unknown>;

function toTemplate(row: Row): Template | null {
  if (typeof row.template_id !== "string") return null;
  return parseTemplate({
    id: row.template_id,
    name: row.template_name,
    category: row.template_category,
    tier: row.template_tier,
    sections: row.template_sections,
    default_theme: row.template_default_theme,
    active: row.template_active,
  });
}

/** Only a plain https URL is ever used as a link. */
export function httpsOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function toStudy(row: Row): PublicStudy | null {
  const content = caseStudyContentSchema.safeParse(row.content);
  // Content that does not pass the schema is never rendered.
  if (!content.success) return null;
  return {
    workspaceSlug: String(row.workspace_slug),
    workspaceName: String(row.workspace_name),
    slug: String(row.slug),
    content: content.data,
    template: toTemplate(row),
    themeSettings: row.theme_settings ?? {},
    logoPath: typeof row.logo_path === "string" ? row.logo_path : null,
    showBadge: row.show_badge === true,
    website: httpsOrNull(row.workspace_website),
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
  };
}

export async function loadPublishedStudy(anon: SupabaseClient, workspace: string, slug: string): Promise<PublicStudy | null> {
  if (!WORKSPACE.test(workspace) || !SLUG.test(slug)) return null;
  const { data } = await anon.from("public_case_studies").select(COLUMNS).eq("workspace_slug", workspace).eq("slug", slug).maybeSingle();
  return data ? toStudy(data as Row) : null;
}

/** Newest first, capped. Used by the workspace home page and the wall of proof. */
export async function listPublishedStudies(anon: SupabaseClient, workspace: string, limit = 50): Promise<{ workspaceName: string; showBadge: boolean; items: PublicListItem[] } | null> {
  if (!WORKSPACE.test(workspace)) return null;
  const { data } = await anon
    .from("public_case_studies")
    .select("workspace_name, show_badge, slug, content, published_at")
    .eq("workspace_slug", workspace)
    .order("published_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;
  const items: PublicListItem[] = [];
  for (const row of rows) {
    const content = caseStudyContentSchema.safeParse(row.content);
    if (!content.success) continue;
    items.push({ slug: String(row.slug), headline: content.data.headline, clientName: content.data.client.name ?? null, publishedAt: typeof row.published_at === "string" ? row.published_at : null });
  }
  return { workspaceName: String(rows[0].workspace_name), showBadge: rows[0].show_badge === true, items };
}
