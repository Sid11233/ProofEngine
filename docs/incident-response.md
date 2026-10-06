# Incident response

**Incident owner:** <name, phone, email>  **Backup owner:** <name, phone, email>
Fill these in before launch. The owner decides severity, leads the steps below and writes the post-mortem.

## First 15 minutes, for any incident

1. **Write down the time** you learned of it and how (an alert, a user report, a security.txt report).
2. **Contain before you investigate**: switch off the thing that is leaking or being abused (the steps below), then look around.
3. **Preserve evidence**: do not delete logs. Note the Sentry issue, the Vercel deployment id and the Supabase project.
4. **Severity**: *high* = personal data exposed to someone who should not have it, or a key leaked; *medium* = abuse or an outage without exposure; *low* = a bug with no exposure.
5. **Tell the owner and backup**; for high severity, start the clock on notification duties (see "Suspected data leak").

Where to look: Sentry (errors and `signal` alerts), Vercel (deployments, runtime logs, cron logs), Supabase (logs, Auth users, Storage, the `audit_log` table), Stripe (webhook deliveries), Resend (sent mail), Upstash (rate limit keys).

## 1. A key or secret leaked

Assume it is public the moment it was exposed. Rotate first, then clean up. After every rotation, redeploy and run a smoke test (sign in, open an interview link, load a public page, send a test email).

