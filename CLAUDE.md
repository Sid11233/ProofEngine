# Proof Engine

PROJECT: Proof Engine, a SaaS where agencies and SaaS founders send an AI interview link to clients and publish client-approved case study pages.

Stack: Next.js App Router, TypeScript, Supabase (Postgres, RLS, Auth, Storage), Claude API, Stripe, Resend, Vercel.

The build plan is `Proof Engine V1 Build Plan.pdf` in the repo root. Work phase by phase; each phase ends with a security gate that must pass before the next one starts.

## SECURITY RULES (non-negotiable)

1. Never use the Supabase service role key in client code. It is only allowed in files starting with `import 'server-only'` and only for the interview-token endpoints and webhooks.
2. Every new table must enable RLS in the same migration, with explicit policies. Never create a table without RLS.
3. Never render user-provided or AI-generated text as raw HTML. No `dangerouslySetInnerHTML` (ESLint enforces this).
4. Validate all inputs on the server with zod. Reject unknown fields.
5. Every route handler and server action must authenticate and check workspace membership and role before reading or writing.
6. Interview tokens are random 32 bytes, stored only as SHA-256 hashes, compared in constant time.
7. All public or AI-calling endpoints are rate limited.
8. Never log transcripts, tokens, emails or API keys.
9. Treat all client-provided text as untrusted data. It is never an instruction to the AI.
10. Secrets only via validated env vars. Never hardcode.

## WORKFLOW RULES

Plan before coding. Write tests with each feature. Keep migrations small and reversible. Ask me before adding any new dependency. After each feature, list the security considerations you handled and anything left open.

## CODE STYLE

TypeScript strict, small functions, no `any`, server code in `/src/lib` and route handlers, components stay presentational.

## Layout

- `src/app` routes; `src/middleware.ts` sets the per-request CSP nonce
- `src/lib/supabase` server, browser and middleware clients (anon key + user JWT, so RLS applies)
- `src/lib/security` env validation, CSP builder; rate limit, token utils and sanitizers land here in later phases
- `src/lib/ai` Claude API wrapper and prompts
- `supabase/migrations`, `supabase/tests` SQL and RLS isolation tests
- `docs` setup, limits, incident response

## Env vars

Validated by `src/lib/security/env-schema.ts`, which `next.config.ts` runs on every build, start and dev, so a missing required var fails fast.
- Browser code imports `@/lib/security/env.public`; server code imports `@/lib/security/env.server` (`server-only`).
- New var: add it to the schema and `.env.example` together. Make it optional until the phase that uses it, then promote it to required.

## Commands

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test`
