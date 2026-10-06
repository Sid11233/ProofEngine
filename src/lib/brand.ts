/**
 * The product's name and logo, in one place. To rebrand: change `name`, replace the files under
 * /public/brand and /public/icons (see scripts/generate-pwa-assets.mjs for the offline page). Nothing else in
 * the code needs to change.
 */
export const brand = {
  name: "Attract Studio",
  /** Short name for home screen icons (kept under 12 characters). */
  shortName: "Attract",
  /** The wordmark for light backgrounds and for dark backgrounds, under /public. The name is in the image, so it is not repeated as text. */
  logo: { light: "/brand/attract-studio-logo.svg", dark: "/brand/attract-studio-logo-on-dark.svg", width: 1805, height: 406 },
  /** Accessible description of the logo image. */
  logoAlt: "Attract Studio",
};

/** Browser tab title: "Sign in | <name>". */
export const pageTitle = (page?: string) => (page ? `${page} | ${brand.name}` : brand.name);
