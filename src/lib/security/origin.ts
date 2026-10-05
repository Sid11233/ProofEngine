/**
 * CSRF guard for cookie-authenticated POST route handlers: the request must come from
 * this app's own origin (or the host it was sent to). A missing Origin is refused.
 */
export function isSameOrigin(request: Pick<Request, "headers">, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === new URL(appUrl).origin) return true;
  const host = request.headers.get("host");
  return host !== null && parsed.host === host;
}
