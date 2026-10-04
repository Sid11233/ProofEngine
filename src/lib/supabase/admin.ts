import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/security/env.public";
import { serverEnv } from "@/lib/security/env.server";

/**
 * Service-role client: BYPASSES row-level security. Allowed only in the
 * token-authenticated interview endpoints and webhooks (CLAUDE.md rule 1). Every
 * query made with it must be scoped by hand to one request or workspace.
 */
export function createAdminClient() {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
