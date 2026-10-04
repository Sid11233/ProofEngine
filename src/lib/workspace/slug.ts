import { randomInt } from "node:crypto";

// Keep in sync with public.is_reserved_slug() in the identity migration; a unit
// test fails if the two lists drift apart.
export const RESERVED_SLUGS: readonly string[] = [
  "www", "app", "api", "admin", "i", "mail", "support", "billing", "status", "docs",
  "auth", "login", "logout", "signup", "dashboard", "static", "assets", "cdn",
  "embed", "pages", "blog", "help", "smtp", "ftp", "dev", "staging", "test",
  "security", "privacy", "terms", "root", "null", "undefined",
];

const MIN_LENGTH = 3;
const MAX_BASE_LENGTH = 50; // leaves room for a "-xxxx" suffix inside DNS's 63-character label limit
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const isReservedSlug = (slug: string) => RESERVED_SLUGS.includes(slug);

/** Same rule as the database check constraint on workspaces.subdomain_slug. */
export const isValidSlug = (slug: string) => SLUG_PATTERN.test(slug) && !isReservedSlug(slug);

/**
 * Lowercase a-z, 0-9 and single hyphens only. NFKD folds look-alikes that have a
 * compatibility mapping (fullwidth "ａｄｍｉｎ", circled digits, ligatures) into plain
 * ASCII so they hit the reserved list. Characters with no ASCII mapping, such as
 * Cyrillic "а", are dropped rather than transliterated, so they can never be
 * used to spell a reserved word.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, "");
}

function randomSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) out += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  return out;
}

/** A usable base: long enough and not reserved. */
function usableBase(name: string): string {
  const base = slugify(name);
  if (base === "") return "workspace";
  if (base.length < MIN_LENGTH || isReservedSlug(base)) return `${base}-hq`;
  return base;
}

/**
 * Yields the plain slug first, then random-suffixed variants. Uniqueness is decided
 * by the database (a unique index), so callers try each candidate until one is accepted.
 */
export function* slugCandidates(name: string, suffix: () => string = randomSuffix): Generator<string> {
  const base = usableBase(name);
  yield base;
  for (;;) yield `${base}-${suffix()}`;
}