| Secret | How to rotate | What breaks or changes |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project settings, API keys: create a new secret key, update Vercel, redeploy, delete the old one | Nothing for users. This key bypasses row-level security: if it leaked, treat it as a **data leak** (section 2) |
| Supabase anon key / JWT secret | Supabase, Project settings, JWT: rotate the JWT secret (signs everyone out), update `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the service key | All sessions end; users sign in again |
| `STRIPE_SECRET_KEY` | Stripe, Developers, API keys: roll the key (set a short expiry for the old one), update Vercel | Checkout and portal fail until redeployed |
| `STRIPE_WEBHOOK_SECRET` | Stripe, Webhooks, the endpoint: roll the signing secret, update Vercel | Webhooks fail (400) until redeployed; Stripe retries for days, nothing is lost |
| `RESEND_API_KEY` | Resend, API keys: create new, update, delete old | Emails fail until redeployed |
| `ANTHROPIC_API_KEY` | Anthropic console: create new, update, delete old. Check usage for abuse | Interviews fall back to canned questions until redeployed |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash, database, reset token, update Vercel | Rate limits fall back to per instance memory until redeployed |
| `VAPID_PRIVATE_KEY` (+ public key) | Generate a new pair (`npx web-push generate-vapid-keys`), update both, redeploy | Every push subscription stops working; users turn notifications on again |
| `CRON_SECRET` | New random value (`openssl rand -hex 32`) in Vercel; Vercel Cron picks it up on redeploy | None |
| `IP_HASH_SECRET` | New random value | Old **unsubscribe and "remove my story" links stop working** (they are signed with it); old approval IP hashes can no longer be matched. Prefer to leave it unless it leaked |
| `TURNSTILE_SECRET_KEY` | Cloudflare dashboard, Turnstile, rotate | Public forms fail verification until redeployed |
| `SENTRY_DSN` | Sentry, project settings, client keys: create a new key, disable the old | None. A DSN can only send events, not read them |
| A teammate's password or device | Remove the member (Team), have them reset the password and re-enrol two-factor | |

Then: search for the secret in git history and in places it may have been pasted, and add a note to the post-mortem about how it leaked.

## 2. Suspected data leak

1. **Contain**: if a workspace or account is involved, disable what is exposed: unpublish pages (`unpublish_case_study`), revoke links (requests, previews), rotate keys (section 1). If the leak is a bug, ship a fix or redeploy the previous good deployment (Vercel, Deployments, Promote).
2. **Scope it**: which tables or files, which workspaces, which time window. Use Supabase logs, the `audit_log` table (who changed what), Storage access logs and Vercel logs. Row-level security means a leak between workspaces is a bug in a policy or function: run `npm run test:isolation` and the catalog tests to find it.
3. **Decide the notification duties with the lawyer**: under GDPR a controller must notify the authority within 72 hours of becoming aware of a breach likely to put people at risk; as processor we must tell each affected customer without undue delay (the DPA template says within 48 hours). Customers (agencies) tell their clients; we help them.
4. **Tell affected customers** plainly: what happened, what data, what we have done, what they should do. No speculation.
5. **Remediate and verify**: fix the cause, add a regression test, rotate anything that may have been exposed, re-run the audit prompt.
6. **Post-mortem within a week**: timeline, cause, impact, what worked, what changes (template below).

## 3. Abusive or harmful page takedown

*A visitor or client reports a page* (the "Report this page" link, an email to the security contact, a client's removal link):

1. A report never removes a page by itself. Open `/app/admin/takedowns` (platform admins only, `PLATFORM_ADMIN_EMAILS`).
2. **If the harm is clear or time matters, click "Disable page now"**: the page leaves the public views at once, is unpublished, and its workspace cannot publish it again. (CDN caching can keep it visible for up to 60 seconds; purge the path in Vercel if that matters.)
3. Read the report, contact the reporter and the workspace owner, decide. **Restore page** if the report was wrong; **Dismiss** the report.
4. If the content is illegal, keep the evidence the lawyer needs (the report, the page content from `case_study_versions`) before any deletion, then delete the workspace or story through the privacy routines.
5. If a **client** wants their story and interview erased, they can do it themselves with their removal link; otherwise delete the interview or story from the workspace (Privacy section) or run `erase_story(<id>)` with the service role.
6. Repeated abuse by a workspace: disable its pages, ask the owner to explain, and if needed suspend by requesting workspace deletion (it takes pages offline and revokes all links at once).

## 4. Restoring from backup

Backups: Supabase daily backups (and point-in-time recovery if enabled on your plan). Know your plan's retention before you need it.

1. **Decide the target time** (just before the damage) and **freeze writes if you can** (put the app in maintenance by removing the deployment alias or pausing the Vercel project).
2. **Restore into a new project first** (Supabase, Database, Backups, restore to a new project) so you can check the data without touching production. Prefer this over restoring in place.
3. **Verify**: row counts of the key tables, sign in as a test user, open a known case study, run `npm run test:isolation` against the restored copy (`supabase/tests` expects a local project, so point `NEXT_PUBLIC_SUPABASE_URL` at it deliberately and never run it against production), and check Storage objects exist (backups cover the database; **Storage files are not part of a database backup**: keep that in mind for uploads and logos).
4. **Switch over**: update `NEXT_PUBLIC_SUPABASE_URL`, the anon key and the service key in Vercel and redeploy; or restore in place if the damage is total.
5. **Re-apply what the restore dropped**: anything created after the restore point (new signups, interviews, Stripe events: replay missed Stripe webhook events from the Stripe dashboard, which is safe because handling is idempotent).
6. **Rotate keys** if the incident was a compromise.
7. **Practice**: do a restore into a scratch project every quarter and note how long it took.

## 5. Other common situations

- **Stripe webhooks failing** (`webhook_failure`): check Sentry for the error, fix and redeploy; Stripe retries automatically, or resend events from the Stripe dashboard. Plans only change through the signed webhook, so nobody gets or loses access wrongly in the meantime except by the 7 day payment grace rule.
- **AI spend limit reached** (`ai_spend_limit`): check Anthropic usage for abuse. If legitimate raise `AI_DAILY_TOKEN_LIMIT`; if abuse, find the source (interview start counts per IP, Turnstile) and keep the limit.
- **Spike in unknown interview links** (`interview_token_miss`): usually a crawler or a customer reusing an old link. Links are 256-bit random values, so guessing is not feasible; check whether one IP dominates (Vercel logs) and block it in Vercel Firewall if it is abusive.
- **Spike in failed sign-ins** (`failed_login`): credential stuffing. Rate limits already apply per account and per address; consider enabling Vercel Firewall rules and tell affected users to reset passwords and enable two-factor.
- **Spike in permission errors** (`permission_error`): either an attacker probing ids or a bug in a new release. Check the Sentry issue and the latest deployment; roll back if it started with a deploy.

## Post-mortem template

Summary; timeline (UTC); what happened and why; impact (who, what data, how long); how we found out; what we did; what went well and badly; follow-ups with owners and dates (including the regression test).

## Contact

Vulnerability reports arrive through `/.well-known/security.txt` (`SECURITY_CONTACT`). Acknowledge within 2 working days.
