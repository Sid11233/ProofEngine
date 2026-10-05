import { isIP } from "node:net";

/**
 * Whether x-real-ip / x-forwarded-for can be believed. They are only trustworthy when a proxy we
 * control overwrites them: Vercel does (it sets VERCEL=1). Anywhere else in production the client
 * could send these headers itself and pick its own rate-limit bucket, so they are ignored unless
 * TRUST_PROXY_HEADERS=1 says a trusted proxy sits in front. In development they are accepted.
 */
export function trustsProxyHeaders(env: Record<string, string | undefined> = process.env): boolean {
  if (env.TRUST_PROXY_HEADERS === "1") return true;
  if (env.TRUST_PROXY_HEADERS === "0") return false;
  return env.VERCEL === "1" || env.NODE_ENV !== "production";
}

/**
 * Best-effort client IP. Anything that is not a valid IP becomes "unknown" so a forged header
 * cannot be used to pick a rate-limit bucket by injecting odd strings.
 */
export function getClientIp(headers: Pick<Headers, "get">, env: Record<string, string | undefined> = process.env): string {
  if (!trustsProxyHeaders(env)) return "unknown";
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && isIP(ip) !== 0) return ip;
  }
  return "unknown";
}
