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

`IP_HASH_SECRET` and `CRON_SECRET` are random strings you generate yourself: `openssl rand -hex 32`.
