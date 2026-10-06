# Attract Studio: Animation and Illustration Reference

The single source of truth for every animation and visual asset. Each item has an **ID**, a **place in the app**, a **trigger**, a **motion spec** and a **reduced-motion fallback**. Work is done by ID ("implement G-02 and G-03 on the case study tabs").

Transcribed from `Attract Studio Animation and Illustration Reference.pdf` (37 pages). `src/lib/motion/registry.ts` lists what is built; a test checks every registered ID exists here.

## Setup rules

- Every implemented animation has `data-anim="ID"` on its root element and an entry in `src/lib/motion/registry.ts` (`{ id, name, component, file, status }`, status `planned` | `built` | `needs-review`).
- Start with P0 (foundation), then the series prompts in order. One prompt per session; review the diff, open `/dev/motion`, test with reduced motion, commit.

### ID series

| Series | Meaning |
| --- | --- |
| G | Global UI behaviour: tabs, sheets, toasts, buttons, lists |
| AI | Moments where the AI is working or has produced something |
| F | Feature screens for the workspace owner |
| C | Client-facing and public screens |
| S | System states and special moments |
| M | Mascot states (the magnet) |
| ILL | Illustrations and other visual assets |

Columns: **Where** (route or component), **Trigger**, **Spec** (starting points, tune by feel), **Reduced motion** (Fade = opacity only, Static = no movement, Instant = state change without transition), **P** (1 ship first, 2 next, 3 polish).

### File structure

```
src/lib/motion/          tokens.ts, springs.ts, variants.ts, registry.ts, useReducedMotion.ts
src/components/motion/   AnimatedTabs, PageTransition, Sheet, Toast, AiProgress, SuccessCheck, ...
src/components/mascot/   Mascot.tsx (state machine wrapper), states/
src/assets/illustrations/  themed inline SVG components
docs/animation-reference.md
```

### Brand reminders

- Palette: black `#0A0A0A`, paper `#FAFAF9`, signal orange `#FF5A1F`. Orange is for shapes, progress and accents, never small body text on light backgrounds. **Project decision:** the app stays on its cream light-only theme (`#faf7f0`); orange is added as the accent token, and the theme switch (G-41) is not built.
- The logo is a magnet pulling things in, so "pulling toward" is the signature motion: dots, quotes and cards move toward a target with an accelerating ease.

## Motion tokens and global rules

| Duration | Value | Used for |
| --- | --- | --- |
| instant | 90 ms | Press feedback |
| micro | 140 ms | Hover, focus, toggles, popovers |
| standard | 260 ms | Tab content, dialogs, toasts, cards |
| emphasis | 480 ms | Success moments, publish, charts |
| onboarding | up to 800 ms | Onboarding and splash only |
| stagger | 40 ms per item, max 8 items | Lists and grids |

| Easing | Curve | Use |
| --- | --- | --- |
| standard | cubic-bezier(0.22, 1, 0.36, 1) | Most enter animations |
| emphasized | cubic-bezier(0.65, 0, 0.35, 1) | Drawing strokes, progress, morphs |
| accelerate | cubic-bezier(0.55, 0, 0.85, 0.35) | The magnet pull and exits |
| decelerate | cubic-bezier(0.16, 1, 0.3, 1) | Elements arriving into place |

| Spring | Stiffness | Damping | Use |
| --- | --- | --- | --- |
| gentle | 120 | 20 | Large surfaces, sheets, page morphs |
| default | 300 | 30 | Indicators, cards, reordering |
| snappy | 500 | 35 | Toggles, small controls |
| bouncy | 400 | 18 | Success badges, celebration (sparingly) |

Global rules:

- Animate **transform and opacity only** (no width, height, top, left) except through the motion library's layout animations.
- Animations are **interruptible**: a new tap redirects the motion, it never queues.
- No animation blocks input; controls respond on the first frame.
- No animation longer than 600 ms outside onboarding and splash.
- Cap staggers at 8 items; later items appear together.
- At most three simultaneous animated regions in the viewport.
- Respect `prefers-reduced-motion` and an in-app **Reduce motion** setting (the in-app setting overrides).
- No flashing faster than 3 times per second.
- Orange glow or highlight is subtle (opacity up to 0.25) and never loops forever on a screen being read.
- `will-change` sparingly, only during an animation.

## Route to animation map

| Screen | IDs |
| --- | --- |
| App shell (all /app routes) | G-01 to G-14, G-27, G-41, G-43, S-13, S-14 |
| /onboarding | F-01 to F-03, G-17, G-18, G-31 |
| /app/dashboard | F-04 to F-06, G-22, G-29, G-30, S-04 |
| /app/requests, /app/requests/new | F-07 to F-11, G-22, G-25, G-32, G-39, G-47 |
| /app/case-studies (list) | F-12, F-13, G-21, G-22 |
| /app/case-studies/[id]/review | AI-03 to AI-08, AI-14, F-14, F-15 |
| /app/case-studies/[id]/template | F-16 to F-19, G-21, G-35 |
| /app/case-studies/[id]/edit | AI-09 to AI-13, F-20 to F-25, G-23, G-37 |
| Approval request and publishing | F-26 to F-31, S-10, S-16 |
| /i/[token] (client interview) | C-01 to C-10, AI-01, AI-02, G-17, G-31 |
| /sign/[token] | C-11 to C-16, S-16 |
| Public case study pages and embed | C-17 to C-23, G-33, G-34 |
| /verify and withdraw-consent | C-15, C-16 |
| /app/referrals | F-32, F-33 |
| Analytics views | F-34 to F-36, G-30 |
| /app/finder | F-37, F-38 |
| /app/settings/team | F-39, F-40, G-42 |
| /app/settings/billing | F-41 to F-45, S-08, S-09 |
| Integrations and automations | F-46 to F-49 |
| Social publishing | F-50 to F-53, AI-12, AI-13 |
| /app/demos/[id]/edit and demo player | F-54 to F-60, C-24 |
| System-wide states | S-01 to S-20 |
| PWA install and offline | S-01, S-07, S-11, S-12, S-13 |
| Mascot everywhere | M-01 to M-10 |

