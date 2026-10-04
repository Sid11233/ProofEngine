// Pure routing rules for authentication. Kept free of Next.js and Supabase imports
// so they can be unit-tested and reused by middleware, route handlers and actions.

const DEFAULT_AFTER_LOGIN = "/app/dashboard";

const PROTECTED_PREFIXES = ["/app", "/onboarding", "/invite"];
const AUTH_PAGES = ["/login", "/signup", "/forgot-password"];

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export const isProtectedPath = (pathname: string) =>
  PROTECTED_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix));

export const isAuthPage = (pathname: string) => AUTH_PAGES.some((page) => pathname === page);

/** Paths for which middleware needs to know who the user is. */
export const needsSession = (pathname: string) =>
  isProtectedPath(pathname) ||
  isAuthPage(pathname) ||
  startsWithSegment(pathname, "/login") ||
  startsWithSegment(pathname, "/reset-password");

/**
 * Accepts only same-site relative paths. Blocks open redirects such as
 * `//evil.com`, `/\evil.com`, `https://evil.com` and `javascript:` payloads.
 */
export function safeNextPath(next: string | null | undefined, fallback = DEFAULT_AFTER_LOGIN): string {
  if (!next || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const parsed = new URL(next, "http://placeholder.invalid");
    if (parsed.origin !== "http://placeholder.invalid") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

export interface RedirectInput {
  pathname: string;
  search?: string;
  isAuthenticated: boolean;
  /** Signed in with a password but still owes the second factor. */
  mfaPending: boolean;
}

/** Where to send this request instead, or null to let it through. */
export function resolveAuthRedirect({
  pathname,
  search = "",
  isAuthenticated,
  mfaPending,
}: RedirectInput): string | null {
  const next = encodeURIComponent(`${pathname}${search}`);

  if (isProtectedPath(pathname)) {
    if (!isAuthenticated) return `/login?next=${next}`;
    if (mfaPending) return `/login/mfa?next=${next}`;
    return null;
  }

  if (pathname === "/login/mfa") {
    if (!isAuthenticated) return "/login";
    return mfaPending ? null : DEFAULT_AFTER_LOGIN;
  }

  if (isAuthPage(pathname) && isAuthenticated && !mfaPending) return DEFAULT_AFTER_LOGIN;

  return null;
}
