import { z } from "zod";

// Customisation is structured and validated: users pick from fixed lists and a hex colour.
// They never write CSS or give a URL, so nothing here can inject style or script.

export const FONT_PAIRS = ["inter", "lora-inter", "poppins-inter", "space-grotesk-inter", "playfair-source", "merriweather-opensans"] as const;
export const RADII = ["none", "sm", "md", "lg", "xl"] as const;
export const SPACINGS = ["compact", "comfortable", "spacious"] as const;
export const MODES = ["light", "dark"] as const;
export const LAYOUTS = ["classic", "minimal", "before-after", "timeline", "saas-switch", "spotlight", "quote-led", "editorial", "cards"] as const;

export type FontPair = (typeof FONT_PAIRS)[number];
export type Layout = (typeof LAYOUTS)[number];

export const FONT_PAIR_LABELS: Record<FontPair, string> = {
  inter: "Inter",
  "lora-inter": "Lora and Inter",
  "poppins-inter": "Poppins and Inter",
  "space-grotesk-inter": "Space Grotesk and Inter",
  "playfair-source": "Playfair Display and Source Sans",
  "merriweather-opensans": "Merriweather and Open Sans",
};

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6 digit hex colour such as #1d4ed8");

export const themeSchema = z
  .object({
    primary: hexColour,
    fontPair: z.enum(FONT_PAIRS),
    radius: z.enum(RADII),
    spacing: z.enum(SPACINGS),
    mode: z.enum(MODES),
  })
  .strict();

/** A template's default theme also names its layout variant (implemented in code). */
export const templateThemeSchema = themeSchema.extend({ layout: z.enum(LAYOUTS) }).strict();

export type Theme = z.infer<typeof themeSchema>;
export type TemplateTheme = z.infer<typeof templateThemeSchema>;

export const DEFAULT_THEME: Theme = { primary: "#1d4ed8", fontPair: "inter", radius: "md", spacing: "comfortable", mode: "light" };

const RADIUS_PX: Record<(typeof RADII)[number], string> = { none: "0px", sm: "4px", md: "8px", lg: "14px", xl: "22px" };
const SPACING_REM: Record<(typeof SPACINGS)[number], string> = { compact: "1.25rem", comfortable: "2rem", spacious: "3rem" };

/** Black or white, whichever is easier to read on this colour (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#111827" {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // Compare contrast ratios against white and against the dark text colour.
  const againstWhite = 1.05 / (luminance + 0.05);
  const againstDark = (luminance + 0.05) / (0.0171 + 0.05);
  return againstWhite >= againstDark ? "#ffffff" : "#111827";
}

/** CSS variables for a validated theme. Every value comes from a fixed list or a checked hex colour. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const dark = theme.mode === "dark";
  return {
    "--cs-primary": theme.primary,
    "--cs-on-primary": readableOn(theme.primary),
    "--cs-bg": dark ? "#0b1020" : "#ffffff",
    "--cs-surface": dark ? "#151b2e" : "#f5f6f8",
    "--cs-fg": dark ? "#e8eaf0" : "#111827",
    "--cs-muted": dark ? "#a3a9ba" : "#4b5563",
    "--cs-border": dark ? "#2a3150" : "#e2e5ea",
    "--cs-radius": RADIUS_PX[theme.radius],
    "--cs-gap": SPACING_REM[theme.spacing],
  };
}
