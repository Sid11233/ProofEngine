# UI audit

`e2e/ui-audit.e2e.test.ts` signs in as an owner with sample data and visits every signed-in page at **1440, 1024 and 390 px** wide. It runs as part of `npm run test:e2e`. Set `UI_AUDIT_DIR=./ui-audit` to also save a full-page screenshot of every page (the folder is not committed).

Pages: dashboard, requests (list, new, detail), case studies (list, review, edit, template), referrals, communities, wall of proof, social links, team, notifications, privacy, motion, security and billing.

## What is checked on every page

| Check | Rule |
| --- | --- |
| Sideways scroll | None at any width |
| Clipped banners | Notes, alerts and tip cards sit fully inside the page width |
| One primary action | At most one black filled button or link in the page content (the editor, the review screen, the new request form and the dashboard are exempt, see below) |
| Contrast | Text 4.5 to 1, large text 3 to 1, measured from the computed colour and the real background, once animations have finished |
| Orange | Never used for small text |
| Focus | The first 12 tab stops each show a visible ring |
| Copy | No lorem ipsum, TODO, TBD, "coming soon", `undefined`, `NaN` or "No project type" |
| Spacing | Gaps between a page's blocks fall on the 4 px half step of the 8 px grid |
| Console | No errors or Content Security Policy violations |

## Result

All checks pass at all three widths (`4 passed`).

## Found and fixed during the audit

- Illustrations ignored their size class (a base style outranked Tailwind), so the reminder tip's picture filled the card and caused sideways scroll on a phone. The base size now sits in a lower layer.
- The workspace pill in the sidebar was squeezed to 44 px and showed no name; it now uses the full sidebar width.
- Segmented-control text for unselected options was 4.3 to 1; it is now 7 to 1.
- The Communities and Dashboard tests, and the loader tests, assumed the old markup and were updated.
- A full-page screenshot resizes the page and restarts entry animations, which made contrast look low. The audit now measures first and takes screenshots afterwards.

## Decisions and known limits

- **No dark mode.** The app is light only by design, so there is nothing to compare. The audit still runs once with the browser asking for dark and requires the same result.
- **Dashboard** shows two black buttons (New request and the next best action's button) as in the design; when both would go to the same place only one is shown.
- **The editor** (edit, review, template) uses the full width with the sidebar folded to icons, and has its own controls, so it is exempt from the single primary action rule.
- **Communities** that nobody has verified are hidden from normal users (platform operators still see them). All 40 seeded communities are placeholders, so everyone except operators sees the "No communities to show yet" state until real, verified communities are added.
- **More** (phone) opens as a centred dialog, not a bottom sheet.
- **Select and Checkbox** are the real `<select>` and `<input type="checkbox">`, restyled, so keyboards, screen readers and phone pickers keep working. The Select list itself is the browser's.
- The bell in the top bar says there is nothing new; the app has no notification inbox yet (push notifications are set up under Settings, Notifications).
- Spacing is checked on a 4 px step, and dark-mode contrast and the 1024 px sidebar-collapsed layout are not separately audited.
