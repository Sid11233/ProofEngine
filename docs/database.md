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
| case_studies | R | generate (function); edit content only through `save_case_study_edit`; set draft / awaiting approval / unpublished | delete | same | content, version and status-on-edit cannot be written directly; `approved` is server-only; `published` arrives in Phase 6.2 with its trigger |
| case_study_versions | R | append (as self) | same | same | append-only |
| claims | R | none directly | same | same | created only with the case study by `create_generated_case_study` (unconfirmed, quote must be verbatim, enforced by trigger); `client_confirmed` is server-only; `edited` is set by `save_case_study_edit` |
| approvals | R | R | R | R | server insert only; append-only |
| takedown_requests | | | R | R | server insert only |
| audit_log | | | R | R | via `write_audit_log()` (editor+) or server; append-only |

## Left for later phases (deliberately)

- **Plan limits (8.3):** `plan_interview_limit()` holds placeholder numbers (free 3, pro 100, team 1000 per month) until plans are decided.
- **Publishing (6.2):** the trigger that requires an approval for the current version, an allowed template, a valid slug and confirmed claims. Until then `published` is not settable from the client.

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

## Running the tests

```bash
npx supabase start          # local Postgres + Auth + API
npx supabase test db        # pgTAP: triggers, constraints, cascades
npm run test:isolation      # real users through the REST API (also runs the integration tests in src/)
npm run build && npm run test:e2e   # real browser: auth, onboarding, MFA, team
```

The isolation suite refuses to run against anything but a local Supabase. CI runs both on every pull request.