## G series: global UI animations

### Navigation and overlays

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| G-01 | Route transition | All /app route changes | Navigation | Desktop: 200 ms cross-fade plus 8 px y shift. Mobile: 280 ms push slide (x 24 px plus fade). List-to-detail uses a shared element (layoutId) | Fade 120 ms | 1 |
| G-02 | Sliding tab indicator | Any tabs or segmented control | Tab change | Indicator moves by layout spring (default) | Instant move | 1 |
| G-03 | Tab content transition | Tab panels | Tab change | Direction-aware: exit -10 px and fade 120 ms, enter +10 px and fade 260 ms. Scroll position kept per tab | Fade only | 1 |
| G-04 | Sidebar collapse and expand | Desktop sidebar | Toggle or Cmd+B | Width 248 to 72 px with snappy spring, labels fade 140 ms | Instant | 2 |
| G-05 | Active nav pill glide | Sidebar and bottom bar | Route change | Shared layoutId pill with default spring | Instant | 1 |
| G-06 | Bottom tab bar indicator and icon bounce | Mobile bottom tab bar | Tab tap | Indicator spring. Icon scale 1 to 1.15 to 1 over 240 ms | Instant | 1 |
| G-07 | Command palette | Cmd+K overlay | Keyboard | Scale 0.96 to 1 and fade 200 ms, backdrop blur 0 to 12 px, results stagger 30 ms | Fade | 2 |
| G-08 | Large title collapse | Page headers | Scroll | Scroll-linked: title scales 1 to 0.7 and moves into a sticky bar | Static small title | 2 |
| G-09 | Header blur fade-in | Sticky headers | Scroll past 8 px | Background opacity 0 to 0.8 and hairline border fade, 140 ms | Instant | 2 |
| G-10 | Dialog enter and exit | All modals | Open and close | Scale 0.96 to 1 and fade 260 ms. Exit 160 ms. Backdrop fades | Fade | 1 |
| G-11 | Bottom sheet | Mobile pickers and forms (centered dialog on desktop) | Open, drag | Gentle spring slide-up, detents at 50 and 90 percent, drag with rubber-band, dismiss by velocity | Fade, no slide | 1 |
| G-12 | Toast | Global notifications | Event | Slide and scale from edge with default spring, 4 s auto-dismiss with shrinking bar, swipe to dismiss | Fade | 1 |
| G-13 | Popover and dropdown | Menus, selects | Open | Scale 0.95 to 1 from the anchor origin, 140 ms | Fade | 1 |
| G-14 | Tooltip | Icons, truncated text | Hover or focus | Fade 140 ms plus 4 px shift, 300 ms delay | Fade | 3 |
| G-43 | Context menu | Right click, long press | Open | Scale 0.96 from pointer, 140 ms. Items stagger 20 ms | Fade | 3 |

### Controls and lists

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| G-15 | Button press | All buttons | Press | Scale 0.97 for 90 ms, spring back on release | None | 1 |
| G-16 | Button loading to success | Send, publish, save actions | Async action | Label fades, ring spinner appears, success morphs to a check for 400 ms then returns | Text swap | 1 |
| G-17 | Input focus and floating label | All forms | Focus | Focus ring grows 0 to 3 px in 140 ms. Label floats up 12 px and scales to 0.85 | Instant | 2 |
| G-18 | Validation shake and error slide | Forms | Invalid input | Shake x plus or minus 4 px three times in 280 ms. Error text slides down 8 px and fades in | Error text fades only | 2 |
| G-19 | Toggle switch | Settings, automations | Toggle | Thumb moves with snappy spring. Track colour crossfades 140 ms | Instant | 2 |
| G-20 | Checkbox and radio draw | Consent, filters | Toggle | Check stroke draws in 180 ms (stroke-dashoffset). Box fill scales in | Instant | 2 |
| G-21 | Card hover lift | Cards, gallery | Hover | Move up 2 px and brighten the border, 140 ms | None | 2 |
| G-22 | List stagger entry | Lists and grids | Mount | Items fade up 12 px, 40 ms stagger, max 8 items | Fade | 1 |
| G-23 | List reorder | Sections, scenes, requests | Drag or sort | Layout animation with default spring. Neighbours shift smoothly | Instant | 2 |
| G-24 | Delete collapse | Rows and cards | Delete | Fade and height collapse, 260 ms | Fade | 2 |
| G-25 | Swipe actions | Mobile list rows | Swipe | Row follows the finger, action revealed, spring back or commit | Actions in a menu | 2 |
| G-26 | Pull to refresh with the magnet | Mobile lists | Pull down | Dots are pulled toward the magnet as pull distance grows. On release the magnet spins | Plain spinner | 2 |
| G-37 | Drag and drop feedback | Editor, scenes | Grab and drop | Grab: scale 1.03 and shadow. Drop: settle with default spring | Instant | 2 |

