# PWA, offline and push (Phase 9)

## What is installable

The signed-in app (`/app/...`) is a PWA: manifest at `/manifest.webmanifest` (name from `src/lib/brand.ts`, start page `/app/dashboard`, standalone), icons in `public/icons` (192, 512, maskable 512, apple-touch), iOS home-screen meta tags in the root layout, and an "Install app" button in the app header for browsers that offer installation (dismissal is remembered in localStorage). Client interview pages, public pages and every secret-link page are ordinary web pages: nothing to install.

Icons and the offline page are generated from the brand name by `node scripts/generate-pwa-assets.mjs` (placeholder letter icons). When you provide the real logo, put a square `public/logo.png` or `public/logo.svg` in place and run the script again; commit the output.

Chrome's own installability check (the one behind Lighthouse's installable audit) is part of the e2e suite (`Page.getInstallabilityErrors` must be empty). Current Lighthouse versions no longer have a PWA category, so there is no PWA score to report.

## The service worker (`public/sw.js`)

- Scope `/app/` only, registered only by the signed-in layout and only in production builds. Served from the app origin with `Cache-Control: no-cache`.
- **Cached**: static build files (`/_next/static/*`), `/icons/*`, and the offline page and its stylesheet. Cache-first, versioned (`pe-static-v1`); older versions are deleted on activate.
- **Never cached** (not handled by the worker at all, so they go to the network): page navigations, `/api/*`, `/i/*`, `/preview/*`, `/approve/*`, `/unsubscribe/*`, public pages, anything with an `Authorization` header, `Range` and non-GET requests, and any response that is not a plain, successful, same-origin, cookie-free one. Pages are never stored, so no transcript, case study or account data can be in a cache.
- Offline: a failed page load shows the branded offline page (no account data).
- **Sign out** unsubscribes this device from push (also deleting its row), asks the worker to drop its caches, unregisters the worker and sweeps `pe-*` caches again. The e2e suite checks the caches are empty afterwards and that opening the app offline shows nothing private.

### Manual checklist (do this on a real phone once)

1. Sign in, open the dashboard, install the app from the browser menu or the Install button.
2. Open a case study, then turn on airplane mode and reopen the app: you must see only the "You are offline" page.
3. Sign out, stay offline, reopen the app: still only the offline page, no workspace name or email anywhere.
4. In the browser's site data inspector, check Cache Storage holds only `pe-static-v1` with `/_next/static`, `/icons` and `/offline.*` entries (and is empty after sign out).
5. Open a client interview link: it must not be controlled by the worker (no "service worker" in its DevTools Application panel for that page).

## Web push

Optional. Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (generate once with `npx web-push generate-vapid-keys`; the subject is `mailto:you@example.com`). Without them the Notifications screen says push is not set up.

- Per user and per workspace, three switches (client finished, approval received, referral received), all off by default, at `/app/settings/notifications`. The browser permission prompt appears only after the user presses "Turn on for this device".
- `push_subscriptions` rows belong to a user and their workspace membership (leaving the workspace removes them); users can see and delete only their own, and the keys are not readable by any client. Endpoints must be real push services (Google, Mozilla, Apple, Windows): the server will POST to them, so anything else is refused when saving and again when sending.
- Messages are generic ("A client finished their interview") with a link to a page that still needs sign in. They never contain names, answers or numbers. A 404 or 410 from the push service deletes the subscription.
- iPhone and iPad only deliver web push to apps added to the home screen.

## Interview page on phones (9.4)

100dvh layout with `interactive-widget=resizes-content` (the keyboard shrinks the page instead of covering the input), `viewport-fit=cover` with safe-area padding, 16px inputs (no iOS zoom), 44px minimum targets on every screen (checked by `e2e/mobile.e2e.test.ts`).

Lighthouse mobile on the interview route (run in this development sandbox against the production build, simulated slow 4G and 4x CPU slowdown; three runs): accessibility 100, best practices 96, performance 78 to 87 (LCP 1.6 to 3.0 s, TBT 500 to 680 ms). Run it on your deployed site for numbers that matter: `npx lighthouse https://<app>/i/<a real link> --form-factor=mobile`.

**Not met: "under 100 KB of JavaScript".** The route transfers about 230 KB of JavaScript, of which about 200 KB is React and the Next.js client runtime; the interview's own code is about 33 KB. That figure cannot be reached with the App Router and React hydration. Reaching it would mean rewriting the interview as server-rendered HTML with a small hand-written script (a separate piece of work, noted in `docs/roadmap.md`). A test caps the route at 260 KB so it cannot get worse.
