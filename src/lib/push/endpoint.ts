// A push endpoint is a URL the browser gives us and our server later POSTs to. Left unchecked that would let
// a signed-in user make the server send requests to any https address, so only the real push services are
// accepted, both when a subscription is saved and again when a message is sent.

const PUSH_HOSTS: Array<string | RegExp> = [
  "fcm.googleapis.com", // Chrome, Edge, Android
  "updates.push.services.mozilla.com", // Firefox
  /^[a-z0-9.-]*\.push\.services\.mozilla\.com$/,
  "web.push.apple.com", // Safari / iOS home screen apps
  /^[a-z0-9.-]*\.push\.apple\.com$/,
  /^[a-z0-9.-]*\.notify\.windows\.com$/, // Edge legacy
];

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return PUSH_HOSTS.some((h) => (typeof h === "string" ? url.hostname === h : h.test(url.hostname)));
  } catch {
    return false;
  }
}
