# Roadmap (changes to `Proof Engine V1 Build Plan.pdf`)

The PDF is the original plan. Anything added later is recorded here.

## Added: framework upgrade (after Phase 6b)

Do this as its own PR, before Phase 7. Nothing else ships in it.

- Next.js 15.5 to 16.x, React and React DOM 19.1 to the latest 19.x, and `eslint-config-next` to match.
- Reason: clears the 5 dev-only high `npm audit` findings (eslint-config-next, fast-glob, micromatch, braces) and keeps the framework supported.
- Also review: eslint 10, typescript 7, `@types/node` 26. Take each only if it is clean; defer the rest.
- Ask before adding or changing any dependency, per CLAUDE.md.
- Gate: lint, typecheck, unit, isolation, pgTAP, build and the full e2e suite pass. Re-check CSP nonce handling, middleware, the `next.config.ts` headers (`/i`, `/preview`, `/approve`) and server action behaviour, since these are the likeliest to change.
- Finish with `npm audit` and `npm outdated` and record the result.
