// Content-Security-Policy for the authenticated app surface. Built per request
// in middleware so scripts can carry a nonce (no 'unsafe-inline').
// Interview and public-page surfaces get their own policies in later phases.

export function buildCsp({
  nonce,
  supabaseUrl,
  isDev,
}: {
  nonce: string;
  supabaseUrl: string;
  isDev: boolean;
}): string {
  const supabaseOrigin = new URL(supabaseUrl).origin;
  const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets nonce'd scripts load their own chunks.
    // React dev tooling needs eval; production does not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", ...(isDev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    "img-src": ["'self'", "data:", "blob:", supabaseOrigin],
    "font-src": ["'self'"],
    "connect-src": ["'self'", supabaseOrigin, supabaseWs, ...(isDev ? ["ws:", "http:"] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
