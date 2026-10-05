import { NextResponse, type NextRequest } from "next/server";
import { needsSession, resolveAuthRedirect } from "@/lib/auth/redirects";
import { isSitesPath, siteSubdomain } from "@/lib/public/host";
import { buildCsp } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    isDev: process.env.NODE_ENV !== "production",
  });

  // Next.js reads the CSP request header to attach the nonce to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const { pathname, search } = request.nextUrl;

  // Public sites: a workspace subdomain is rewritten to /sites/<workspace>/... with no session and
  // no cookies. The internal /sites tree is not reachable on the app host.
  const workspace = siteSubdomain(request.headers.get("host"), process.env.PUBLIC_SITES_DOMAIN);
  if (workspace) {
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${workspace}${pathname === "/" ? "" : pathname}`;
    const rewritten = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    // The embed widget sets its own CSP (frame-ancestors is the workspace's allowlist).
    if (pathname !== "/embed") rewritten.headers.set("Content-Security-Policy", csp);
    // Short shared-cache window: an unpublished page disappears from the CDN within a minute.
    rewritten.headers.set("Cache-Control", "public, max-age=0, s-maxage=60");
    return rewritten;
  }
  if (isSitesPath(pathname)) {
    return new NextResponse("Not found", { status: 404, headers: { "Content-Security-Policy": csp } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  let isAuthenticated = false;
  let mfaPending = false;

  if (needsSession(pathname)) {
    const session = await updateSession(request, requestHeaders);
    response = session.response();
    isAuthenticated = session.user !== null;
    mfaPending = session.mfaPending;
  }

  const target = resolveAuthRedirect({ pathname, search, isAuthenticated, mfaPending });
  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.nextUrl.origin));
    // Keep any refreshed auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets; prefetches do not need their own nonce.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
