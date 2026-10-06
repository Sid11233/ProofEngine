# Database security model (Phase 1)

Source of truth: `supabase/migrations/`. Every policy has a `comment on policy` explaining it. This page is the summary to review.

## How access is enforced

1. **RLS on every table**, enabled in the same migration that creates it.
2. **Grants are column-scoped.** `anon` has no privileges anywhere. `authenticated` gets only what it needs, so a column that must never be client-writable (`workspaces.plan`, `profiles.email`, `proof_requests.token_hash`) is simply not granted.
3. **Roles** are ranked `viewer < editor < admin < owner`; `is_member(workspace, min_role)` is the only membership check and fails closed (no session or unknown role gives false).
4. **Composite foreign keys** `(parent_id, workspace_id)` mean a child row's `workspace_id` can never disagree with its parent's.
5. **Append-only tables** (`case_study_versions`, `approvals`, `audit_log`) have no update/delete policy, no update/delete privilege (service role included) and a trigger that rejects both even for the table owner. Only a whole-workspace hard delete cascades through.

## Who can do what through the client API

R = read, W = write. "Server" means service role, used only in token-authenticated endpoints and webhooks.

| Table | viewer | editor | admin | owner | Notes |
| --- | --- | --- | --- | --- | --- |
| profiles | own row R | | | | `full_name` only is writable |
| workspaces | R | R | R, W (not `plan`) | R, W, delete | created only by `create_workspace()` |
| workspace_members | R | R | invite (non-admin roles), change roles of non-owners, remove non-owners | everything, including owners | **no direct writes**: only via `create_invite`/`accept_invite`/`change_member_role`/`remove_member`, which audit-log in the same transaction; no self role change; last owner protected |
| workspace_invites | | | R (no token_hash), create, revoke | same, plus invite admins | functions only; single use, 7 days, hashed token, invitee must have a verified matching email |
| proof_requests | R | R; edit descriptive fields; create/send/remind/revoke/regenerate via functions | same, plus delete | same | **no direct insert**; status, revoked_at, token_hash, expiry and reminders change only through `create_proof_request`, `rotate_request_token`, `revoke_request` (audit-logged, plan limit enforced); `token_hash` is never selectable (use `proof_requests_safe`) |
| interviews, interview_messages, interview_uploads | R | R | R | R | written by server only |
| referrals | R | R, update status | same | same | inserted by server only |
| question_flows | R (system flows: any signed-in user) | | | | no client writes |
| templates | any signed-in user R | | | | no client writes |
| template_entitlements, subscriptions, usage_counters, page_events | R | R | R | R | no client writes |
| case_studies | R | generate (function); edit content only through `save_case_study_edit`; ask for client approval (`request_client_approval`) | publish and unpublish (functions), delete | same | content, version, **status and slug cannot be written directly by anyone**; transitions only through functions; `published` is guarded by a trigger (see Approval and publishing) |
| case_study_approval_tokens | | R (no hash) | R | R | issued by `request_client_approval`, consumed by the server-only client functions |
| case_study_feedback | | R | R | R | written by the server-only client functions; append-only |
| case_study_versions | R | append (as self) | same | same | append-only |
| claims | R | none directly | same | same | created only with the case study by `create_generated_case_study` (unconfirmed, quote must be verbatim, enforced by trigger); `client_confirmed` is server-only; `edited` is set by `save_case_study_edit` |
| approvals | R | R | R | R | server insert only; append-only |
| takedown_requests | | | R | R | server insert only |
| audit_log | | | R | R | via `write_audit_log()` (editor+) or server; append-only |

## Left for later phases (deliberately)

- **Plan limits (8.3):** `plan_interview_limit()` holds placeholder numbers (free 3, pro 100, team 1000 per month) until plans are decided.

## Team management (Phase 2.3)

- Invites: the raw 32-byte token is returned once to the inviting admin (and emailed); only its SHA-256 is stored. Accepting needs a signed-in account whose **verified** email matches. Everything else (unknown, expired, used, revoked, wrong account) looks the same.
- `select *` on `workspace_invites` is refused because `token_hash` is not granted: always name columns.
- Teammate names and emails come from `list_team_members(ws)`, not from a wider `profiles` policy.
- Sensitive actions (removing someone else, granting ownership, turning MFA off) require a recent sign-in, judged from the signed session token (`amr`), not a client value.

