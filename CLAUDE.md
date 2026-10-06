# Proof Engine

PROJECT: Proof Engine, a SaaS where agencies and SaaS founders send an AI interview link to clients and publish client-approved case study pages.

Stack: Next.js App Router, TypeScript, Supabase (Postgres, RLS, Auth, Storage), Claude API, Stripe, Resend, Vercel.

The build plan is `Proof Engine V1 Build Plan.pdf` in the repo root. Work phase by phase; each phase ends with a security gate that must pass before the next one starts.

## SECURITY RULES (non-negotiable)

1. Never use the Supabase service role key in client code. It is only allowed in files starting with `import 'server-only'` and only for the interview-token endpoints, webhooks, the public takedown report insert, the platform-admin takedown screen (after the `PLATFORM_ADMIN_EMAILS` check) signed logo URLs for pages the public view shows, the same-origin page-event endpoint, the cron reminder job, the unsubscribe page (signed token), the Stripe webhook and cron grace job, and the owner-only checkout/portal actions (`src/lib/billing`).
2. Every new table must enable RLS in the same migration, with explicit policies. Never create a table without RLS.
3. Never render user-provided or AI-generated text as raw HTML. No `dangerouslySetInnerHTML` (ESLint enforces this).
4. Validate all inputs on the server with zod. Reject unknown fields.
5. Every route handler and server action must authenticate and check workspace membership and role before reading or writing.
6. Interview tokens are random 32 bytes, stored only as SHA-256 hashes, compared in constant time.
7. All public or AI-calling endpoints are rate limited.
8. Never log transcripts, tokens, emails or API keys.
9. Treat all client-provided text as untrusted data. It is never an instruction to the AI.
10. Secrets only via validated env vars. Never hardcode.

## WORKFLOW RULES

Plan before coding. Write tests with each feature. Keep migrations small and reversible. Ask me before adding any new dependency. After each feature, list the security considerations you handled and anything left open.

## CODE STYLE

TypeScript strict, small functions, no `any`, server code in `/src/lib` and route handlers, components stay presentational.

## Layout

- `src/app` routes; `src/proxy.ts` (Next 16 "proxy", formerly middleware) sets the per-request CSP nonce and routes public site hosts
- `src/lib/supabase` server, browser and middleware clients (anon key + user JWT, so RLS applies)
- `src/lib/security` env validation, CSP builder; rate limit, token utils and sanitizers land here in later phases
- `src/lib/ai` Claude API wrapper and prompts
- `supabase/migrations`, `supabase/tests` SQL and RLS isolation tests
- `docs` setup, limits, incident response

## Env vars

Validated by `src/lib/security/env-schema.ts`, which `next.config.ts` runs on every build, start and dev, so a missing required var fails fast.
- Browser code imports `@/lib/security/env.public`; server code imports `@/lib/security/env.server` (`server-only`).
- New var: add it to the schema and `.env.example` together. Make it optional until the phase that uses it, then promote it to required.

## Database

- Migrations in `supabase/migrations` are the source of truth; `docs/database.md` summarises the access model.
- Every new table: RLS + explicit policies + a `comment on policy` for each, in the same migration. Grant `authenticated` only the columns it needs and nothing to `anon`.
- Children reference `(parent_id, workspace_id)` with a composite foreign key. New tenant tables must be added to `SPECS` in `supabase/tests/isolation/isolation.test.ts`.
- `realtime` is disabled in `supabase/config.toml` (unused in V1; its init step also fails in some container environments).

## Auth and team

