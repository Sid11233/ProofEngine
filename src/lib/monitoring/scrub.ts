// PII scrubbing for error reports. Nothing leaves the server unless it has been through scrubEvent: no
// request bodies, cookies, headers, query strings, users or IP addresses, and no secret-looking value in
// any message, URL or field. Written without importing the Sentry SDK so it can be tested exhaustively.

const REDACTED = "[redacted]";

// Pages whose URL path carries a secret token.
const SECRET_PATHS = /\/(i|preview|approve|unsubscribe|remove|invite)\/[^/?#\s]+/gi;

const VALUE_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email addresses
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWTs (Supabase keys and sessions)
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe keys
  /\bwhsec_[A-Za-z0-9]{8,}/g, // Stripe webhook secrets
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, // Supabase API keys
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b[A-Za-z0-9_-]{43}\b/g, // 32 random bytes in base64url: our interview, preview and approval tokens
  /\b[0-9a-f]{64}\b/gi, // SHA-256 hex: token hashes, keyed IP hashes
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}\b/gi, // signed link tokens
  /(?:\d{1,3}\.){3}\d{1,3}/g, // IPv4 addresses
];

/** A string with every secret-looking value and secret URL segment replaced. */
export function scrubString(value: string): string {
  let out = value.replace(SECRET_PATHS, (m) => `${m.slice(0, m.indexOf("/", 1) + 1)}${REDACTED}`);
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/** A URL reduced to its origin and path, with token segments redacted and no query or fragment. */
export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${scrubString(parsed.pathname)}`;
  } catch {
    return scrubString(url.split(/[?#]/)[0] ?? "");
  }
}

/** Deep-scrubs every string in a value. Depth and size are bounded, so a hostile object cannot make this expensive. */
export function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth > 6 || value === null || typeof value !== "object") return typeof value === "number" || typeof value === "boolean" ? value : value === null ? null : undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[k] = scrubDeep(v, depth + 1);
  return out;
}

interface Frame {
  vars?: unknown;
  abs_path?: string;
  filename?: string;
  [key: string]: unknown;
}

export interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown };
  transaction?: string;
  server_name?: string;
  user?: unknown;
  request?: { url?: string; data?: unknown; cookies?: unknown; headers?: unknown; query_string?: unknown; env?: unknown; [key: string]: unknown };
  exception?: { values?: Array<{ value?: string; type?: string; stacktrace?: { frames?: Frame[] } }> };
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The Sentry `beforeSend` hook. Returns the event with everything personal removed. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const e = event as ScrubbableEvent;

  if (e.request) {
    const url = typeof e.request.url === "string" ? scrubUrl(e.request.url) : undefined;
    // Method is useful and harmless; everything else about the request goes.
    const method = typeof e.request.method === "string" ? e.request.method : undefined;
    e.request = { ...(url ? { url } : {}), ...(method ? { method } : {}) };
  }
  delete e.user;
  delete e.server_name;
  delete e.breadcrumbs;
  delete e.extra;

  if (typeof e.message === "string") e.message = scrubString(e.message);
  if (e.logentry) e.logentry = { message: typeof e.logentry.message === "string" ? scrubString(e.logentry.message) : undefined };
  if (typeof e.transaction === "string") e.transaction = scrubString(e.transaction);

  for (const value of e.exception?.values ?? []) {
    if (typeof value.value === "string") value.value = scrubString(value.value);
    for (const frame of value.stacktrace?.frames ?? []) delete frame.vars;
  }

  if (e.contexts) {
    // Keep the runtime, OS and browser facts; drop anything free-form.
    const keep = new Set(["runtime", "os", "device", "app", "culture", "trace"]);
    e.contexts = Object.fromEntries(Object.entries(e.contexts).filter(([k]) => keep.has(k)).map(([k, v]) => [k, scrubDeep(v)]));
  }
  if (e.tags) e.tags = Object.fromEntries(Object.entries(e.tags).map(([k, v]) => [k, typeof v === "string" ? scrubString(v) : v]));
  return event;
}
