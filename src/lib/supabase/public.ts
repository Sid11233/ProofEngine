import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/security/env.public";

/** Anonymous client: anon key, no session, no cookies. It can read only the public_case_studies view. */
export const createPublicClient = () =>
  createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
