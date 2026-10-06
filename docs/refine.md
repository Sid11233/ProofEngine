# Refine with AI

A button beside the headline and each section body (including the CTA) in the case study editor. Quotes are never refined.

- **Flow:** `refineTextAction` suggests (nothing saved) -> the owner sees a word-level diff -> `acceptRefinementAction` applies it, or Reject / Try again. "Restore client's original wording" puts back the text from before the first refinement.
- **Who:** editor and above (a viewer gets "forbidden"). Rate limit: 20 per minute per user (`refine`). Plan limit: `usage_counters.ai_refinements`, enforced by `reserve_refinement()` (free 10, pro 300, team 2000; `plan_refinement_limit()` in SQL must match `src/lib/billing/plans.ts`, a test checks it). The count is given back when the model's answer fails the checks.
- **Allowlist:** `headline` and `sections.N.body` only. `sections.N.quote.*` and the body of a quote section answer with the quote message.
- **The model** only rephrases (system rules in `src/lib/case-study/refine-core.ts`). The text goes in `<text_to_refine>`, the owner's note (max 200 characters) in `<owner_instruction>`, both stripped of tag-like text and treated as data. "Match my brand tone" uses the workspace description, niche and audience.
- **Checks in code** (`verifyRefinement`, run before showing a suggestion and again on Accept): the same numbers as a multiset, no new links, proper nouns or superlatives, quoted phrases kept, 60 to 140 percent of the original length, no markup. One stricter retry, then a clear error.
- **Accept** goes through `apply_text_refinement()`: role check, not on a published page, the field must still hold the text the suggestion was made for, at most one accepted refinement a minute per case study. It writes a new version, a `text_refinements` row, `case_studies.refined_fields` (the "edited from client's words" badge) and an audit entry. The case study goes back to draft, so the client must approve again.
- **Tickets:** the suggestion goes back to the server on Accept, so its token counts and model are signed (HMAC, 15 minutes) instead of trusted.
- **Logging:** token counts only. Never text.
- **Limits:** field flags are by position, so adding, removing or reordering sections clears the section flags (a trigger); the headline flag stays. Restore is also limited to one change a minute.
