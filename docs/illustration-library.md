# Illustration library

68 illustrations, drawn in the Attract Studio style: flat shapes, thick rounded strokes, black ink and signal orange (`#FF5A1F`). The source is `design/Attract-Studio-Illustration-Gallery.html` (open it in a browser, with a light and dark toggle). `npm run illustrations` regenerates `src/components/illustrations/library.tsx` from it.

Use them with the component, by ID:

```tsx
import { Illustration } from "@/components/illustrations/illustration";
<Illustration id="RQ-1" className="w-48" decorative />
```

Pass `decorative` when the text next to it already says the same thing (it is then hidden from screen readers). The ink colour follows the surrounding text colour; the fill behind outlined shapes follows `--il-bg` (the card surface).

| ID | Name | Where it is used |
| --- | --- | --- |
| MS-1 | Idle | Mascot state idle: empty states, dashboard empty, default |
| MS-2 | Thinking | Mascot state thinking: AI generating, interview waiting |
| MS-3 | Celebrating | Mascot state celebrating: first publish, upgrade, milestones |
| MS-4 | Sad or error | Mascot state sad: AI error, failed actions, 404 |
| MS-5 | Sleeping | Mascot state sleeping: offline, maintenance |
| ON-1 | Collect | /onboarding step 1 hero (280 px wide) |
| ON-2 | Publish | /onboarding step 2 hero (280 px wide) |
| ON-3 | Attract | /onboarding step 3 hero (280 px wide) |
| RQ-1 | Empty: no requests | /app/requests empty state |
| RQ-2 | Sent | Request sent confirmation, status Sent |
| RQ-3 | Waiting for client | Request detail, status Started or Waiting |
| RQ-4 | Reminder | Reminder sent, reminders settings |
| RQ-5 | Revoked link | Request revoked, link revoked confirmation |
| IV-1 | Interview intro | /i/[token] intro header |
| IV-2 | Consent shield | /i/[token] consent screen |
| IV-3 | Progress trail | /i/[token] chat progress, loading between questions |
| IV-4 | Upload | /i/[token] closing: logo and headshot upload |
| IV-5 | Thank you | /i/[token] end screen |
| GN-1 | Generating | Case study generation screen, AiProgress |
| GN-2 | Verification | Review screen: claim sources, verified claims |
| GN-3 | Refine | Refine with AI: empty and success states |
| GN-4 | AI error | AI failure card, retry state |
| ED-1 | Claim tracing | Review screen empty state, claims explainer |
| ED-2 | Template gallery | /app/case-studies/[id]/template header |
| ED-3 | Locked template | Paid template lock, upgrade prompt |
| ED-4 | Editor blocks | Editor empty state, add section |
| ED-5 | Device preview | Editor device toggle, preview empty state |
| AP-1 | Signed and sealed | Approval received, signed confirmation |
| AP-2 | Certificate | Signed certificate page, /verify page |
| AP-3 | Consent withdrawn | Withdraw consent confirmation |
| PB-1 | Going live | Publish success, live badge |
| PB-2 | Results art | Public case study results section, sample page art |
| PB-3 | Wall of proof | Wall of proof widget settings, empty state |
| RF-1 | Referral network | /app/referrals empty state |
| RF-2 | Reward gift | Referral reward, free month earned |
| RF-3 | Analytics rising | /app/analytics empty state |
| RF-4 | Funnel | Demo and request funnels, leads funnel empty state |
| FD-1 | Map and compass | /app/finder empty state |
| FD-2 | Community fire | Finder: joined communities, tracker empty state |
| TM-1 | Roles | /app/settings/team: role badges and invite empty state |
| BL-1 | Free plan | Plan card: Free |
| BL-2 | Pro plan | Plan card: Pro |
| BL-3 | Studio plan | Plan card: Studio |
| BL-4 | Upgrade unlocked | Upgrade success, feature unlocked |
| BL-5 | Payment failed | Billing: payment failed banner and page |
| IN-1 | Plug and socket | Integrations empty state, connection failed |
| IN-2 | Pipes and dots | Automations running, run log empty state |
| IN-3 | Workflow nodes | Automations editor empty state |
| SO-1 | Carousel | Social publishing: carousel generated |
| SO-2 | Schedule | Social publishing: scheduled posts, calendar |
| SO-3 | Post boards | Social publishing: previews per network |
| DM-1 | Screen with hotspot | /app/demos empty state, demo editor |
| DM-2 | Chat simulator | Demo editor: chat scene empty state |
| DM-3 | Workflow walkthrough | Demo editor: workflow scene empty state |
| DM-4 | Before and after | Demo editor: compare scene empty state |
| SY-1 | 404 lost dot | 404 page |
| SY-2 | Offline | Offline banner and offline page |
| SY-3 | Maintenance | Maintenance and AI spend-limit messages |
| SY-4 | Limit reached | Plan limit reached, usage meter full |
| SY-5 | Session expired | Session expired dialog |
| SY-6 | Empty search | Search with no results |
| SY-7 | Privacy shield | Privacy and data settings |
| SY-8 | Delete data | Delete interview or workspace confirmation |
| SY-9 | Export | Data export ready |
| MK-1 | Hero scene | Marketing site hero (400 x 220) |
| MK-2 | How it works | Marketing site: three steps (600 x 160) |
| MK-3 | Integrations orbit | Marketing site: integrations (240 x 240) |
| MK-4 | Email header: invite | Interview invite email header, export to PNG (600 x 140) |

ID prefixes: MS mascot states, ON onboarding, RQ requests, IV interview, GN generation, ED editor and templates, AP approval and signing, PB publishing, RF referrals and analytics, FD finder, TM team, BL billing, IN integrations, SO social, DM demos, SY system, MK marketing and email.