## Proof request links (Phase 3.1-3.2)

- A link is `/i/<43-char token>` (32 random bytes). Only its SHA-256 is stored. Because the raw token is never stored, every email that carries a link rotates the token: **send, remind and regenerate each replace the previous link immediately.** A reminder therefore says "this link replaces the one in our earlier email".
- Reminders: only for `sent` requests, max 3, at least 48 hours apart. Links live 30 days (the database caps it at 90).
- `resolveInterview()` (`src/lib/interview-access.ts`) is the only way an interview page or endpoint learns who is calling. It rate limits by IP (30/min) and token (60/min), compares hashes in constant time, and returns the same "not found" for unknown, malformed, expired, revoked and completed links.
- Interview pages and `/api/interview/*` send `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Interviews (Phase 3.3-3.4)

- Interview rows, transcripts, usage counters and the question position are written only by the interview endpoints (service role) through `start_interview`, `record_client_message`, `record_bot_message` and `finish_interview`. These are executable by `service_role` only; signed-in users and anonymous clients cannot call them (tested).
- The database enforces the caps under a row lock: 40 messages and 100k tokens per interview, one reply in flight at a time (`awaiting_since`, 60 s stale timeout), no answers after the last question, and finishing only after all questions were answered.
- **The server runs the interview, the model only phrases it.** Questions come from `question_flows`; the position, probe budget (max 2 per question) and the exact wording of every question are server-side. The model may write one short acknowledgement or one follow-up question, which `validateModelText` checks (no links, emails, markup, instructions-talk, or numbers the client did not say) and replaces with a canned line on any doubt. The client's words are stored exactly as typed and shown only as text.
- Client text reaches the model only inside a single `<client_answer>` wrapper after tag-stripping. The model is never sent the token, the client's email or name, or any id.
- Without `ANTHROPIC_API_KEY` (or if the provider fails) the interview runs on canned lines instead of failing.

## Uploads and spend (Phase 3.5-3.6)

- The private `uploads` and `exports` buckets are created by a migration (skipped where Storage is not installed). No storage policies exist on purpose: with RLS on and no policy, only the service role can touch files, and users get 60-second signed URLs from the server. No public bucket is allowed.
- `record_upload` (service role only) caps an interview at 4 files and only accepts a path under that workspace and interview.
- `ai_daily_usage` holds platform-wide token totals for the circuit breaker. RLS is on with no policy and no grants, so no client can read it. Limits are listed in [limits.md](limits.md).

## Case studies (Phase 4)

- **Generation** (`src/lib/case-study/generator.ts`, `POST /api/case-studies/generate`): editor+, only for a completed interview with consent (also enforced in `create_generated_case_study`, so a bypassed app cannot write about a client who did not consent). Three checked steps: extract the client's claims and keep only those whose quote is word for word in the cited message; draft from verified claims only; verify every metric value, quote and stray number in code, retry once, and if it still fails **remove what cannot be verified before saving** (the removals are listed on the case study). A fabricated figure can never be persisted.
- **Who is named** follows the client's publishing permission; the model never chooses names or attributions.
- Claims are saved unconfirmed with the case study in one transaction; version 1 is written with it.
- **Editing** only through `save_case_study_edit`: it makes the next version, returns the study to draft, and sets `claims.edited` for any number or quote that no longer matches the client's words (computed on the server), clearing `client_confirmed` on those. Editors cannot write content, version or confirmation directly.
- Generation counts against the workspace's AI usage and respects the monthly cap (a clear error, since the owner chose to spend it).

## Templates (Phase 5)

- Templates are configuration, not code or HTML: a list of allowed section types, a default theme, and the **name** of a layout variant that is implemented in code (`classic`, `minimal`, `before-after`, `timeline`, `saas-switch`). Five are seeded by migration (Classic and Minimal free; Before and After, Timeline Story, SaaS Switch Story pro). Every row is validated with zod when loaded and dropped if it does not fit.
- `template_allowed(workspace, template)` is the one rule: free templates are open, pro templates need a pro or team plan or an entitlement, pack templates need an entitlement, inactive ones never. Only members (or the server) get an answer. The TypeScript copy `isTemplateAllowed` is checked against it for every combination in a test; **publishing will use the database function** (Phase 6.2 trigger).
- Locked templates can be selected to preview with a watermark. Switching a template changes only `template_id` and `theme_settings` (reset to the template's defaults); the content JSON, version and status are untouched (tested).
- Theme input is validated: a hex colour, one of six font pairs, and fixed radius, spacing and mode values. Unknown keys are rejected, so no arbitrary CSS or URL can be stored.
- The CSP allows `style-src-attr 'unsafe-inline'` (style attributes only) because the theme is applied as CSS variables on one element. `<style>` elements and scripts still need the nonce.

## Editor, versions and preview links (Phase 5.3-5.4)

- **Autosave** (`autosave_case_study`): the case study's `content` is always current, but a new `case_study_versions` row is created at most once a minute for a draft (and always when the study was awaiting or had approval, since the client may be looking at the old one). Because edits inside a minute change content without a new version row, `snapshot_case_study()` brings the stored versions up to date; **the client approval step (Phase 6) must call it first**, so an approval is always tied to a version whose stored content is exactly what the client was shown.
- Logo paths must be `{workspace_id}/logos/{uuid}.webp`; the function rejects anything else (other workspaces, `..`, other extensions, URLs).
- **Preview links** (`case_study_previews`): unlisted, 14-day maximum (a check constraint), revocable, at most 10 active per case study, only a SHA-256 stored. Created and revoked only through `create_preview_link()` / `revoke_preview_link()` (audit-logged); editors and above can list them (never the hash). `/preview/[token]` goes through `createPreviewResolver`: IP and token rate limits, constant-time hash check, one generic 404 for unknown, malformed, revoked, expired and published; it reads only that case study's content, template and theme, and refuses content that does not pass the schema.
- Private-bucket writes for logos use the service role **only after the route has authenticated the user, checked their role in the study's workspace, and validated and re-encoded the file**; no storage policy lets a client write directly.

## Approval and publishing (Phase 6.1-6.2)

- **Request**: `request_client_approval(study, hash)` (editor+) snapshots the content into a version, revokes any earlier link, stores a hashed single-use token (14 days maximum, a check constraint) tied to that version and moves the study to `awaiting_client_approval`. The raw token goes only into the email (and is shown once to the owner if email is not configured).
- **Client actions** (`/approve/[token]`, service-role functions only, each consumes the token under a row lock): `approve_case_study` (records the approval with the person the interview was sent to, never a typed name; marks the claims confirmed), `request_case_study_changes` (stores a plain-text note, back to draft), `decline_case_study` (final: `client_declined_at`, no more approval requests, never publishable). The token only works while the study is awaiting approval, on the version it was issued for, and while the stored version equals the content; every failure is the same generic 404.
- **IP evidence**: `approvals.ip_hash` is an HMAC of the client IP, keyed by `IP_HASH_SECRET` or, when unset, a key derived from the service role key.
- **Publish rules** (`enforce_publish_rules` trigger, so they hold for the owner through the API and for the service role): an approval exists for the CURRENT version and the stored version equals the content; the template is allowed (`template_allowed`); a valid, unreserved slug and a workspace address (`subdomain_slug`); every claim confirmed and every metric or quote on the page pointing at a confirmed claim of this study; the client has not declined. Changing the content of a published page puts it back to draft.
- **Who**: `publish_case_study` and `unpublish_case_study` need admin or above. Approval is requested by editors and above.

## Public pages, widget and takedowns (Phase 6.3-6.5)

- **One anonymous read surface.** `anon` has `SELECT` on exactly two views, both `security_barrier` and owned by the migration role, so their `WHERE` is the guard: `public_case_studies` (published, not disabled, workspace has an address; public-safe columns only, the logo path is split out of the content, no ids of people, claims, interviews or approvals) and `public_wall_settings` (only workspaces that switched the widget on). pgTAP and `hardening.test.ts` fail if any other table, view or function becomes visible to `anon`.
- **Separate origin.** Public pages are served from `<workspace>.<PUBLIC_SITES_DOMAIN>`: middleware rewrites those hosts to the internal `/sites/...` tree with no session and no cookies, and answers 404 for `/sites/*` on the app host, so published content never shares an origin with the signed-in app. App routes (`/app`, `/api`, `/i`, `/approve`) are 404 on a site host. Public pages are read with the anon key; only the logo redirect uses the service role, for a signed Storage URL, and only after the view confirms the page is public right now.
- **Widget** (`/embed`): script-free HTML built with a tested `esc()`; its own CSP `default-src 'none'` and `frame-ancestors` = the admin's allowlist of https origins (validated in the app and by a database constraint). Off until an admin enables it with at least one origin. `save_wall_settings` is admin+ and audit-logged.
- **Reports**: `create_takedown_request` (service role only) inserts for a published page; a report never removes anything by itself. Workspace owners/admins and `PLATFORM_ADMIN_EMAILS` are emailed in plain text. A platform admin (verified email on that list, recent sign-in) reviews at `/app/admin/takedowns` and can **disable** a page: it leaves the public view at once, is unpublished, and the publish trigger refuses to publish it again for any role until the platform restores it. `disabled_at` is not client-writable.

## Referrals, analytics, dashboard and reminders (Phase 7)

- **Referrals** are inserted by the token-authenticated finish endpoint only. Every member can read them; editors and above can change `status` (column grant); nobody can change the name or contact. The workspace owners and admins get a plain-text email; the referred person never does.
- **Analytics** (`page_events`) is append-only and has no column for an address, user agent or visitor id. `record_page_event()` (service role only, called by the same-origin `/[slug]/event` endpoint) keeps type, page, hostname-only referrer and time. De-duplication uses an in-memory key salted with a random value that is replaced every UTC day and never written anywhere.
- **Dashboard** reads only through the signed-in user's client: `page_event_daily`, `case_study_status_counts`, `referral_status_counts` and `request_funnel` are `security_invoker` views, so row-level security limits every number to the user's workspaces (tested across two workspaces, in SQL and in the browser). The service role is never used for the dashboard.
- **Reminders**: `proof_requests.sent_at` and `do_not_contact_at`. `auto_remind_candidates`, `auto_remind_request`, `auto_remind_revert` and `mark_do_not_contact` are service-role only; the rules (day 3/7, max 2, active and unanswered only, do-not-contact, 25 per workspace per day) live in the database. The job rotates the link first and gives the reminder back if the email fails, and does nothing at all when email is not configured. `rotate_request_token` refuses send and remind for a do-not-contact request.
- **Unsubscribe token**: `<request id>.<HMAC>` derived from `IP_HASH_SECRET` (or the service role key), so it survives link rotation; the page needs a confirming click so an email scanner cannot unsubscribe anyone.

## Billing (Phase 8)

- **No client write path.** `workspaces.plan` and `subscriptions` change only through `apply_billing_state()`, `apply_invoice_state()` and `expire_billing_grace()`, all service-role only and called by the signature-verified webhook (`/api/stripe/webhook`) and the daily grace cron. Members can read their own subscription; `stripe_events` has RLS on and no policy or grant at all.
- **Access rules live in SQL** (`billing_effective_plan`): active and trialing give the paid plan; past_due keeps it for 7 days from the first failure (`past_due_since`), then the cron drops it to free; canceled, unpaid, incomplete and paused are free. A price id that is not the configured one never grants access, but a cancellation always removes it.
- **Idempotent and retry-safe.** Each Stripe event id is claimed once in `stripe_events`; a handler that fails releases the claim so Stripe's retry is processed. Forged, unsigned, stale-timestamp and tampered requests are 400 before any of the body is read; events are narrowed with zod and anything unexpected is ignored.
- **Customer binding.** `link_stripe_customer` stores a workspace's customer once; a different customer for the same workspace, or one customer on two workspaces, is refused (so metadata alone cannot move a subscription to another workspace).
- **Checkout and portal** (owner only, recent sign-in): the price id is server config, success and cancel URLs are built from the app URL, the browser is only ever sent to checkout.stripe.com or billing.stripe.com, and the page never trusts the "success" redirect.
- **Entitlements** (`src/lib/billing/entitlements.ts`): `canCreateInterview`, `canUseAI`, `templateAllowed`, `canRemoveBranding` are the one place app code asks. The database stays the authority (the interview limit under a lock in `create_proof_request`, `template_allowed()` in the publish trigger, the public view's badge flag) and tests keep the numbers equal.
- **Downgrade**: published pages stay online (the public view does not look at the plan), cannot be edited (published pages are never editable) or republished on a template the plan no longer includes; the editor and billing page say so in plain words.

## Push (Phase 9)

- `push_subscriptions` and `notification_preferences` are per-user: row-level security lets a user see (and, for subscriptions, delete) only their own rows, they hang off the user's workspace membership (composite foreign key, so leaving removes them), the keys `p256dh` and `auth` are not granted to any client, and writes go through `save_push_subscription()` / `save_notification_preferences()` (members only; at most 10 devices per user).
- `push_targets()` and `remove_push_subscription()` are service-role only, used by the sender after an event. See [pwa.md](pwa.md).

## Light finder (Phase 10)

- `communities` is global reference data. Any signed-in user reads the active rows; **no client can write** (no insert, update or delete grant or policy), so the list is changed only by migrations or an admin script run with the service role. URLs must be `https://`, text fields and tags are bounded by check constraints.
- The 40 seeded rows are **placeholders** (`needs_verification = true`, `example.com` links, names starting `[Placeholder]`). To replace them, add a migration that deletes the placeholder rows (`name like '[Placeholder]%'`) and inserts researched entries with `needs_verification = false` and `last_verified_at` set. Nothing scrapes or monitors any platform.
- `workspace_communities` is each workspace's tracker: editors and above read and write their own workspace's rows only (RLS), only `status` and `notes` are updatable (column grant), only active communities can be added, notes are at most 2000 characters and are rendered as text only. It is in the isolation SPECS and has a dedicated cross-workspace test.
- Matching is tag overlap (`src/lib/finder/match.ts`): 3 points per shared niche tag, 1 per shared audience word, ties to verified entries. Links render only if they parse as plain https and always open with `target=_blank rel="noopener noreferrer"`.

## Privacy: deletion, export and retention (Phase 11.3)

- **Workspace and account deletion** (`request_workspace_deletion`, `request_account_deletion`; owner, recent sign-in, typed confirmation): a 30 day grace period. From the request the workspace's public pages and widget leave the public views, every interview, preview and approval link is revoked and nothing new can be created (a trigger refuses). A paid subscription must be cancelled first. After 30 days the daily job (`/api/cron/purge`) removes the files from both buckets, verifies none are left, then `hard_delete_workspace()` deletes the workspace row and the foreign keys remove every dependent row. There is no direct `DELETE` on `workspaces` any more.
- **Append-only tables** (versions, approvals, feedback, page events, audit log) refuse deletes except inside the purge functions, which set the transaction-local flag `pe.purge`; no client can set it (PostgREST exposes no `set_config`; tested).
- **Delete this interview** (`delete_interview`, admin+, recent sign-in): removes the transcript, upload rows (files first, by the action), claims and referrals, unpublishes or returns to draft the case studies built on it. They cannot go live again because their numbers no longer point at a claim.
- **Client removal link** (`/remove/<case study id>.<HMAC>`, valid for the life of the case study, in every approval email and on the approval page): needs a confirming click, then `erase_story()` deletes the case study with all versions, approvals and events, the interview and the request (the client's name and email), and the files and logo. The audit trail keeps only that an erasure happened.
- **Export** (`POST /api/export`, owner, recent sign-in, same origin, 3 per hour): a zip of JSON files read through the owner's own client, so row-level security limits it to their workspace; no token hashes, push keys, Stripe ids or IP hashes.
- **Retention**: requests that never completed are deleted 90 days after their last activity (`stale_requests`, `purge_requests`), with their uploads. No audio is stored in V1; when voice answers are built the raw audio must be deleted right after transcription.
- Files are always removed **before** the rows, and a failed removal throws, so a retry finds the rows instead of leaving orphaned files.

## Running the tests

```bash
npx supabase start          # local Postgres + Auth + API
npx supabase test db        # pgTAP: triggers, constraints, cascades
npm run test:isolation      # real users through the REST API (also runs the integration tests in src/)
npm run build && npm run test:e2e   # real browser: auth, onboarding, MFA, team
```

The isolation suite refuses to run against anything but a local Supabase. CI runs both on every pull request.
