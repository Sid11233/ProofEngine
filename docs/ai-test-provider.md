# AI test provider (OpenRouter, free models)

For trying the interview and case study generation without paying for Anthropic. **Test data only.**

## Turn it on

Set these environment variables (locally in `.env.local`, or in Vercel, then redeploy):

| Variable | Value |
| --- | --- |
| `AI_PROVIDER` | `openrouter` |
| `OPENROUTER_API_KEY` | a key from openrouter.ai (free account) |
| `OPENROUTER_MODEL` | optional; default `nvidia/nemotron-3-super-120b-a12b:free` |

Turn it off by removing `AI_PROVIDER` (the app then uses `ANTHROPIC_API_KEY` as before). `ANTHROPIC_API_KEY`, `INTERVIEWER_MODEL` and `GENERATOR_MODEL` are ignored while it is on.

## What to expect

- **Interviews** work: the server still owns the questions; the model only phrases the acknowledgement or one follow-up, and every line passes `validateModelText` (anything doubtful becomes a canned line). A reply can take several seconds.
- **Case study generation works but is slow**: about 1 to 2 minutes (checked: 3 model calls, 88 seconds, 0 issues, a verified draft). The route allows 60 seconds on Vercel, so a generation there can time out; run generation locally to test it, or use a paid model. Nothing unverified is ever saved: if the model misbehaves the result is "no claims" or "failed", never made-up content.
- **Free models are rate limited and change**: 429 errors are normal; some free models print their reasoning into the answer instead of just JSON (those fail verification and are discarded). If a model stops working, set `OPENROUTER_MODEL` to another one from openrouter.ai/models?max_price=0, or use `openrouter/free` to let OpenRouter choose.
- **The privacy promises do not hold** with this provider: free models may log or train on prompts, and OpenRouter is not on the subprocessor list. Use made-up answers only. Do not enable it for real clients; the app logs a warning at startup when it is on in production.
- Token use is counted like any other provider, so the daily spend breaker still works.

## Before real use

Remove `AI_PROVIDER` and `OPENROUTER_API_KEY` from every environment, set `ANTHROPIC_API_KEY`, and **rotate the OpenRouter key** if it was ever pasted into a chat or shared.
