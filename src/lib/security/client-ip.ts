import { isIP } from "node:net";

/**
 * Best-effort client IP from proxy headers. On Vercel these are set by the
 * platform and cannot be spoofed by the caller. Anything that is not a valid IP
 * becomes "unknown" so a forged header cannot be used to pick a rate-limit bucket.
 */
export function getClientIp(headers: Pick<Headers, "get">): string {
  const candidates = [headers.get("x-real-ip"), headers.get("x-forwarded-for")?.split(",")[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && isIP(ip) !== 0) return ip;
  }
  return "unknown";
}
