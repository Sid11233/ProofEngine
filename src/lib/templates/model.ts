import { z } from "zod";
import { SECTION_TYPES } from "@/lib/case-study/schema";
import { templateThemeSchema, themeSchema, type Layout, type Theme } from "@/lib/case-study/theme";

export const TEMPLATE_TIERS = ["free", "pro", "pack"] as const;
export type TemplateTier = (typeof TEMPLATE_TIERS)[number];

const rowSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  category: z.string().max(100).nullable(),
  tier: z.enum(TEMPLATE_TIERS),
  sections: z.array(z.enum(SECTION_TYPES)).max(12),
  default_theme: templateThemeSchema,
  active: z.boolean(),
});

export interface Template {
  id: string;
  name: string;
  category: string;
  tier: TemplateTier;
  /** Section types this template allows, in its natural order. */
  sectionTypes: ReadonlyArray<(typeof SECTION_TYPES)[number]>;
  /** The look the template starts with. The user's own theme choices override it. */
  theme: Theme;
  /** Name of a layout variant implemented in code. */
  layout: Layout;
}

/** Validates a templates row. A row that does not fit the schema is dropped, never rendered. */
export function parseTemplate(row: unknown): Template | null {
  const parsed = rowSchema.safeParse(row);
  if (!parsed.success || !parsed.data.active) return null;
  const { layout, ...theme } = parsed.data.default_theme;
  return {
    id: parsed.data.id,
    name: parsed.data.name,
    category: parsed.data.category ?? "general",
    tier: parsed.data.tier,
    sectionTypes: parsed.data.sections,
    theme: themeSchema.parse(theme),
    layout,
  };
}

/** The theme to render: the template's defaults, then the user's valid overrides. */
export function effectiveTheme(template: Template, saved: unknown): Theme {
  const parsed = themeSchema.safeParse({ ...template.theme, ...(typeof saved === "object" && saved ? saved : {}) });
  return parsed.success ? parsed.data : template.theme;
}