### Data, loading and decoration

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| G-38 | Accordion | FAQ, settings, claims lists | Toggle | Height animates to auto in 260 ms. Chevron rotates 90 degrees | Instant | 2 |
| G-39 | Copy confirm | Copy link, embed snippet | Click | Icon morphs into a check for 1.5 s. Tooltip says Copied | Text swap | 1 |
| G-44 | Segmented control hover | Toolbars | Hover | Hovered segment background fades in at 0.06 opacity, 140 ms | None | 3 |
| G-45 | Search input expand | Headers | Focus | Input widens 160 to 320 px by layout animation, icon shifts | Instant | 3 |
| G-46 | Filter chips | Lists and galleries | Select | Chip fills with orange tint 140 ms and scales 1 to 1.04 to 1 | Instant | 3 |
| G-47 | Table row hover and selection | Requests and leads tables | Hover, select | Hover tint fade 140 ms. Selection check draws, row tint steps in | Instant | 3 |
| G-27 | Skeleton shimmer | All async content | Loading | Brand-tint pulse, opacity 0.5 to 0.9, 1.4 s loop | Static tint | 1 |
| G-48 | Skeleton to content crossfade | All async content | Data arrives | Skeleton fades out while content fades in, 200 ms. No layout jump | Instant swap | 1 |
| G-28 | Image blur-up | Screenshots, logos, thumbnails | Image load | Blur 12 px to 0 and fade, 300 ms | Fade | 3 |
| G-29 | Number count-up | KPIs, usage, prices | Mount or in view | Count over 600 ms with ease-out, tabular figures | Final value | 2 |
| G-30 | Chart draw-in | Line, bar and ring charts | Mount | Lines draw in 700 ms, bars grow 500 ms with stagger | Static chart | 2 |
| G-31 | Progress bar and ring | Interviews, uploads, onboarding | Value change | Default spring or 300 ms emphasized ease | Instant | 1 |
| G-32 | Status chip morph | Status badges everywhere | Status change | Colour crossfade 200 ms plus scale 1 to 1.08 to 1 | Instant | 2 |
| G-33 | Scroll reveal | Public pages, marketing | Enter viewport | Fade up 16 px over 400 ms, once per element | Visible, no motion | 2 |
| G-34 | Parallax hero | Public pages, marketing hero | Scroll | Layers move at 0.2 to 0.5 times scroll speed | None | 3 |
| G-35 | Cursor glow | Gallery and feature cards (desktop) | Pointer move | Soft radial highlight (opacity up to 0.15) follows the cursor | None | 3 |
| G-36 | Focus-visible ring | Keyboard focus | Tab key | Ring scales in 120 ms | Instant | 2 |
| G-40 | Notification badge pop | Bell and tab badges | New item | Badge scale 0 to 1.2 to 1. Bell rotates plus or minus 12 degrees once | Badge appears | 3 |
| G-41 | Theme switch (not built: the app is light-only) | Light and dark mode | Toggle | 250 ms colour crossfade through CSS variables or a view transition | Instant | 3 |
| G-42 | Avatar stack hover | Team lists | Hover | Avatars fan out 8 px, 140 ms | None | 3 |

## AI series: AI moments

The highest-impact animations. They must be honest: labels describe what the system is really doing and are announced through an `aria-live` region. Never fake progress.

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| AI-01 | Typing indicator | Client interview chat | Bot is generating a reply | Three dots in a bubble, spring wave 1.2 s loop, staggered 150 ms | Static three dots | 1 |
| AI-02 | Streaming text reveal | Interview replies, AI drafts | Reply arrives | Words fade in at 20 to 40 ms per word. Input stays active | Show full text | 1 |
| AI-03 | Generation progress narrative | /case-studies/[id]/review, generation start | Generate clicked | Narrated steps (Reading the interview, Finding the facts, Checking every number, Writing) light up in order. Active step has a small orange pulse. Each step reflects a real server stage | Steps change text only | 1 |
| AI-04 | Quote pull (magnet) | Review screen during generation | Claims extracted | Quote snippets travel from the transcript pane to their page sections along an accelerate curve, 480 ms each, stagger 60 ms | Snippets appear in place | 2 |
| AI-05 | Section-by-section page assembly | Review and preview | Draft generated | Skeleton page fills section by section, 200 ms crossfade each, top to bottom | Whole page fades in | 1 |
| AI-06 | Claim chip snap-in | Review screen | Claim linked to a metric | Chip scales 0.9 to 1 with bouncy spring and attaches to its metric | Appear | 2 |
| AI-07 | Claim verification stamp | Review screen | Claim verified in code | Check mark draws 180 ms, chip border turns solid | Instant check | 2 |
| AI-08 | Claim-to-source line | Review screen and client approval page | Hover or tap on a number | A path draws from the number to its source quote in 300 ms, quote highlights | Highlight only | 2 |
| AI-09 | Refine with AI button states | Editor, every text field except quotes | Hover, click, finish | Idle: faint shimmer border on hover. Working: a small dot orbits the button. Done: morphs into Accept and Reject buttons, 260 ms | Static spinner text | 1 |
| AI-10 | Inline diff | Editor, after Refine | Suggestion returned | Removed words strike and fade 200 ms, added words fade in with an orange underline that settles after 600 ms | Highlight colours only | 1 |
| AI-11 | Restore original rewind | Editor | Restore clicked | The diff plays in reverse in 300 ms | Instant swap | 3 |
| AI-12 | Draft typewriter | Social post drafts, demo captions, chat scripts | Draft generated | Text types into the card at 1 to 2 characters per frame, then settles | Show full text | 2 |
| AI-13 | Regenerate cross-dissolve | Any AI draft | Regenerate clicked | Old text fades out 160 ms while new text fades in, height animates smoothly | Instant swap | 2 |
| AI-14 | AI error | Any AI action | Failure | Gentle shake of the card (plus or minus 4 px, 280 ms), mascot M-05, retry button fades in | Static message | 1 |
| AI-15 | AI badge pulse | Spark icon beside AI actions | Idle and working | Slow scale pulse 1 to 1.1 over 2.4 s only while working | Static | 3 |
| AI-16 | Suggestion chips | Refine presets, demo helpers | Menu opens | Chips fade up with 30 ms stagger | Fade | 3 |

## F series: feature screens

