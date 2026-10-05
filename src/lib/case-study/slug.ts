// The page address a case study gets. The database checks the same shape and the reserved list.
const SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const isValidSlug = (value: string) => SLUG.test(value) && !value.includes("--");

/** A suggested slug from the headline: lowercase ASCII words joined by single hyphens, at most 60 characters. */
export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : "case-study";
}