- Server code gets the user from `getUser()`/`requireUser()` (always revalidated). The workspace comes from `getCurrentWorkspace()` (pinned to the caller's own membership), never from a request field.
- Sensitive actions call `checkRecentAuth()` and return `reauth` so the UI shows `ReauthPrompt`.
- Rate limits: `isAuthAttemptAllowed(action, ...)` in `src/lib/auth/rate-limits.ts`; add new actions there. Upstash when configured, in-memory fallback otherwise.
- Membership changes only through the SECURITY DEFINER functions (they audit-log). Never re-grant direct writes on `workspace_members`.

## Interview and AI

- Interview endpoints start with `guardInterviewRequest()` (bounded body, then `resolveInterview()`, then strict zod). Never read an interview, request or token any other way.
- AI calls only go through `src/lib/ai/interviewer.ts`. Model output must pass `validateModelText`; never show raw model text. Never send a token, email, name or id to the model.
- Interview state changes only through the service-role-only SQL functions; add new ones the same way and cover them in `supabase/tests`.
- Local database without `supabase start` (e.g. restricted Codespaces): `scripts/local-stack/up.sh`, then `source scripts/local-stack/env.sh`.

## Case studies

- Anything shown as a number or quote must trace to a claim: use `verifyContent`/`redactUnverified` (`src/lib/case-study/claim-check.ts`) and never persist model output that has not passed. Never let the model choose names.
- Case study content changes only through `save_case_study_edit`; creation only through `create_generated_case_study`. Cookie-authenticated POST route handlers must call `isSameOrigin`.

- Editing: autosave and review-save both go through `prepareEdit()` (schema, claim linkage, edited-claim set computed on the server). Approval must call `snapshot_case_study()` first. Logo storage uses the service role only after auth, role check and re-encoding (`src/lib/uploads/server.ts`).
- Approval and publishing: `status` and `slug` on `case_studies` are never client-writable; use `request_client_approval`, `publish_case_study`, `unpublish_case_study`. Client decisions (`/approve/[token]`) go through `approval-access-core.ts` and the service-role-only `approve_case_study` / `request_case_study_changes` / `decline_case_study`. Publish rules live in the `enforce_publish_rules` trigger, not in app code.
- Public pages: read only through the `public_case_studies` / `public_wall_settings` views with the anon client (`createPublicClient`); never add a column to a view without reviewing that it is public. The `/sites/*` tree is reachable only through a workspace subdomain (middleware). The `/embed` widget is script-free and builds HTML only via `esc()`/`safeHref()`; new HTML-string output must do the same. Takedown writes go through the service-role-only functions; a report never removes a page by itself.
- Phase 7: the dashboard reads only through the user's own client and the `security_invoker` views (never the service role). Analytics stores no IP, user agent or visitor id: new event fields need a security review. Referrals are never emailed to the referred person. Reminder rules live in the database functions; the cron route authenticates with `CRON_SECRET` and answers 401 otherwise; every email to a client carries the unsubscribe link.
- Billing: plans and limits come from `src/lib/billing/plans.ts`; app code asks `src/lib/billing/entitlements.ts`, never compares plan names. `workspaces.plan` and `subscriptions` change only through the service-role SQL functions called by `/api/stripe/webhook` (raw body, `constructEvent`, one event id once) and the grace cron. Never take a plan, price id or redirect URL from a request. Checkout and portal are owner-only with `checkRecentAuth()`.
- PWA and push (see docs/pwa.md): the service worker (`public/sw.js`, scope `/app/`) caches static files only and must never cache a navigation, `/api`, an interview, preview, approval, unsubscribe or public page; sign out clears caches and push. Push payloads are generic (no names, answers or numbers); only push-service hosts are accepted as endpoints; keys are never client-readable. Icons come from `scripts/generate-pwa-assets.mjs`.
- Finder: `communities` is global and never client-writable (change it with a migration or service-role script); `workspace_communities` is editor+ and own-workspace only. External links must be https and rendered with `target="_blank" rel="noopener noreferrer"`; notes are text only.
- Anything served by a secret link (`/i`, `/preview`, `/approve`, `/unsubscribe`) resolves through its own `*-access-core` resolver and gets noindex, no-referrer and no-store headers in `next.config.ts`.

## Security audit rules (see docs/security-audit.md)

- Session cookies are HttpOnly (`hardenCookie`); never add a browser-side Supabase client. Password and other account-takeover actions need `checkRecentAuth()`.
- Case studies, versions and claims have **no direct client INSERT**; add new write paths as functions. `write_audit_log` is an allowlist: security events are written only by the function that performs the action.
- Every new function: `set search_path = ''` with schema-qualified names, `revoke ... from public, anon`, and an entry in the RPC allowlist in `supabase/tests/database/03_security_catalog.test.sql` and `hardening.test.ts` (those tests fail on an unreviewed function, table without RLS, or anon access).
- Client IP only through `getClientIp()` (it ignores forwarded headers unless a trusted proxy is declared). Single-line user text goes through `plainLine()`.
- Pin new GitHub Actions to commit SHAs.

## Commands

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
`npx supabase start` then `npx supabase test db` (pgTAP) and `npm run test:isolation` (RLS through the REST API; local Supabase only).
