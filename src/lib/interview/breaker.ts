import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Global daily AI spend circuit breaker. True means "pause interviews for today".
 * The first call after the limit is crossed also fires `alert` exactly once.
 */
export async function isBreakerTripped(
  admin: SupabaseClient,
  tokenLimit: number,
  alert: () => Promise<void>,
): Promise<boolean> {
  const { data, error } = await admin.rpc("check_ai_breaker", { token_limit: tokenLimit });
  const row = Array.isArray(data) ? data[0] : null;
  // If the check itself fails, keep serving: an outage in this table must not take interviews down.
  if (error || !row) return false;
  if (row.newly_tripped) await alert().catch(() => undefined);
  return row.tripped === true;
}

export const MAINTENANCE_MESSAGE = "This interview is briefly unavailable. Please try again later today.";
