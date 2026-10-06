# Setup: Supabase, Vercel and local dev

Phase 0 of the build plan. The app needs only Supabase to build and run now; the other services are added in later phases (see the table at the end).

## 1. Supabase

Create **two** projects, `proof-dev` and `proof-prod`, so production data never mixes with testing. Use a strong database password and save it in a password manager.

For each project, open **Project Settings → API** (or **API Keys**) and copy:

| Supabase shows | Goes in env var | Visibility |
| --- | --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | public |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public (RLS protects the data) |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` | **secret**, bypasses RLS |

Newer projects label these "publishable" and "secret" keys. They are used the same way.

Never paste the service role key into chat, a `NEXT_PUBLIC_` var, or git. The build refuses to start if it equals the anon key.

### Local development

```bash
cp .env.example .env.local     # then fill in the proof-dev values
npm run dev                    # http://localhost:3000
```

`.env.local` is gitignored. If any required variable is missing or malformed, the app stops at startup and names the variable.

### Supabase CLI (for migrations from Phase 1)

```bash
npx supabase login
npx supabase link --project-ref <proof-dev project ref>   # ref = the subdomain in your project URL
```

`supabase/config.toml` is already initialised. Link **dev only**; apply migrations to prod deliberately with `supabase db push` once the isolation tests pass.

### Applying the schema to proof-dev (Phase 1)

After `supabase link`, review `supabase/migrations/` and run:

```bash
npx supabase db push        # dev project only; never push to prod until the isolation tests pass in CI
```

Then open **Security Advisor** in the dashboard and fix any warning (the gate is zero RLS warnings). See [database.md](database.md) for the access model.

### Dashboard settings to do now

- **Authentication → Providers → Email:** require email confirmation; minimum password length 12; enable leaked-password protection if available.
- **Authentication → URL Configuration:** set the Site URL and redirect allowlist to your real domains only (add the Vercel URL once you have it).
- **Storage:** later phases need private buckets `uploads` and `exports`. Do not create any public bucket.

## 2. Vercel

1. Push this repo to GitHub (private), then in Vercel choose **Add New → Project** and import it. Framework preset: Next.js (auto-detected). No build settings to change.
2. Before the first deploy, open **Settings → Environment Variables** and add all four required vars. Scope them like this:

   | Variable | Production | Preview | Development |
   | --- | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | prod project | dev project | dev project |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod project | dev project | dev project |
   | `SUPABASE_SERVICE_ROLE_KEY` | prod project (mark **Sensitive**) | dev project (**Sensitive**) | dev project |
   | `NEXT_PUBLIC_APP_URL` | your production URL | the preview URL or your dev domain | `http://localhost:3000` |

   Preview deployments use the **dev** Supabase project, never prod.
3. Deploy. A missing variable fails the build with a message naming it, so check the build log if it goes red.
4. Add the Vercel URL to the Supabase redirect allowlist.
5. Verify the headers: `curl -sI https://<your-deployment>/` should show `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options` and `Referrer-Policy`.

Custom domains come later: the app on `app.<yourproduct>.com`, interview links on `i.<yourproduct>.com`, and published pages on a **separate registrable domain**. Decide those names before Phase 3 and 6.

### Launch hardening (Phase 11)

Set `REQUIRE_DISTRIBUTED_RATE_LIMIT=1` once Upstash is configured: the app then refuses to build or start without it, instead of quietly counting rate limits per serverless instance. Set `SECURITY_CONTACT=mailto:security@yourdomain` to publish `/.well-known/security.txt`. Both are on the [launch checklist](launch-checklist.md).

### Install and notifications (Phase 9)

The app is installable and has an optional offline page: nothing to configure, except the icons come from the brand name until you provide a logo (`public/logo.png`, then `node scripts/generate-pwa-assets.mjs`). For push notifications run `npx web-push generate-vapid-keys` once and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com`) in Vercel. Details and the manual offline checklist: [pwa.md](pwa.md).

### Stripe billing (Phase 8)

Plan names and prices are placeholders: change `src/lib/billing/plans.ts` (and the matching number in the SQL function `plan_interview_limit`, which a test keeps in step) when you decide them.
1. In Stripe (test mode first) create a Product "Pro" with a recurring Price. Put its id in `STRIPE_PRICE_PRO` (`price_...`). Only this server-side id is ever sold; no price comes from the browser.
2. Set `STRIPE_SECRET_KEY` (restricted key is fine: Customers, Checkout Sessions and Billing Portal write access).
3. Add a webhook endpoint `https://<your app domain>/api/stripe/webhook` listening to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Turn on the Customer Portal (Stripe Dashboard, Settings, Billing, Customer portal) so owners can update cards, change plan and cancel.
5. `CRON_SECRET` (see Reminder emails) also protects `/api/cron/billing`, which runs daily at 09:30 UTC and ends 7 day payment grace periods.
Until the three Stripe variables are set the Billing page says paid plans are not available, and the webhook answers 503.

### Reminder emails (Phase 7)

Set `CRON_SECRET` (random, 32+ characters: `openssl rand -hex 32`) in Vercel. Vercel Cron then calls `/api/cron/reminders` daily at 09:00 UTC (`vercel.json`) with `Authorization: Bearer $CRON_SECRET`; without the secret the endpoint always answers 401. Reminders need `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with a verified sending domain: until email is configured the job changes nothing. Referral notifications use the same email setup.

### Public pages domain (Phase 6)

Published case studies are served from their own domain so they never share an origin with the app.
1. Buy or pick a domain for public pages (not the app domain), e.g. `proofengine.page`.
2. In Vercel add the domain **and** a wildcard `*.proofengine.page` to the project (wildcards need the domain's nameservers on Vercel, or a wildcard DNS record pointing at it).
3. Set `PUBLIC_SITES_DOMAIN=proofengine.page`. Unset means public pages are off.
4. Set `PLATFORM_ADMIN_EMAILS` to your own email(s) to receive takedown reports and open `/app/admin/takedowns`.
5. The CDN keeps a page for up to 60 seconds, so an unpublished or disabled page can stay visible that long. If you need it instant, purge by path from the Vercel dashboard.

## 3. Repo hygiene (GitHub)

- Branch protection on `main`; require pull requests.
- Settings → Code security: enable secret scanning, push protection and Dependabot alerts.

## 4. Accounts to create now, keys needed later

| Service | Needed in | Env vars |
| --- | --- | --- |
| Upstash Redis | Phase 2 | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Resend | Phase 2/3 | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| Anthropic API | Phase 3 | `ANTHROPIC_API_KEY` |
| Cloudflare Turnstile | Phase 3 | `TURNSTILE_SECRET_KEY` (+ a public site key then) |
| Stripe (test mode) | Phase 8 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Sentry | Phase 11 | added then |

`IP_HASH_SECRET` and `CRON_SECRET` are random strings you generate yourself: `openssl rand -hex 32`. If `IP_HASH_SECRET` is unset, approval IP hashes use a key derived from the service role key (rotating that key changes later hashes only).

## 5. Branding (name and logo)

The product name and logo live in one file, [src/lib/brand.ts](../src/lib/brand.ts). To rebrand:

1. Set `name` (used in page titles, headers, emails and the authenticator app label).
2. Put your logo in `/public` (SVG or PNG, square works best) and set `logo: "/your-logo.svg"` with a short `logoAlt`.
3. Replace `src/app/favicon.ico`. The PWA icons (192, 512 and maskable 512) are added in Phase 9.

Email sender name and domain are configured separately in Resend (`RESEND_FROM_EMAIL`).
