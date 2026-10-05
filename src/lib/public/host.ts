// Public case study pages live on their own domain, one subdomain per workspace
// (acme.<PUBLIC_SITES_DOMAIN>/<slug>), so published content never shares an origin with the signed-in
// app. This decides, from the Host header alone, whether a request is for a public site.

const LABEL = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The workspace subdomain of a public-site host, or null for the app host and anything unrecognised. */
export function siteSubdomain(host: string | null | undefined, sitesDomain: string | undefined): string | null {
  if (!host || !sitesDomain) return null;
  const h = host.toLowerCase();
  const root = sitesDomain.toLowerCase();
  if (!h.endsWith(`.${root}`)) return null;
  const label = h.slice(0, -(root.length + 1));
  return LABEL.test(label) ? label : null;
}

/** Same-origin check for the app host: /sites/* must never be reachable there. */
export const isSitesPath = (pathname: string) => pathname === "/sites" || pathname.startsWith("/sites/");

/** Public URL of a published page. */
export function publicPageUrl(sitesDomain: string, workspace: string, slug: string, secure: boolean): string {
  return `${secure ? "https" : "http"}://${workspace}.${sitesDomain}/${slug}`;
}
