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
    return [
      { source: "/:path*", headers: securityHeaders },
      // Interview pages carry a secret in the URL: keep them out of search engines and never leak them in Referer.
      {
        source: "/i/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      // Client preview links carry a secret too, and show unpublished work.
      {
        source: "/preview/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/api/interview/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