### Part 1: onboarding to editor

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | Onboarding step transition | /onboarding | Next or back | Direction-aware slide plus fade, 480 ms. A progress ring around the step number fills | Fade | 2 |
| F-02 | Profile card assembly | /onboarding | Fields filled | A live profile card builds up as each field is completed, each line fading in 200 ms | Static card | 3 |
| F-03 | Welcome completion | End of onboarding | Finish | Mascot M-04 celebrates, dashboard fades in behind it, 600 ms | Fade | 2 |
| F-04 | KPI cards entrance | /app/dashboard | Mount | Cards fade up with 40 ms stagger. Numbers count up (G-29) | Fade, final numbers | 1 |
| F-05 | Next best action pulse | /app/dashboard | New suggestion | Card border glows orange once (opacity 0.25, 800 ms), no loop | Static highlight | 3 |
| F-06 | Empty dashboard scene | /app/dashboard with no data | Idle | Mascot M-01 idle loop with dots drifting toward the magnet, 6 s slow loop | Static illustration | 2 |
| F-07 | Create request to envelope | /app/requests/new | Send clicked | Form collapses (260 ms) into an envelope that slides off and fades (400 ms), then a success check | Fade to success message | 2 |
| F-08 | Link copy morph | Request detail | Copy clicked | Uses G-39 plus the link text briefly highlights | Text swap | 1 |
| F-09 | Request status transition | Requests list and detail | Status change | Uses G-32. A timeline dot fills along a line from sent to started to completed, 300 ms | Instant | 2 |
| F-10 | Reminder sent | Request detail | Reminder sent | A small paper plane arcs out from the button, 400 ms, then a toast | Toast only | 3 |
| F-11 | Revoke link | Request detail | Revoke confirmed | Link chip splits in two and fades, status chip changes to Revoked, 320 ms | Chip changes only | 3 |
| F-12 | Case study grid entrance | /app/case-studies | Mount | G-22 stagger. Thumbnails blur-up (G-28) | Fade | 2 |
| F-13 | Case study status badge | Case study cards and headers | Status change | G-32. Published gets a single soft orange pulse | Instant | 3 |
| F-14 | Source popover | Review screen | Tap a claim | Popover scales from the claim (G-13) with the source quote highlighted | Fade | 2 |
| F-15 | Edited-claim highlight | Review and editor | Verified claim edited | Underline in orange draws left to right in 300 ms and a small Needs re-approval chip pops in | Chip appears | 2 |
| F-16 | Template card tilt | /case-studies/[id]/template | Pointer move | Card tilts up to 4 degrees toward the pointer, 140 ms smoothing. Not on touch | None | 3 |
| F-17 | Template switch morph | Template gallery and editor | Template selected | Live preview crossfades 260 ms and sections slide to new positions by layout animation. Content never changes | Crossfade | 1 |
| F-18 | Lock unlock | Template cards | Upgrade completed | Lock icon rotates open and fades, card border glows once | Lock disappears | 3 |
| F-19 | Watermark preview | Paid templates on a free plan | Preview | A diagonal Preview watermark fades in at 0.12 opacity | Static watermark | 3 |
| F-20 | Section insert | Editor | Add section | New section slides in from below (12 px) and expands, 260 ms. Preview scrolls to it | Fade | 2 |
| F-21 | Section drag reorder | Editor | Drag | Uses G-37 and G-23 | Instant | 2 |
| F-22 | Autosave indicator | Editor header | Save | Cloud icon cycles Saving (rotating dot) to Saved (check draws) to idle, 400 ms | Text only | 2 |
| F-23 | Edit highlight flash | Editor preview | Text edited | Changed block background flashes orange tint (opacity 0.15) for 600 ms | None | 3 |
| F-24 | Device preview morph | Editor preview | Device toggle | Frame width and radius animate between desktop, tablet and phone by layout spring | Instant resize | 1 |
| F-25 | Theme change crossfade | Editor preview | Colour or font change | 200 ms crossfade of colours. Font swaps with a fade to avoid a jump | Instant | 3 |

