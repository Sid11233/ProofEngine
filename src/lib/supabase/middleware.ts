import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/security/env.public";
import { hardenCookie } from "./cookie-options";

/**
 * Refreshes the Supabase session for a request and reports who the user is.
 * `requestHeaders` carries the CSP nonce so the response still forwards it.
 */
export async function updateSession(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          // The refreshed cookies must reach the page being rendered too.
          requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, hardenCookie(options));
          }
        },
      },
    },
  );

  // getUser() revalidates the JWT with Supabase; getSession() alone is not trustworthy.
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;

  let mfaPending = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaPending = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  }

  return { response: () => response, user, mfaPending };
}
