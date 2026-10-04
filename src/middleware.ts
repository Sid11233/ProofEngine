import { NextResponse, type NextRequest } from "next/server";
import { needsSession, resolveAuthRedirect } from "@/lib/auth/redirects";
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
