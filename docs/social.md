# Social post drafts

The app writes social post drafts; it never posts, never connects to a social account and stores no social tokens.

- **Consent:** the client's approval page has a separate, unticked checkbox. It is stored as `approvals.social_consent` by `approve_case_study`.
- **Who can write drafts:** editors and above, from a **published** case study whose approval for the current version has `social_consent = true`. `create_social_drafts()` enforces this in the database; there is no direct INSERT on `social_posts`.
- **What goes in:** only the client-confirmed claims (`claims.client_confirmed`). The model never receives names, emails or ids. Each draft must pass `verifyDraft` (`src/lib/social/builder.ts`): every number is in a claim quote, every quoted phrase is a piece of a claim quote, no links, handles or markup, within the network's length. Anything else is dropped.
- **Networks:** LinkedIn, X, Facebook, Instagram, TikTok. LinkedIn and X open a pre-filled compose page; the others open the saved profile link (or the app's home) after "Copy text".
- **Profile links** (optional, admin+, `/app/settings/social`, offered after onboarding): https only, on the network's own host, checked in code and by a table constraint.
- **Statuses:** draft, saved, posted. The owner sets them by hand; "posted" is the owner's word, not something the app can verify.
- **Open:** the numbers/quotes check runs in app code, not in the database (an editor calling the RPC directly can store their own text for their own workspace). Edited text is not supported yet: edit it in the destination app.
