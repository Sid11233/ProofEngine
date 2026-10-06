import { z } from "zod";
import { SECURITY_CONTACT_PATTERN } from "./security-txt";

// Pure schema and parsing, with no `server-only` import, so next.config.ts and
// tests can use it. App code should import `env.public` or `env.server`.

// Blank values (e.g. `FOO=` copied from .env.example) count as unset.
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const required = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema);
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/** The lowercase emails in a comma-separated list, or null if any is invalid or there are more than 10. */
export function parsePlatformAdmins(value: string | undefined): string[] | null {
  const list = (value ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length <= 10 && list.every((e) => z.email().safeParse(e).success) ? list : null;
}

const secret = z.string().min(20, "looks too short to be a real key");

/** Safe to ship to the browser. Every name MUST start with NEXT_PUBLIC_. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: required(z.url()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(secret),
  NEXT_PUBLIC_APP_URL: required(z.url()),
  // Cloudflare Turnstile site key (public). Optional until you configure Turnstile.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optional(z.string().min(1)),
});

/**
 * Server only. Never import this from client code (env.server.ts enforces it).
 * Variables marked "Phase N" are optional until that phase lands; promote them
 * to required() in the same PR that starts using them.
 */
export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: required(secret),

  // Phase 2: rate limiting
  UPSTASH_REDIS_REST_URL: optional(z.url()),
  UPSTASH_REDIS_REST_TOKEN: optional(z.string().min(1)),
  // "1" makes a missing Upstash configuration a build/start error. Set it in production: without Upstash every
  // serverless instance keeps its own counters, so rate limits are only a fraction of what they say.
  REQUIRE_DISTRIBUTED_RATE_LIMIT: optional(z.enum(["0", "1"])),

  // Phase 2/3: email
  RESEND_API_KEY: optional(z.string().min(1)),
  RESEND_FROM_EMAIL: optional(z.string().min(3)),

  // Phase 3: AI interviewer
  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  INTERVIEWER_MODEL: optional(z.string().min(1)),
  GENERATOR_MODEL: optional(z.string().min(1)),
  TURNSTILE_SECRET_KEY: optional(z.string().min(1)),

  // "1" when a proxy you control overwrites X-Forwarded-For (Vercel does this automatically)
  TRUST_PROXY_HEADERS: optional(z.enum(["0", "1"])),

  // Abuse and spend limits (defaults in src/lib/limits.ts, documented in docs/limits.md)
  AI_MESSAGES_FREE: optional(z.coerce.number().int().min(0)),
  AI_MESSAGES_PRO: optional(z.coerce.number().int().min(0)),
  AI_MESSAGES_TEAM: optional(z.coerce.number().int().min(0)),
  AI_DAILY_TOKEN_LIMIT: optional(z.coerce.number().int().min(1)),
  INTERVIEW_STARTS_PER_IP_HOUR: optional(z.coerce.number().int().min(1)),
  ALERT_EMAIL: optional(z.email()),

  // Phase 6: domain public case study pages are served from, one subdomain per workspace
  // (e.g. "proofengine.page", or "localhost:3000" in development). Unset: public pages are off.
  PUBLIC_SITES_DOMAIN: optional(z.string().min(3).max(100).regex(/^[a-z0-9.:-]+$/i, "hostname and optional port only")),

  // Phase 9: web push. The private key is server-only; the subject is a mailto: or https: contact for push services.
  // The public half is not secret, but it is read on the server at runtime and passed to the page as a prop.
  VAPID_PUBLIC_KEY: optional(z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, "a base64url VAPID public key")),
  VAPID_PRIVATE_KEY: optional(z.string().regex(/^[A-Za-z0-9_-]{40,60}$/, "a base64url VAPID private key")),
  VAPID_SUBJECT: optional(z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/, "mailto:you@example.com or an https URL")),

  // Phase 11: Sentry error reports (server side only; request bodies, cookies, headers and secrets are scrubbed). Unset: off.
  SENTRY_DSN: optional(z.url().refine((v) => v.startsWith("https://"), "an https DSN")),

  // Phase 11: where vulnerability reports go (mailto:you@example.com or an https URL), published as /.well-known/security.txt.
  SECURITY_CONTACT: optional(z.string().max(300).regex(SECURITY_CONTACT_PATTERN, "mailto:you@example.com or an https URL")),

  // Phase 6: comma-separated emails of the platform operators. They are told about takedown reports and
  // can open /app/admin/takedowns (after signing in with a verified account). Unset: nobody can.
  PLATFORM_ADMIN_EMAILS: optional(z.string().refine((v) => parsePlatformAdmins(v) !== null, "comma-separated valid emails, at most 10")),

  // Phase 6: approval IP hashing
  IP_HASH_SECRET: optional(z.string().min(32)),

  // Phase 7: cron
  CRON_SECRET: optional(z.string().min(32)),

  // How recent a sign-in must be for sensitive actions (default 600 = 10 minutes)
  REAUTH_MAX_AGE_SECONDS: optional(z.coerce.number().int().min(1).max(86400)),

  // Phase 8: Stripe
  STRIPE_SECRET_KEY: optional(z.string().min(1)),
  STRIPE_WEBHOOK_SECRET: optional(z.string().min(1)),
  // The Stripe Price id the Pro plan is sold under. Server config only: a price id from a browser is never used.
  STRIPE_PRICE_PRO: optional(z.string().regex(/^price_[A-Za-z0-9]+$/, "a Stripe price id (price_...)")),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