### Part 2: approval to demos

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| F-26 | Approval status timeline | Case study header | Request approval clicked | A horizontal timeline (Draft, Sent, Viewed, Signed) fills along with each real event, 300 ms per step | Steps change instantly | 2 |
| F-27 | Awaiting to approved | Case study header | Client signs | Status chip morphs, a check draws, and a subtle confetti-free glow appears once | Instant chip change | 2 |
| F-28 | Publish progress | Publish button | Publish clicked | Button morphs into a progress ring (G-16), then a pulse expands outward from the button once | Spinner then text | 1 |
| F-29 | Live URL reveal | After publish | Published | The public URL types in at 30 ms per character with a copy button (G-39) | URL appears | 2 |
| F-30 | Celebration burst (restrained) | After first publish only | First publish | 24 small orange and black particles burst for 900 ms with a magnet pull back to centre | Static check and message | 2 |
| F-31 | Unpublish fade | Case study header | Unpublish | Live badge fades, page thumbnail desaturates to grey over 260 ms | Instant | 3 |
| F-32 | New referral entrance | /app/referrals | Referral arrives | Card slides in from the top with default spring and a single orange glow | Fade | 2 |
| F-33 | Referral network lines | /app/referrals | Mount | Lines draw from the client node to referral nodes, 500 ms, stagger 80 ms | Static graph | 3 |
| F-34 | Analytics charts | Dashboard and case study analytics | Mount or range change | G-30. On range change, old values morph into new by interpolation, 400 ms | Instant | 2 |
| F-35 | Chart tooltip spring | Charts | Hover or touch | Tooltip follows the pointer with snappy spring, point marker scales 1 to 1.4 | Static tooltip | 3 |
| F-36 | Funnel bars | Demo and request funnels | Mount | Bars grow left to right with stagger, drop-off percentages count up (G-29) | Static | 3 |
| F-37 | Community card hover | /app/finder | Hover | G-21. Platform badge nudges 2 px | None | 3 |
| F-38 | Finder status change | /app/finder | Status select | Chip morphs (G-32) and the card slides to its new group with layout animation | Instant move | 3 |
| F-39 | Invite sent | /app/settings/team | Invite sent | New row slides in with a pending chip that pulses once | Fade | 3 |
| F-40 | Role change | /app/settings/team | Role changed | Role chip morphs (G-32), row flashes with a tint | Instant | 3 |
| F-41 | Plan card billing toggle | /app/settings/billing | Monthly to annual | Prices roll like a counter, a Save badge scales in, card heights adjust by layout animation | Final values | 2 |
| F-42 | Price roll | Pricing cards | Toggle | Digits roll vertically 300 ms with tabular figures | Instant | 3 |
| F-43 | Upgrade success | After payment | Subscription active | Plan card gets the success ring (S-16), unlocked features list fades in with 40 ms stagger, mascot M-04 | Static success | 2 |
| F-44 | Usage meter fill | Billing and header | Mount, usage change | Bar fills with a default spring. Turns amber then red thresholds with 200 ms crossfade | Instant | 2 |
| F-45 | Limit nudge | When 80 percent of a limit is reached | Threshold crossed | Meter pulses once, an upgrade chip slides in from the right | Static chip | 3 |
| F-46 | Connection snap | Integrations | Connection completed | Two connector icons slide together and snap with a bouncy spring, status chip turns green | Icons joined instantly | 2 |
| F-47 | Flow line pulse | Automations editor | Rule enabled, run | A small dot travels along the lines between nodes, 800 ms, accelerate easing | Lines highlighted | 3 |
| F-48 | Rule enable ripple | Automations list | Toggle on | G-19 plus a soft ripple from the thumb, 400 ms | Instant | 3 |
| F-49 | Run log row entry | Automation run log | New run | Row slides in from the top, success or failure icon draws (S-16 or S-17) | Fade | 3 |
| F-50 | Post cards compose | Social publishing | Case study published | Cards for each network assemble from the case study blocks, 60 ms stagger, 300 ms each | Fade | 2 |
| F-51 | Carousel slide fan-out | Social publishing | Carousel generated | Slides fan out from a stack with 8 degree rotation then align in a row, 480 ms | Static row | 3 |
| F-52 | Schedule picker | Social publishing | Open | Uses G-11. Selected time slot scales 1.04 and fills orange tint | Instant | 3 |
| F-53 | Posted ticks | Social publishing | Post published | Per-network check draws in 180 ms, stagger 120 ms | Instant ticks | 3 |
| F-54 | Hotspot pulse | Demo player and editor | Step is active | Orange ring expands 1 to 1.8 and fades, 1.6 s loop, stops after 3 pulses | Static ring | 1 |
| F-55 | Demo step transition | Demo player | Next step | Screenshot crossfades 260 ms. Tooltip moves to the next hotspot with default spring | Crossfade | 1 |
| F-56 | Chat simulator playback | Demo chat scene | Scene starts | Messages appear in sequence using AI-01 typing then C-03 bubbles, per the scripted delays | All messages visible | 1 |
| F-57 | Workflow sequence | Demo workflow scene | Scene starts | Nodes light up in order (200 ms each) and a dot travels along each connecting edge (F-47) | All nodes highlighted | 2 |
| F-58 | Before and after slider | Demo compare scene | Load, drag | On load the handle eases from 50 to 40 to 60 percent once to hint at dragging. Dragging follows the finger | Static at 50 percent | 2 |
| F-59 | Scene list reorder | Demo editor | Drag | G-37 and G-23 | Instant | 2 |
| F-60 | Lead gate modal | Demo player | Gate reached | G-10 with the demo behind blurred 8 px | Fade | 2 |

## C series: client-facing and public screens

Clients and visitors have no account and often use a phone. Keep animation code small, avoid heavy libraries on these routes, prefer CSS animations. Pages under /i and /sign keep the JavaScript budget from the build plan.

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| C-01 | Interview intro entrance | /i/[token] intro | Load | Header illustration fades in 260 ms, text lines fade up with 40 ms stagger | Fade | 1 |
| C-02 | Consent checkbox draw and unlock | /i/[token] intro | Checkbox ticked | G-20. The Continue button unlocks with a 200 ms fade from disabled to enabled | Instant | 1 |
| C-03 | Chat bubble spring-in | /i/[token] chat | New message | Bubble scales 0.92 to 1 and fades with default spring, aligned to its sender side | Fade | 1 |
| C-04 | Question progress ring | /i/[token] chat | Question answered | Ring around the question counter fills with a 300 ms emphasized ease | Instant | 2 |
| C-05 | Send answer feedback | /i/[token] chat | Send | Send button scales 0.9 and back, the user's bubble slides up from the input, 200 ms | Fade | 2 |
| C-06 | Switch to form | /i/[token] | Switch clicked | Chat slides left and the form slides in from the right, 280 ms | Fade | 3 |
| C-07 | Upload progress and thumbnail pop | /i/[token] closing | File chosen | Progress ring 0 to 100 percent, then the thumbnail pops in (scale 0.9 to 1) | Static progress | 3 |
| C-08 | Closing celebration | /i/[token] closing | Interview submitted | Mascot M-10 small cheer and a check ring (S-16), no confetti on a client page | Static check | 2 |
| C-09 | Referral ask card | /i/[token] closing | Reached | Card slides up 12 px and fades, 260 ms | Fade | 3 |
| C-10 | Thank-you scene | /i/[token] end | Done | Illustration ILL-30 fades in, a short line of text fades after 200 ms | Fade | 2 |
| C-11 | Claim source expand | /sign/[token] | Tap a claim | G-38 accordion with the source quote highlighted (AI-08) | Instant | 2 |
| C-12 | Changes diff panel | /sign/[token] | Panel opened | Slides down 260 ms. Changed words fade between original and edited as the client toggles Original or Edited | Instant toggle | 2 |
| C-13 | Signature ink stroke | /sign/[token] | Drawing | Stroke renders live with slight smoothing and line width reacting to speed. Clear button fades the canvas out in 160 ms | Plain stroke | 1 |
| C-14 | Sign stamp | /sign/[token] | Sign pressed | Button morphs (G-16), a seal stamps with a quick scale 1.2 to 1 and a short settle, 360 ms | Check only | 2 |
| C-15 | Certificate unfold | Signed confirmation, /verify | After signing | A document card unfolds from the seal (height and fade, 420 ms) with a Download button | Fade | 2 |
| C-16 | Withdraw consent confirmation | Withdraw consent page | Confirmed | Seal gets a diagonal line drawn through it, status changes to Withdrawn, 400 ms | Status text only | 3 |
| C-17 | Public page hero entrance | Public case study page | Load | Headline fades up 16 px, client logo fades 100 ms later, 400 ms total | Fade | 2 |
| C-18 | Metric counters | Public case study page | In view | G-29 on each metric with 80 ms stagger, once | Final values | 2 |
| C-19 | Quote reveal | Public case study page | In view | Quote text reveals line by line (mask slide up), 500 ms, attribution fades after | Fade | 3 |
| C-20 | CTA attention | Public case study page | After 6 s idle or at the end of the page | Button does a single gentle scale pulse 1 to 1.04 to 1, never loops | None | 3 |
| C-21 | Wall of proof carousel | Widget and public pages | Idle, hover | Cards auto-scroll slowly (20 px per second), pause on hover and focus, drag to scroll | Static grid | 3 |
| C-22 | Embed widget fade-in | /embed/{slug} inside customer sites | Load | Fade 200 ms only. Height changes are not animated to avoid layout jank on host pages | None | 2 |
| C-23 | Takedown report confirmation | Report form | Submitted | Check ring (S-16) and a short confirmation, 400 ms | Static check | 3 |
| C-24 | Demo player shell | Public demo pages | Load, step change | Uses F-54 to F-60 with the lighter budget above | Per component | 1 |

