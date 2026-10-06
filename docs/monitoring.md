# Monitoring and alerts (Phase 11.4)

## What is reported, and what never is

Errors are reported with Sentry from the **server only** (`src/instrumentation.ts`). There is no Sentry code in
any browser bundle, so no page gets heavier, no visitor's typing can be captured, and the Content-Security-Policy
did not have to be loosened (`connect-src 'self'`). Without `SENTRY_DSN` nothing is initialised and nothing leaves the app.

Before an event is sent it is stripped twice: the SDK is told to collect no personal data
(`src/lib/monitoring/sentry-options.ts`: no cookies, headers, bodies, query strings, user, local variables, code
context, breadcrumbs or traces) and `scrubEvent` (`src/lib/monitoring/scrub.ts`) removes what still slips
through: the request body, cookies, headers and query string, the user and server name, extras, free-form
contexts, and any email address, JWT, Stripe key, bearer token, 43-character link token, SHA-256 hash, signed
link token or IPv4 address in any message, URL or tag. Token segments in `/i`, `/preview`, `/approve`,
`/unsubscribe`, `/remove` and `/invite` URLs become `[redacted]`.

Tests: `scrub.test.ts` (every vector), and `sentry-pipeline.test.ts`, which runs the **real SDK with the production
options** and checks the bytes that would have been sent (it fails if the options are weakened).

## Security signals

Counts of things that are normal in small numbers and a warning in large ones. When a count passes its
threshold inside the window, **one** alert is sent per cooldown: a Sentry message tagged `signal=<name>` and, if
`ALERT_EMAIL` and Resend are configured, a short plain-text email. Alerts never contain a name, email, token or
content, only the signal, how many events and over how long.

| Signal (`signal` tag) | Raised by | Alert when | Cooldown |
| --- | --- | --- | --- |
| `failed_login` | wrong password at sign in | more than 30 in 10 min | 1 h |
| `interview_token_miss` | an interview link that is unknown, revoked, expired or closed | more than 60 in 10 min | 1 h |
| `webhook_failure` | the Stripe webhook handler threw (also sent to Sentry as an error) | more than 2 in 10 min | 1 h |
| `webhook_bad_signature` | a request to the Stripe webhook with a missing or wrong signature | more than 20 in 10 min | 1 h |
| `permission_error` | a database permission or RLS refusal (code 42501) | more than 50 in 10 min | 1 h |
| `ai_spend_limit` | the daily AI token limit was reached and interviews paused | the first time | 24 h |

Thresholds live in `SIGNAL_RULES` (`src/lib/monitoring/signals-core.ts`). Counts are shared across serverless
instances only when Upstash is configured (otherwise each instance counts alone, so set
`REQUIRE_DISTRIBUTED_RATE_LIMIT=1` in production).

## Setting it up

1. Create a Sentry project (platform: Next.js) and put its DSN in `SENTRY_DSN` in Vercel (production and preview).
2. In Sentry, create **alert rules** (Alerts, Create alert, Issues): one rule "when an event is seen with tag
   `signal` (any value), notify <you>", and one "when a new issue is created in production, notify <you>". The
   `area=stripe-webhook` tag marks handled webhook errors.
3. Set `ALERT_EMAIL` so signals also reach you by email even if Sentry is unreachable.
4. The free Sentry plan has a small monthly quota; sampling is off for traces, only errors are sent. If you
   exceed the quota Sentry stops recording until next month, nothing breaks.
5. Source maps are not uploaded (no auth token is configured): server stack traces are readable as they are.
   Add the Sentry build plugin later if you want original names in stack traces.

## What to look at weekly

Failed sign-in and unknown-link alerts, open Sentry issues, takedown requests (`/app/admin/takedowns`), the
Vercel cron log for `/api/cron/*` (reminders, billing, purge), and Stripe webhook delivery failures in the Stripe dashboard.
