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

### Result (done)

- Next 15.5.27 to 16.3.8 (Turbopack builds), React and React DOM 19.1.0 to 19.3.0, `eslint-config-next` 16.3.8. ESLint 9, TypeScript 5.9 and `@types/node` 24 were kept on purpose (ESLint 10, TypeScript 7 and `@types/node` 26 are available; take them in a separate PR).
- `src/middleware.ts` became `src/proxy.ts` (Next 16 renamed it); behaviour is unchanged. `eslint.config.mjs` uses the native flat configs instead of `FlatCompat`. Two new React lint rules (no ref reads during render, no setState in an effect) required small fixes in `case-study-editor.tsx` and `reauth-prompt.tsx`.
- `npm audit` still reports 5 high findings, all dev-only, in the lint toolchain (`braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`, `eslint-config-next`). The advisory covers every published `braces` version, so there is no patched release to move to; the only "fix" npm offers is downgrading to Next 14. They do not ship to production. Re-check when `braces` publishes a fix.
- Gate: lint, typecheck, 427 unit, 305 isolation, pgTAP, build and every e2e file pass.

## Open: interview page JavaScript budget (Phase 9.4)

The plan asks for under 100 KB of JavaScript on `/i/[token]`. It is about 230 KB (about 200 KB is the React and Next.js client runtime, about 33 KB is our code), so Lighthouse mobile performance sits at 78 to 87 in the development sandbox. Options if you want it under 100 KB: rewrite the interview as a server-rendered page with a small vanilla script (no React on that route), or accept the current numbers. A test guards against growth (260 KB cap). See `docs/pwa.md`.
