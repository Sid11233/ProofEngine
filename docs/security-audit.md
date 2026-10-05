# Security audit (vibe-security checklist)

Scope: the whole repository at the end of Phase 5, audited against the nine areas of the
`vibe-security-skill-main` checklist. Method: reading every migration, server action and route
handler; probing the live schema (catalog queries); attacking the running production build (headers,
cookies, CORS, redirects, bundle contents); scanning git history; running `npm audit`. Every
finding below has a regression test, and each was reproduced against the old code before fixing.

## Findings and fixes

| # | Severity | Finding | Fix | Guarded by |
|---|---|---|---|---|
| H1 | **High** | The Supabase session cookie was readable by JavaScript (`httpOnly=false`), so any future XSS would be a full account takeover. | Session cookies are HttpOnly, SameSite=Lax, Secure in production (`src/lib/supabase/cookie-options.ts`). The unused browser Supabase client was deleted. | `e2e/security` (cookie flags, `document.cookie`, storage), unit test |
| H2 | **High** | A stolen or left-open session could change the account password with no proof of identity, turning a hijack into a permanent takeover. | `resetPasswordAction` requires a recent sign-in (fresh reset link or login; MFA users complete MFA). `secure_password_change = true` in `config.toml`. | `e2e/security` (stale session cannot change it; fresh can) |
| H3 | **High** | Editors could INSERT directly into `case_studies`, `case_study_versions` and `claims`, bypassing the consent gate, schema validation and version numbering. The claim trigger also accepted a quote from *any* client message in the workspace, so a claim could be attached to another client's study. | Direct INSERT revoked; creation only through `create_generated_case_study`. The claim trigger now requires the quote to come from the interview the case study was generated from. | pgTAP `03_security_catalog`, `isolation.test` (direct inserts by every role), `hardening.test` (cross-interview claim) |
| M1 | Medium | Editors could write arbitrary entries to the audit log (`member.remove`, `token.revoke`...), forging history. | `write_audit_log()` accepts only a fixed list of UI events. | `isolation.test` (six forged actions refused) |
| M2 | Medium | The client IP came from `X-Forwarded-For`/`X-Real-IP` unconditionally, so anywhere without a proxy that overwrites them a client could pick its own rate-limit bucket. | Forwarded headers are trusted only on Vercel, in development, or when `TRUST_PROXY_HEADERS=1`. | unit tests, `e2e/security` (rotating headers does not reset the limit) |
| M3 | Medium | SECURITY DEFINER functions pinned `search_path = public, pg_temp`, and six helper/trigger functions were executable by `anon` through the REST API. | Every function pins an empty `search_path`; helpers and trigger functions are no longer callable by anon (trigger functions by nobody). | pgTAP `03_security_catalog` (the whole RPC surface is an explicit allowlist) |
| M4 | Medium | Supabase config: 6 character passwords, `secure_password_change` off, `graphql_public` schema exposed though unused. | 12 characters, secure password change on, only `public` exposed. **Hosted project: see the checklist below.** | config reviewed; CI runs against it |
| M5 | Medium | CI actions pinned by movable tag; Supabase CLI at `latest`. | Pinned to commit SHAs and CLI `2.119.0`. | workflow |
| L1 | Low | `selectTemplateAction` and the `/auth/callback` and `/auth/confirm` GETs had no rate limit. | Added (callbacks 200/hour/IP). | unit + existing e2e |
| L2 | Low | Names and descriptions could contain CR/LF and bidi/zero-width characters, which reach plain-text emails (line forging) and spoof display. | Single-line fields strip control and invisible characters (`src/lib/validation/text.ts`). | unit tests |
| L3 | Low | API responses had no explicit `Cache-Control`. | `private, no-store` on `/api/*`. | `e2e/security` |
| L4 | Low | No `Cross-Origin-Opener-Policy`. | `same-origin` on every response. | `e2e/security` |
| L5 | Low | npm advisories: PostCSS pinned inside Next (build time only) and the ESLint glob chain (dev only). | PostCSS forced to the patched release by an `overrides` entry: **`npm audit --omit=dev` reports 0**. The remaining 5 are dev-only (`braces`/`micromatch`/`fast-glob` through `eslint-config-next`), run on our own source files, and have no patched release. | `npm audit` |
| L6 | Low | `.env.local` was world-readable in the Codespace; pgTAP was installed in the `public` schema of the local stack. | `chmod 600`; pgTAP now in `extensions`, as on Supabase. | n/a |

