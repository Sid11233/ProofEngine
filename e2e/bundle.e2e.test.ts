import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadLocalConfig } from "../supabase/tests/isolation/harness";

// Phase 8/9 gate: no secret key, webhook secret or private VAPID key in anything shipped to the browser.
// Run after `npm run build`. The scan covers every file under .next/static (all client JavaScript and CSS) and public/.

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the client bundle", () => {
  const roots = [".next/static", "public"];
  const all = roots.flatMap(files).filter((f) => /\.(js|css|html|json|txt|map|webmanifest)$/.test(f));
  const text = all.map((f) => [f, readFileSync(f, "utf8")] as const);

  it("was built (run npm run build first)", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it("contains no service role key, Stripe secret, webhook secret or private VAPID key", () => {
    const cfg = loadLocalConfig();
    const secrets = [cfg.serviceKey, process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET, process.env.VAPID_PRIVATE_KEY, process.env.CRON_SECRET, process.env.IP_HASH_SECRET, process.env.ANTHROPIC_API_KEY, process.env.RESEND_API_KEY].filter((v): v is string => Boolean(v && v.length >= 20));
    expect(secrets.length).toBeGreaterThan(0);
    for (const [file, body] of text) {
      for (const secret of secrets) expect(body.includes(secret), `${file} contains a server secret`).toBe(false);
    }
  });

  it("contains no key-shaped strings or server-only variable names", () => {
    const patterns: Array<[string, RegExp]> = [
      ["Stripe secret key", /\bsk_(live|test)_[A-Za-z0-9]{10,}/],
      ["Stripe restricted key", /\brk_(live|test)_[A-Za-z0-9]{10,}/],
      ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{10,}/],
      ["service role JWT claim", /"role"\s*:\s*"service_role"/],
      ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ];
    const names = ["SUPABASE_SERVICE_ROLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY", "VAPID_PRIVATE_KEY", "IP_HASH_SECRET", "CRON_SECRET", "ANTHROPIC_API_KEY", "RESEND_API_KEY", "TURNSTILE_SECRET_KEY"];
    for (const [file, body] of text) {
      for (const [label, re] of patterns) expect(re.test(body), `${file}: ${label}`).toBe(false);
      for (const name of names) expect(body.includes(name), `${file} mentions ${name}`).toBe(false);
    }
  });

  it("does not ship the server-only libraries", () => {
    for (const [file, body] of text) {
      expect(body.includes("webpush.sendNotification") || body.includes("generateVAPIDKeys"), `${file} contains web-push server code`).toBe(false);
      expect(body.includes("constructEvent"), `${file} contains the Stripe webhook verifier`).toBe(false);
    }
  });
});
