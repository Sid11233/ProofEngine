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
  // Keep other sites from holding a reference to our windows (tabnabbing, cross-window attacks).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Deny powerful browser features the app does not use.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      // Everything except the embeddable widget, which must be framable by the sites an admin lists
      // (its own CSP frame-ancestors is the allowlist, and it contains no scripts).
      { source: "/((?!embed$).*)", headers: securityHeaders },
      {
        source: "/embed",
        headers: securityHeaders.filter((h) => h.key !== "X-Frame-Options" && h.key !== "Cross-Origin-Opener-Policy"),
      },
      // API responses can hold private data: never let a browser or shared cache keep them.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      // The service worker must always be re-checked by the browser so a fixed worker reaches everyone.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/app/" }] },
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
      // Unsubscribe links carry a signed token.
      {
        source: "/unsubscribe/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      // Client approval links carry a secret and show unpublished work.
      {
        source: "/approve/:path*",
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