type Source = Record<string, string | undefined>;

/**
 * Names the offending variables only. Never echo values: they may be secrets
 * and this message ends up in build logs.
 */
function describeIssues(label: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "(unknown)");
    return `  - ${name} (${label}): ${issue.message}`;
  });
}

export function parsePublicEnv(source: Source): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      ["Invalid public environment variables:", ...describeIssues("public", result.error)].join("\n"),
    );
  }
  return result.data;
}

export function parseServerEnv(source: Source): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      ["Invalid server environment variables:", ...describeIssues("server", result.error)].join("\n"),
    );
  }
  return result.data;
}

/** Validates everything at once and reports all problems together. */
export function assertEnv(source: Source): { public: PublicEnv; server: ServerEnv } {
  const problems: string[] = [];
  const pub = publicEnvSchema.safeParse(source);
  const srv = serverEnvSchema.safeParse(source);
  if (!pub.success) problems.push(...describeIssues("public", pub.error));
  if (!srv.success) problems.push(...describeIssues("server", srv.error));

  // Pasting the service role key into the anon slot would expose it to browsers.
  if (
    pub.success &&
    srv.success &&
    pub.data.NEXT_PUBLIC_SUPABASE_ANON_KEY === srv.data.SUPABASE_SERVICE_ROLE_KEY
  ) {
    problems.push(
      "  - NEXT_PUBLIC_SUPABASE_ANON_KEY (public): must not equal SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  if (srv.success && srv.data.REQUIRE_DISTRIBUTED_RATE_LIMIT === "1") {
    if (!srv.data.UPSTASH_REDIS_REST_URL) problems.push("  - UPSTASH_REDIS_REST_URL (server): required while REQUIRE_DISTRIBUTED_RATE_LIMIT=1");
    if (!srv.data.UPSTASH_REDIS_REST_TOKEN) problems.push("  - UPSTASH_REDIS_REST_TOKEN (server): required while REQUIRE_DISTRIBUTED_RATE_LIMIT=1");
  }

  if (problems.length > 0 || !pub.success || !srv.success) {
    throw new Error(
      `Environment validation failed. Fix these in .env.local (dev) or Vercel env vars (prod):\n${problems.join("\n")}`,
    );
  }
  return { public: pub.data, server: srv.data };
}
