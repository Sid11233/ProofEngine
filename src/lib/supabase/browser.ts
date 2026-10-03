import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/security/env.public";

/** Browser client: anon key only. RLS is the only thing protecting data here. */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
