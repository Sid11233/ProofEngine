// Where the unsubscribe page sends the browser after a click. The token is client-supplied text, so it is
// always percent-encoded and the result is one of three fixed words: nothing can turn this into an
// off-site or different-path redirect.

const RESULTS = new Set(["done", "invalid", "limited"]);

/** `<uuid>.<base64url>`: the only shape a genuine token has. */
export const isPlausibleUnsubscribeToken = (value: string) => /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value);

export function unsubscribePath(token: string, result: string): string {
  return `/unsubscribe/${encodeURIComponent(token.slice(0, 100))}?result=${RESULTS.has(result) ? result : "invalid"}`;
}
