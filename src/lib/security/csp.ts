// Content-Security-Policy for the authenticated app surface. Built per request
// in middleware so scripts can carry a nonce (no 'unsafe-inline').
// Interview and public-page surfaces get their own policies in later phases.

export function buildCsp({
  nonce,
  supabaseUrl,
  isDev,
  frameAncestors,
}: {
  nonce: string;
  supabaseUrl: string;
  isDev: boolean;
  /** Only for an embeddable page: the https origins allowed to frame it. Empty or missing means nobody. */
  frameAncestors?: string[];
}): string {
  const supabaseOrigin = new URL(supabaseUrl).origin;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets nonce'd scripts load their own chunks.
    // React dev tooling needs eval; production does not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", ...(isDev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    // Style ATTRIBUTES only (the case study theme is applied as CSS variables on an element).
    // <style> elements still need the nonce. An attribute cannot run script, and all user text is
    // rendered as plain text nodes, so there is no way to inject one.
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabaseOrigin],
    "font-src": ["'self'"],
    // This app only. There is no browser-side Supabase client (sessions and data stay on the server), so the
    // browser has no reason to connect to Supabase and an injected script could not use one.
    "connect-src": ["'self'", ...(isDev ? ["ws:", "http:"] : [])],
    // Cloudflare Turnstile (bot check on the interview intro) renders in an iframe.
    "frame-src": ["https://challenges.cloudflare.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": frameAncestors && frameAncestors.length > 0 ? frameAncestors : ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
