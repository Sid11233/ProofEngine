import type { NextConfig } from "next";
import { assertEnv } from "./src/lib/security/env-schema";

// Fails `next build`, `next start` and `next dev` if a required env var is
// missing or malformed. See docs/setup.md.
assertEnv(process.env);

const securityHeaders = [
  // Force HTTPS for two years, including subdomains.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Stop browsers guessing a file's type (blocks MIME-sniffing attacks).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Never allow this app to be framed (clickjacking). CSP frame-ancestors repeats this.
  { key: "X-Frame-Options", value: "DENY" },
  // Send only the origin to other sites, nothing from the path or query.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful browser features the app does not use.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
