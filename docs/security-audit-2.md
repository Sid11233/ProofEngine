# Security audit 2 (Phase 11, pre-launch)

Scope: the whole repository after Phase 10, reviewed as an external penetration tester following the twelve
checks in the build plan (prompt 11.1), then fixed (prompt 11.2). Method: reading every migration, server
action, route handler and public page; catalog queries against the live schema (policies, grants, definer
functions, buckets); grep sweeps for service-role use, HTML sinks, unbounded zod fields, logging, redirects,
outbound requests and secrets (working tree and git); attacking the running production build (CSP, CORS,
`security.txt`, rate limit floods, ten XSS payloads on every page that shows stored text, and a second
account trying the first one's data through pages, route handlers and the REST API); `npm audit`.

Nothing in this review was a critical or high finding: no route reads or writes another workspace's data,
no stored text can run as script, and no secret is in code, logs or the client bundle. The findings below are
defence in depth, abuse resistance and launch-readiness items. Each fix has a test that failed before it.

## Findings and fixes

| # | Severity | Finding (file) | Fix | Test (failed before the fix) |
|---|---|---|---|---|
| M1 | Medium | The four dashboard views (`page_event_daily`, `case_study_status_counts`, `referral_status_counts`, `request_funnel`, migration `20261011000001`) were created with default privileges, so the signed-in role held INSERT, UPDATE, DELETE and TRUNCATE on them. The tables underneath still refused every write, but a view must not advertise write access. | Migration `20261016000001_view_privileges.sql` leaves SELECT only. | pgTAP `03_security_catalog` ("authenticated can only SELECT from views") |
| M2 | Medium | Public site routes that read the database had no IP rate limit: the logo redirect (`src/app/sites/[workspace]/[slug]/logo/route.ts`), the workspace home (`.../[workspace]/page.tsx`) and the report form page (`.../report/page.tsx`). Only the story page was limited. | One shared limiter, `publicViewAllowed()` (`src/lib/public/view-limit.ts`, 120 per minute per IP), used by all four. | `view-limit.integration.test` (a 140-request flood gets 429; another address is unaffected) |
| M3 | Medium (launch) | Without Upstash the rate limiter silently falls back to per-instance memory (`src/lib/security/rate-limit.ts:27`). On serverless every instance counts separately, so every limit in `docs/limits.md` is a fraction of what it says. It only logged a warning. | New opt-in `REQUIRE_DISTRIBUTED_RATE_LIMIT=1`: the build and start fail without Upstash. **Set it in production** (launch checklist). | `env-schema.test` |
| L1 | Low | Fifteen route, action and page files used the service role client without importing `server-only` themselves, against the rule in CLAUDE.md (they were protected only by what they import). | `import "server-only"` added; a unit test now scans the source tree. | `server-only-guard.test` |
| L2 | Low | The unsubscribe action put the token into a redirect path unencoded (`src/app/unsubscribe/[token]/actions.ts:11`). Not an open redirect (the path starts `/unsubscribe/`) but dot segments could land on another same-site path. | Token shape is validated and always percent-encoded (`unsubscribe-path.ts`); the result word is from a fixed set. | `unsubscribe-path.test` |
| L3 | Low | `confirmPassword` had no length bound (`src/lib/auth/schemas.ts:37`). | `.max(200)`. | `schemas.test` |
| L4 | Low | CSP `connect-src` allowed the Supabase origin (`src/lib/security/csp.ts:29`) although the browser never talks to Supabase (no browser client exists), giving injected script a place to send data. | `connect-src 'self'` only. Signed logo images still load (`img-src`). | `csp.test`, `e2e/hardening` (live header) |
| L5 | Low | No `/.well-known/security.txt` (plan item 11.4). | Route generated from `SECURITY_CONTACT`; 404 until set, so it never advertises a made-up address. | `security-txt.test`, `e2e/hardening` |
| I1 | Info, accepted | `bump_ai_usage()` lets an editor add to their **own** workspace's AI counter (at most 10 per call). Same power as generating repeatedly; no cross-tenant effect. | Accepted. | n/a |
| I2 | Info, accepted | `npm audit`: 5 high, all dev-only (`braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`); **`npm audit --omit=dev` reports 0**. Every `braces` release is flagged, there is no patched version. | Accepted; re-check when a fix ships. | `npm audit` |
| I3 | Info, accepted | Public pages are cached at the CDN for 60 seconds, which also repeats a CSP nonce for that time. The pages contain only escaped text and no user HTML, so there is nothing for a nonce to protect. | Accepted. | `e2e/xss` |
| I4 | Info, accepted | Unsubscribe links do not expire and depend on `IP_HASH_SECRET` (or the service role key if unset). | Accepted; set `IP_HASH_SECRET` before launch so key rotation does not break old links. | n/a |

## What was checked and found clean

1. **Service role outside server-only files**: every user is a route handler, server action, server page or `server-only` module; no client component imports it (`server-only-guard.test`).
2. **RLS and policies**: every table has RLS and explicit policies; the only unconditional policy is the read-only template catalogue; the catalog guard fails on any new unreviewed table, function, view or anonymous privilege.
3. **Authentication and role checks**: all 60 server actions and route handlers authenticate (cookie, token, signature or secret) and check role before acting; the database re-checks membership and role in every function.
4. **IDOR**: ids in requests are always used through the caller's own client (RLS) or a definer function that checks membership of the row's workspace. `e2e/cross-tenant` has a second account attack the first one's study, request, interview, referral, tracker, preview link, wall settings, push subscription, invites and billing through pages, route handlers and 14 RPC functions, then verifies nothing changed.
5. **HTML sinks**: no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or JSON-LD anywhere. The widget builds HTML only through the tested `esc()`/`safeHref()`. `e2e/xss` stores ten payloads in names, headlines, metrics, quotes, notes and the workspace name and opens every page that shows them: nothing ran and no element or attribute was injected.
6. **Validation**: every input is zod-validated and strict; every string and array has a bound (the unbounded ones are Stripe event metadata, which is signature-verified and capped at 1 MB, and the model's own output, which is verified claim by claim).
7. **Rate limits**: every public, token, webhook, cron and AI endpoint is limited (see M2/M3).
8. **Secrets and logs**: no secret in the working tree or git history; no key, token, email, transcript or request body is logged (six `console` calls, all fixed strings or error names); the client bundle is scanned in `e2e/bundle`.
9. **Tokens**: interview, preview, approval, invite and unsubscribe tokens are 32 random bytes (or an HMAC), stored hashed, compared in constant time, expiring (except unsubscribe, I4) and single use where the flow requires it.
10. **CORS, CSP, cookies, headers**: no CORS headers are sent (`e2e/hardening` checks preflights from another origin); CSP is nonce based with no `unsafe-eval`; session cookies are HttpOnly, SameSite=Lax, Secure in production; HSTS, nosniff, frame denial, COOP, Permissions-Policy and no-store on secret-link pages are set.
11. **Open redirects, SSRF, files**: redirects use `safeNextPath` or fixed paths; the server only calls fixed hosts (Supabase, Stripe, Resend, Anthropic, Turnstile) and push endpoints that pass a push-service allowlist; uploads are type-sniffed, size capped and re-encoded.
12. **Dependencies**: see I2.

## Left for the pre-launch checklist (not code)

See [launch-checklist.md](launch-checklist.md): an independent second review of the RLS policies, Dependabot at zero critical or high, Supabase Security Advisor, production key rotation, SPF/DKIM/DMARC, one tested backup restore, lawyer review.
