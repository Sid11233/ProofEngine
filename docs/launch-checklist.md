# Launch checklist (from the build plan)

Status key: **done** is verified in this repository, **you** needs an account, a decision or a person.

| Item | Status | Notes |
| --- | --- | --- |
| Isolation suite and full tests pass in CI | done | `ci.yml` runs lint, types, unit, build, isolation, pgTAP. Keep it required on `main`. |
| Claude Code audit findings fixed | done | [security-audit-2.md](security-audit-2.md) (and the first audit, [security-audit.md](security-audit.md)). |
| Independent review of RLS policies by a second pair of eyes | **you** | Give a reviewer `supabase/migrations`, `docs/database.md` and the pgTAP/isolation tests. |
| Dependabot alerts at zero critical or high | **you** | `npm audit --omit=dev` is 0. The 5 dev-only highs have no patched release (audit I2); dismiss them in GitHub with that note. |
| All Supabase Security Advisor warnings fixed | **you** | Run the Advisor on the hosted project after `supabase db push`; checklist in [setup.md](setup.md). |
| Production keys rotated and different from dev; Stripe live webhook secret set | **you** | New Supabase, Stripe live, Resend, Anthropic, Upstash, VAPID, `CRON_SECRET`, `IP_HASH_SECRET` values in Vercel. |
| SPF, DKIM, DMARC for the sending domain | **you** | Verify the domain in Resend and add the three DNS records. |
| Backups enabled and one restore tested | **you** | Steps in [incident-response.md](incident-response.md) once it exists (Phase 11.4). |
| Privacy policy, terms and DPA reviewed by a lawyer | **you** | Drafts arrive with Phase 11.3. |
| Public pages domain separate from the app domain, HSTS enabled | **you** | `PUBLIC_SITES_DOMAIN` plus wildcard DNS ([setup.md](setup.md)); HSTS is sent on every response. |
| Turnstile and rate limits active on all public endpoints | **you** | Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, the Upstash keys and **`REQUIRE_DISTRIBUTED_RATE_LIMIT=1`** (audit M3). |
| Spend circuit breaker tested | done | Covered by `e2e/abuse` (pauses interviews at the daily limit and resumes). Set `AI_DAILY_TOKEN_LIMIT` and `ALERT_EMAIL`. |
| Manual XSS test (10 payloads) on testimonials, names and metrics | done | `e2e/xss.e2e.test.ts`. |
| Sign up as two accounts and try to access each other's data through the UI and the API | done | `e2e/cross-tenant.e2e.test.ts`. |
| `security.txt` | **you** | Set `SECURITY_CONTACT` (e.g. `mailto:security@yourdomain`). |
| Incident plan written and an owner assigned | **you** | Document arrives with Phase 11.4; name the owner. |

## Recurring routine after launch

Weekly: review alerts, failed logins, takedown requests and dependency updates. Monthly: rotate non-essential keys, review RLS policies after any schema change, re-run the audit. Before each release: run the isolation suite and the injection tests (`e2e/xss`, `e2e/cross-tenant`). Quarterly: restore a backup, review subprocessors, consider an external penetration test.