## S series: system states and special moments

| ID | Animation | Where | Trigger | Spec | Reduced | P |
| --- | --- | --- | --- | --- | --- | --- |
| S-01 | Splash and launch | PWA cold start, marketing hero | App launch | Logo letters lean toward the magnet one by one and settle, 800 ms total. Skipped on warm starts and when the app is already loaded | Logo fades in | 2 |
| S-02 | Magnet loader | Inline loading, buttons, pull to refresh | Loading longer than 400 ms | Dots drawn toward the magnet with the accelerate easing, 2.4 s loop, staggered | Static magnet with dots | 1 |
| S-03 | Page skeletons | Every route with async data | Navigation | G-27 and G-48 with layouts that match the final page to avoid jumps | Static | 1 |
| S-04 | Empty state idle loops | Each module with no data | Mount | Mascot idle (M-01) and the module's illustration with a slow 6 s drift. Paused when the tab is hidden | Static | 2 |
| S-05 | 404 page | Not found | Load | Mascot M-05 with one dot rolling away, then the dot rolls back on hover | Static | 3 |
| S-06 | Link expired or revoked | Client links | Load | Magnet with a broken link icon, a gentle fade-in 260 ms, no looping motion | Static | 2 |
| S-07 | Offline | App shell | Connection lost | Banner slides down 260 ms. Mascot M-07 sleeping with slow breathing. Banner leaves when back online with a check | Banner only | 2 |
| S-08 | Limit reached | Plan limits | Limit hit | Meter fills and shakes once, upgrade card slides up (G-11) | Static card | 2 |
| S-09 | Payment failed | Billing | Webhook event | Warning banner slides in, amber pulse once (S-18), Update payment button highlighted | Banner only | 2 |
| S-10 | Milestone celebration | First case study published, first referral, tenth interview | Event, once per milestone | Mascot M-04, 24 restrained particles for 900 ms, short message toast. Never repeats for the same milestone | Static message | 2 |
| S-11 | PWA install prompt | App header | Install available | Prompt slides down 260 ms. After accepting, the app icon slides toward a home screen grid and settles | Fade | 3 |
| S-12 | Push permission prompt | Settings, after a user action | Toggle on | Bell icon rings once (G-40), dialog uses G-10 | Static | 3 |
| S-13 | Update available | App shell | New service worker | Toast with a refresh icon that rotates once, G-12 | Static toast | 2 |
| S-14 | Session expired | App shell | Auth expiry | Dialog G-10, lock icon closes with a small bounce, sign-in form focuses | Static | 3 |
| S-15 | Maintenance or AI spend breaker | Interview and AI features | Server flag | Calm full-card message with mascot M-07, no loops, retry timer counts down | Static | 3 |
| S-16 | Success check (generic) | Everywhere success is confirmed | Success | Ring draws in 350 ms and the check draws in 220 ms, a soft pulse ring expands once, 800 ms total | Static check | 1 |
| S-17 | Failure cross (generic) | Everywhere failure is shown | Failure | Ring draws and the cross draws, a short shake, 500 ms | Static cross | 1 |
| S-18 | Warning pulse | Warnings | Warning shown | Amber triangle scales 1 to 1.1 to 1 once, 400 ms | Static | 3 |
| S-19 | Guided tour hotspots | First-time user tours | Tour step | Spotlight cutout fades 260 ms, orange pulse ring on the target (F-54 style), tooltip springs in | Static outline | 3 |
| S-20 | Feature spotlight | New feature announcements | First visit after release | A small dot badge pulses 3 times then stays still. Popover uses G-13 | Static badge | 3 |

## Mascot (the magnet) and illustrations

