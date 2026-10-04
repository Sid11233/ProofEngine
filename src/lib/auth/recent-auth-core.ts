export const DEFAULT_REAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

/** One entry of the JWT `amr` claim: how and when the session proved identity. */
export interface AuthMethodEntry {
  method?: string;
  /** Unix seconds. */
  timestamp?: number;
}

/**
 * The most recent moment the user actively proved who they are (password, OAuth,
 * or an authenticator code), from the session token's `amr` claim. Entries dated in
 * the future beyond clock skew are ignored as untrustworthy.
 */
export function latestAuthTime(amr: unknown, now: number = Date.now()): number | null {
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr as AuthMethodEntry[]) {
    const seconds = typeof entry === "object" && entry !== null ? entry.timestamp : undefined;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) continue;
    const ms = seconds * 1000;
    if (ms > now + CLOCK_SKEW_MS) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/** True when the user proved identity recently enough for a sensitive action. */
export function isRecentAuth(
  amr: unknown,
  now: number = Date.now(),
  maxAgeMs: number = DEFAULT_REAUTH_MAX_AGE_MS,
): boolean {
  const latest = latestAuthTime(amr, now);
  return latest !== null && now - latest <= maxAgeMs;
}
