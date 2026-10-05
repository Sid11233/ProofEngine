import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/security/env.public";
import { hardenCookie } from "./cookie-options";

/**
 * Supabase client acting as the signed-in user (anon key + their JWT), so RLS
 * applies. This is the default client for server components, actions and routes.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, hardenCookie(options));
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: the session-refresh helper persists them.
          }
        },
      },
    },
  );
}

/**
 * Anon client that stores no session. Used to check a password without touching
 * the caller's cookies.
 */
export function createStatelessClient() {
  return createJsClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