Style: flat geometric shapes, thick rounded strokes, black, paper and orange. A small vocabulary (circles, rounded rectangles, arcs, dots). Inline SVG components themed through CSS variables (orange stays orange). No gradients, no tiny details; check at 120 px and 480 px. Every asset has a static SVG as the reduced-motion fallback. **Project decision:** pure SVG + CSS, no Rive or Lottie.

`<Mascot state="..." size="..." />` with a state machine; each state is also a static pose.

| ID | State | Used by | Motion |
| --- | --- | --- | --- |
| M-01 | Idle | Empty states, dashboard empty (F-06, S-04) | Slow blink every 5 s, dots drift toward the magnet |
| M-02 | Thinking | AI-03 generation, interview waiting | Dots orbit slowly, eyes look up |
| M-03 | Working | Loaders (S-02), pull to refresh (G-26) | Pulls dots in with accelerate easing, 2.4 s loop |
| M-04 | Celebrating | F-03, F-43, S-10 | Hops once, dots burst outward then return, 900 ms |
| M-05 | Sad or error | AI-14, 404 (S-05), failures | Dots drop and bounce once, magnet tilts |
| M-06 | Waiting | Awaiting client approval, pending requests | Taps foot or tilts side to side every 3 s |
| M-07 | Sleeping | Offline (S-07), maintenance (S-15) | Slow breathing scale, closed eyes |
| M-08 | Pointing | Guided tour (S-19), onboarding tips | Leans toward the pointed element |
| M-09 | Loading small | Inline button loaders | Reduced two-dot version of M-03 for small sizes |
| M-10 | Cheer small | Client pages (C-08) | Single small hop with a check, no particles |

### Illustration assets

| ID | Asset | Where used | Notes |
| --- | --- | --- | --- |
| ILL-01 to ILL-03 | Onboarding scenes: collect, publish, attract | /onboarding (F-01) | Wide scenes, 3 steps of one story |
| ILL-04 | Empty: no requests | /app/requests | Envelope and magnet |
| ILL-05 | Empty: no case studies | /app/case-studies | A blank page being pulled in by the magnet |
| ILL-06 | Empty: no referrals | /app/referrals | Dots with a connecting line |
| ILL-07 | Empty: no leads | Leads inbox | Empty tray with a magnet above |
| ILL-08 | Empty: no analytics yet | Analytics | Flat chart outline |
| ILL-09 | Empty: no communities saved | /app/finder | Map pin and magnet |
| ILL-10 | Empty: no demos | /app/demos | Play button on a screen frame |
| ILL-11 | Empty: no social posts | Social publishing | Speech bubbles |
| ILL-12 | Empty: no automations | Integrations | Two connectors apart |
| ILL-13 | Empty: no team members | /app/settings/team | A single avatar and a plus |
| ILL-14 | Error: 404 | S-05 | Lost dot |
| ILL-15 | Error: link expired | S-06, client pages | Broken link |
| ILL-16 | Error: link revoked | S-06 | Link with a cross |
| ILL-17 | Error: limit reached | S-08 | Full meter |
| ILL-18 | Error: payment failed | S-09 | Card with a warning |
| ILL-19 | Error: offline | S-07 | Cloud with a slash |
| ILL-20 | Success: published | F-28, F-29 | Page with a live beacon |
| ILL-21 | Success: approved | F-27 | Page with a check |
| ILL-22 | Success: signed | C-14, C-15 | Seal on a document |
| ILL-23 | Success: upgraded | F-43 | Unlocked padlock |
| ILL-24 | Client interview header | C-01 | Friendly chat bubbles and the magnet |
| ILL-25 | Consent shield | C-02 | Shield with a check |
| ILL-26 | Approval page header | C-11 | Document with highlighted lines |
| ILL-27 | Paywall and upgrade | Template locks, limits | Key and magnet |
| ILL-28 | Demo player scenes | Demo module | Play, chat, workflow icons as scene illustrations |
| ILL-29 | Device frames | F-24 preview | Desktop, tablet and phone outlines |
| ILL-30 | Client thank-you | C-10 | Magnet with dots gathered around it |
| ILL-31 | Maintenance | S-15 | Magnet resting |
| ILL-32 | Milestone badges | S-10 | First published, first referral, tenth interview |

### Custom icon set (ILL-40 series)

One stroke weight (2 px at 24 px), rounded caps and joins, one corner radius. Do not mix icon libraries. Outline version, plus a filled active version for navigation where it helps.

