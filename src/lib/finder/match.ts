// Matching is deliberately simple: overlap between the words in the workspace's niche and audience and the
// community's niche tags and audience text. No AI, no scraping, no live data.

const STOP = new Set(["the", "and", "for", "who", "with", "that", "this", "from", "your", "our", "are", "into", "their", "small", "medium", "large", "businesses", "business", "people", "companies", "company", "owners", "teams", "team", "help", "helping", "services", "service"]);

// A few common ways of saying the same thing, so "software company" can meet the "saas" tag.
const ALIASES: Record<string, string[]> = {
  saas: ["software", "subscription", "platform", "app", "apps", "startup", "startups", "product"],
  agency: ["agencies", "studio", "studios", "consultancy"],
  marketing: ["marketer", "marketers", "seo", "content", "growth", "advertising", "ads"],
  design: ["designer", "designers", "ux", "ui", "branding", "brand"],
  development: ["developer", "developers", "engineering", "engineer", "engineers", "dev", "devs", "code", "coding"],
  ecommerce: ["shop", "store", "stores", "shopify", "retail", "commerce"],
  consulting: ["consultant", "consultants", "advisor", "advisors", "fractional", "freelance", "freelancer", "freelancers"],
  ai: ["automation", "ml", "llm", "chatbot", "chatbots", "artificial", "machine"],
};

const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Lower-case word stems of a piece of text, without filler words. */
export function tokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Tags a workspace's text points at: its own words plus the tags those words are aliases of. */
export function workspaceTags(niche: string | null | undefined, audience: string | null | undefined): Set<string> {
  const words = new Set([...tokens(niche), ...tokens(audience)]);
  const tags = new Set(words);
  for (const [tag, aliases] of Object.entries(ALIASES)) {
    if (words.has(tag) || aliases.some((a) => words.has(stem(a)))) tags.add(tag);
  }
  return tags;
}

export interface Matchable {
  name: string;
  niches: string[];
  audience: string | null;
  needsVerification: boolean;
}

/** Tag overlap counts 3 each; words shared with the community's audience text count 1 each. */
export function matchScore(community: Matchable, tags: Set<string>): number {
  const tagHits = community.niches.filter((n) => tags.has(n)).length;
  const audienceHits = [...tokens(community.audience)].filter((w) => tags.has(w) && !community.niches.includes(w)).length;
  return tagHits * 3 + audienceHits;
}

/** Best match first; ties go to verified entries, then alphabetical. Pure and stable. */
export function rankCommunities<T extends Matchable>(communities: T[], tags: Set<string>): Array<T & { score: number }> {
  return communities
    .map((c) => ({ ...c, score: matchScore(c, tags) }))
    .sort((a, b) => b.score - a.score || Number(a.needsVerification) - Number(b.needsVerification) || a.name.localeCompare(b.name));
}