## Checked and found sound

- **Secrets**: no keys or tokens in tracked files or in git history (the real `.env.local` values never appear in any commit); only `.env.example` is tracked and it holds placeholders; server secrets are not in the client bundle (scanned); no source maps are published; the only `NEXT_PUBLIC_` variables are the Supabase URL and anon key, the app URL and the Turnstile *site* key.
- **Row level security**: every public table has RLS; no policy is `true` except the global template catalogue; every UPDATE policy has `WITH CHECK`; views are `security_invoker`; `anon` holds no privilege on anything; token hash columns are neither readable nor writable by clients; storage buckets are private and have no client policy.
- **Auth**: every server action and route handler authenticates, validates with zod, and checks role (the database is the final authority: `getCurrentWorkspace()` picks one workspace but each function re-checks membership of the row's own workspace); `getUser()` always revalidates with Supabase; Next 15.5.27 is past CVE-2025-29927 and the app does not rely on middleware alone; cookie-authenticated POST routes check `Origin`; redirects only go to same-site paths.
- **Rate limiting**: all auth, AI-calling, email-sending, upload and secret-link endpoints are limited per IP and per user or token; counters live in Redis or memory and the only database counters are read-only to clients.
- **AI**: keys server-only; per-workspace and global spend caps; client text is tag-stripped and wrapped; model output is validated or replaced and never rendered as HTML; the model has no tools.
- **Input and output**: no raw SQL, no `$queryRawUnsafe`-style access, no `innerHTML`/`dangerouslySetInnerHTML`/`eval`; ids are validated as UUIDs before use; updates name their columns (no mass assignment); file uploads are type-checked by bytes, re-encoded and stored privately; no server-side fetch of a user-supplied URL (no SSRF).
- **Headers**: CSP with a per-request nonce (`strict-dynamic`), HSTS, frame denial, nosniff, referrer and permissions policies; no CORS headers anywhere; `X-Powered-By` removed.
- **Not applicable yet**: payments (Stripe arrives in Phase 8) and the mobile app (later). The webhook and price rules from the skill are already in the plan and will be tested then.

## Accepted risks and notes

- `style-src-attr 'unsafe-inline'` (style *attributes* only, for the case study theme). An attribute cannot run script and all user text is rendered as plain text.
- With email confirmation off, signing up with an existing address returns a different message than a new one (an enumeration signal). Production must have **email confirmation on** (below); Supabase then returns an indistinguishable response.
- Deleting a case study fails while it has versions, because versions are append-only. This is safe (it fails closed) but will need a deliberate deletion routine in the privacy work (Phase 11).
- The local-stack scripts contain throwaway development passwords and the public demo JWT secret. They only ever run on a developer machine.

## Checklist for the hosted Supabase project and other dashboards (cannot be done from code)

1. **Authentication → Providers → Email**: confirm email ON; minimum password length **12**; leaked-password protection ON; secure password change ON.
2. **Authentication → Multi-Factor**: TOTP enroll and verify ON.
3. **Authentication → URL Configuration**: Site URL and redirect allowlist set to your real domains only.
4. **Project Settings → API**: exposed schemas = `public` only (remove `graphql_public`); then run the **Security Advisor** and clear every warning.
5. **Storage**: buckets `uploads` and `exports` exist and are private (the migration creates them); create no public bucket.
6. **Vercel**: Production and Preview use *different* Supabase projects and keys; mark `SUPABASE_SERVICE_ROLE_KEY` Sensitive; leave `TRUST_PROXY_HEADERS` unset (Vercel is trusted automatically); keep Deployment Protection on for previews.
7. **Anthropic and Resend consoles**: set hard monthly spending limits and billing alerts (the app's own caps are a second line, not a replacement).
8. **GitHub**: branch protection on `main`, secret scanning with push protection, Dependabot alerts (the config file exists).
9. **If a secret was ever pasted into a chat, an issue or a shared screen, rotate it.** The service role key was briefly present in `.env.example` in this repository's working copy early on; it was never committed, but rotating it in Supabase costs nothing.