| ID | Group | Icons |
| --- | --- | --- |
| ILL-40 | Navigation | Home, requests, case studies, demos, referrals, analytics, finder, integrations, social, team, billing, settings |
| ILL-41 | Actions | Add, edit, delete, copy, share, download, upload, send, refresh, reorder, drag handle, filter, search, more |
| ILL-42 | Status | Check, cross, warning, info, clock, lock, unlock, eye, eye off, link, broken link, bell |
| ILL-43 | AI and content | Spark (AI), refine, quote, metric, claim, source, template, device (desktop, tablet, phone), play, chat, workflow |
| ILL-44 | Networks | LinkedIn, Instagram, Facebook as simple neutral marks (check each platform's brand rules before use) |

### Patterns and surfaces

| ID | Asset | Where | Notes |
| --- | --- | --- | --- |
| ILL-50 | Dot grid background | Hero areas, empty states | Faint dots at 0.06 opacity that echo the magnet's dots |
| ILL-51 | Orange stripe texture | Marketing, badges | The motion-line stripes from the logo |
| ILL-52 | Glass surface | Sidebar, sheets, sticky headers | Translucent surface with backdrop blur 16 px and a hairline border |
| ILL-53 | Hairline border and layered shadow tokens | Cards, dialogs | 0.5 px border plus two soft shadows, 2 and 12 px |
| ILL-54 | Noise-free flat fills | Everywhere | No gradients or noise |

### Email, social and marketing

| ID | Asset | Notes |
| --- | --- | --- |
| ILL-60 | Interview invite header | Magnet with an envelope, static image (email clients do not support motion reliably) |
| ILL-61 | Reminder header | Magnet checking a watch |
| ILL-62 | Approval request header | Document with a signature line |
| ILL-63 | Signed certificate email header | Seal |
| ILL-64 | Notification and referral header | Magnet with a new dot |
| ILL-70 | Social carousel templates (3) | 1080 x 1350 slides in the brand palette for case study quotes, metrics and CTAs |
| ILL-71 | Open Graph image template | 1200 x 630, auto-generated per published case study with client name and top metric |
| ILL-72 | Marketing hero scene | The magnet pulling dots and proof cards, animated version for the website (G-34) |
| ILL-73 | How it works, 3 steps | Interview, approve, attract |
| ILL-74 | Integrations scene | Connector icons orbiting the magnet |
| ILL-75 | Pricing page accents | Small illustrations per plan |
| ILL-76 | Product Hunt and directory gallery images | Screens in device frames with captions |

Animated GIFs in email are optional, under 300 KB, with a static first frame.

## Implementation notes

| Need | Tool | Notes |
| --- | --- | --- |
| Springs, layout animations, enter and exit, shared elements | `motion` (`motion/react`, loaded with LazyMotion) | /app screens only |
| Route transitions | CSS View Transitions where supported, with the motion library as fallback | Check support inside installed PWAs |
| Mascot state machine | Inline SVG + CSS | No Rive or Lottie (project decision); static pose as fallback |
| Illustrations and icons | Inline SVG components | Theme with CSS variables |
| Charts | The charting approach already in the stack, with CSS or motion draw-in | Static on reduced motion |
| Confetti and particles | A tiny canvas particle function (a few KB) | Only F-30 and S-10 |
| Haptics | Vibration API on supported Android browsers | Extra; unsupported on iOS Safari |
| Sound | Web Audio, off by default | Never required to understand the UI |
| Scroll-linked effects | CSS scroll-driven animations where supported, otherwise IntersectionObserver | Verify support |

Performance budgets: 60 fps on a mid-range Android phone (profile with throttled CPU). Animation code is split by route; /i, /sign and public pages must not load the motion library if CSS can do the job. Pause looping animations when the tab is hidden or the element is off screen. No animation on the critical path of first contentful paint.

Accessibility: honour `prefers-reduced-motion` and an in-app Reduce motion toggle that overrides it. No content depends on animation to be understood; progress and AI status are also text, announced via `aria-live`. No flashing above 3 per second. Manage focus after transitions. Keep interactive targets stable during animation.

Testing: a `/dev/motion` page renders every implemented ID with a reduced-motion toggle; Playwright tests load key screens with reduced motion and assert no transform animations run; a visual check on a real phone for sheets, swipe actions and pull to refresh; Lighthouse and a performance trace on /i/[token] and a public page after adding animation.

## Prompts, build order and done criteria

Prompts (run in order, one per session): **P0** foundation and registry; **P1** navigation and overlays (G-01 to G-14, G-43); **P2** controls and lists (G-15 to G-26, G-37 to G-39, G-44 to G-47); **P3** data, loading and decoration (G-27 to G-36, G-40 to G-42, G-48); **P4** AI moments (AI-01 to AI-16; AiProgress must use real server stage events); **P5** feature screens part 1 (F-01 to F-25); **P6** part 2 (F-26 to F-45); **P7** integrations, social and demos (F-46 to F-60); **P8** client interview (C-01 to C-10, under 100 KB JS); **P9** approval and e-signature (C-11 to C-16); **P10** public pages and widget (C-17 to C-24); **P11** system states (S-01 to S-20); **P12** mascot (M-01 to M-10); **P13** illustration and icon library (ILL series, `/dev/illustrations`); **P14** email, social and marketing assets (ILL-60 to ILL-76; only approved case study fields in generated images).

Single-ID prompt: implement animation [ID] exactly as specified, reuse tokens and components, tag `data-anim`, register, add to `/dev/motion`, add a reduced-motion test, list what could not be followed. Audit prompt: scan `data-anim`, compare with the registry and this document, report status, reduced-motion fallback, non-transform/opacity animation, and JS size of /i, /sign and public routes; recommend the next 10 IDs.

**Tier 1 (premium baseline, priority 1):** P0; G-01, G-02, G-03, G-05, G-06; G-10, G-11, G-12, G-13; G-15, G-16, G-22, G-27, G-48, G-31, G-39; AI-01, AI-02, AI-03, AI-05, AI-09, AI-10, AI-14; F-04, F-08, F-17, F-24, F-28; C-01, C-02, C-03, C-13, C-24; F-54, F-55, F-56; S-02, S-03, S-16, S-17; M-01 to M-05 and ILL-04 to ILL-13.

**Tier 2 (depth):** AI-04, AI-06, AI-07, AI-08, F-14, F-15; F-20 to F-23, F-25, G-23, G-37, G-38; F-26, F-27, F-29, F-30, C-11 to C-15; F-34, F-41, F-43, F-44, G-29, G-30; C-17, C-18, C-22, G-33; S-01, S-04, S-06, S-07, S-08, S-09, S-10, S-13; M-06 to M-10 and ILL-14 to ILL-23; F-57 to F-60.

**Tier 3 (polish):** F-16, G-34, G-35, G-40, G-42; F-33, F-47, F-51; S-19, S-20; optional haptics and sound; ILL-60 to ILL-76.

Done criteria for each animation: implemented to the spec and tagged with `data-anim`; registered and visible in `/dev/motion`; reduced-motion fallback works; animates only transform and opacity; tested on a mid-range phone with no dropped frames; screen reader and keyboard behaviour checked; route JS budgets still met for /i, /sign and public pages.

Rule of restraint: if a screen feels slow or busy after adding animation, remove something. Every motion has a reason.
