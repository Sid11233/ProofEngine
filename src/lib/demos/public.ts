import type { SupabaseClient } from "@supabase/supabase-js";
import { demoContentSchema, demoSettingsSchema, demoThemeSchema, type DemoContent, type DemoSettings, type DemoTheme } from "./schema";

// Reads a published demo through the public_demos view with the ANON key: no session, no service role.
// Anything the view does not show (drafts, unpublished, blocked, other workspaces) is simply not found.

const NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const EMBED_ORIGIN = /^https:\/\/[a-z0-9.-]+(:[0-9]+)?$/;

export interface PublicDemo {
  id: string;
  workspaceSlug: string;
  slug: string;
  title: string;
  content: DemoContent;
  settings: DemoSettings;
  theme: DemoTheme;
  showBadge: boolean;
  embedOrigins: string[];
}

export async function loadPublicDemo(anon: SupabaseClient, workspace: string, slug: string): Promise<PublicDemo | null> {
  if (!NAME.test(workspace) || !NAME.test(slug)) return null;
  const { data } = await anon
    .from("public_demos")
    .select("id, workspace_slug, show_badge, slug, title, theme, settings, content, embed_origins")
    .eq("workspace_slug", workspace)
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const content = demoContentSchema.safeParse(data.content);
  const settings = demoSettingsSchema.safeParse(data.settings);
  const theme = demoThemeSchema.safeParse(data.theme);
  if (!content.success || !settings.success || !theme.success) return null;
  return {
    id: String(data.id),
    workspaceSlug: String(data.workspace_slug),
    slug: String(data.slug),
    title: String(data.title),
    content: content.data,
    settings: settings.data,
    theme: theme.data,
    showBadge: data.show_badge === true,
    embedOrigins: Array.isArray(data.embed_origins) ? data.embed_origins.map(String).filter((o) => EMBED_ORIGIN.test(o)) : [],
  };
}

/** The sites an embed may be framed by: only valid https origins, anything else is dropped. */
export const frameAncestorsFor = (origins: unknown): string[] =>
  Array.isArray(origins) ? origins.map(String).filter((o) => EMBED_ORIGIN.test(o) && o.length <= 253).slice(0, 10) : [];
