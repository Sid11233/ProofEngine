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
| workspace_members | R | R | add non-owners, change roles, remove non-owners | add or remove owners | no self role change; last owner protected |
| proof_requests | R | R, W | R, W, delete | same | `token_hash` is never selectable (use `proof_requests_safe`) |
| interviews, interview_messages, interview_uploads | R | R | R | R | written by server only |
| referrals | R | R, update status | same | same | inserted by server only |
| question_flows | R (system flows: any signed-in user) | | | | no client writes |
| templates | any signed-in user R | | | | no client writes |
| template_entitlements, subscriptions, usage_counters, page_events | R | R | R | R | no client writes |
| case_studies | R | create draft; edit non-published; set draft / awaiting approval / unpublished | also edit live pages; delete | same | `approved` is server-only; `published` arrives in Phase 6.2 with its trigger |
| case_study_versions | R | append (as self) | same | same | append-only |
| claims | R | insert (unconfirmed, quote must be verbatim) | same | same | `client_confirmed` is server-only |
| approvals | R | R | R | R | server insert only; append-only |
| takedown_requests | | | R | R | server insert only |
| audit_log | | | R | R | via `write_audit_log()` (editor+) or server; append-only |

## Left for later phases (deliberately)

- **Invitations (2.3):** until then admins can add a member by user id. The invite flow should replace this, then direct inserts can be revoked.
- **Teammate names (2.3):** `profiles` is own-row only. The team page needs a purpose-built function, not a wider policy.
- **Request state machine and plan limits (3.1, 8.3):** an editor can currently set `proof_requests.status` and `revoked_at` directly, and nothing in the database yet caps interviews per plan. Move those into functions or triggers when the flows exist.
- **Publishing (6.2):** the trigger that requires an approval for the current version, an allowed template, a valid slug and confirmed claims. Until then `published` is not settable from the client.
- **Seeding:** system question flows (3.4) and templates (5.2).
- **Storage buckets** `uploads` and `exports` (private) are created in the dashboard or a later migration.

## Running the tests

```bash
npx supabase start          # local Postgres + Auth + API
npx supabase test db        # pgTAP: triggers, constraints, cascades
npm run test:isolation      # real users through the REST API
```

The isolation suite refuses to run against anything but a local Supabase. CI runs both on every pull request.
