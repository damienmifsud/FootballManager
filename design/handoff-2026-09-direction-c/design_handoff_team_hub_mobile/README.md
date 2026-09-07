# Handoff: Olympic FC Team Hub — mobile app (Direction C "Clean sheet")

## Overview
A mobile-first refresh of footballmgr.au — the parent/coach portal for **Olympic FC U8 Kangaroos White** (Coles MiniRoos U8, Brisbane). Parents open it one-handed on a Saturday morning to find the next game, say whether their child is in or out, check who's on fruit / goalkeeper duty, browse results, and ask the team assistant a question. Coaches see everyone's replies and can assign duties.

Target codebase: `damienmifsud/FootballManager` (Next.js; UI lives in `components/Dashboard.jsx`, helpers in `lib/dashboardData.js`, rules in `lib/rulesData.js`). Recreate these screens as the mobile layout of that app using its existing React + CSS-variable setup (`--pitch` etc. at the top of `Dashboard.jsx`). Do not ship the HTML directly.

## About the design files
Everything in this bundle is a **design reference built in HTML** — a working prototype that shows intended look and behaviour. It is not production code. Recreate it in the app's own stack and patterns (React components, server data via `window.storage` shim, Auth.js roles, `/api/ask` for the assistant).

- `Team Hub App.dc.html` — the interactive prototype. Open it in a browser (needs `support.js`, `ios-frame.jsx` and `assets/` beside it). Tweaks: `variant` (sheet | inline | swipe), `role` (parent | coach), `screen`, `openSheet`.
- `Team Hub Options.dc.html` — a canvas with every screen in each of the three interaction models (rows 1a / 1b / 1c).
- `Club Crests.dc.html` — every club crest in the circular treatment, with source URL and target filename per club.
- `assets/crests/` — club crest PNGs (512 px squares).
- `ios-frame.jsx`, `support.js` — prototype scaffolding only (device bezel + template runtime). Ignore for implementation.

## How to start (Claude Code)
1. Read this README fully, then open `Team Hub App.dc.html` in a browser to click through the flows (switch `variant`/`role` via the Tweaks panel or edit the defaults at the top of the logic class).
2. All styling is inline on the elements in the `.dc.html` files — read values straight off the markup; the "Design tokens" section below is the canonical summary.
3. Build order: shell (header, bottom nav, sheet, toast) → Home → Calendar → Results/Match → Squad/Player → Availability → Duties → Stats → Ask → Sign-in.
4. Ship the **1a Sheets** model for parents and **1b Inline** In/Out controls on the coach Availability screen unless told otherwise; the other variants are reference only.
5. Keep the existing data helpers (`lib/dashboardData.js`, `lib/rulesData.js`) and role rules; this is a presentation-layer rebuild.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, copy and states are final. Recreate pixel-close. The only open decision is which **interaction model** to ship (see "Three interaction models"); the recommendation is **1a Sheets** for parents with **1b Inline** controls on the coach's Availability screen.

## Three interaction models (the variation axis)
The same 11 screens exist in all three; only *how a user acts* differs. `variant` prop in the prototype.

| Model | Availability reply | Calendar | Results / Stats | Duties | Ask | Sign-in shown |
|---|---|---|---|---|---|---|
| **1a Sheets** | Tap "Reply" → bottom sheet with big In / Out + optional note | Month grid; tap a day → day sheet | Results and Fixtures stacked as two cards | Tap empty slot → "Take fruit duty?" sheet (coach: assign list) | Tappable question chips | Team code |
| **1b Inline** | In / Out segmented control on the row/card | Agenda list; rows expand in place with the segmented control | Segmented Results / Fixtures (Team / Players) | "I'll do it" button; coach gets inline name chips | FAQ accordion | Email magic link |
| **1c Gestures** | Swipe row right = in, left = out (green / red reveal, 70 px threshold) | Horizontal week strip (scroll-snap); swipe rows to reply | Horizontal pager (scroll-snap) with hint text | Swipe empty fruit slot right to take it | Horizontal chip carousel | Google / Microsoft + email |

Shared everywhere: white condensing header with "Viewing as" chip, floating light bottom nav, cards, toasts, hat sheet.

## Roles (from the repo's role matrix)
- **Parent (of Levi H., #6)** — replies only for own child; sees team-wide In/Out counts and names; sees own family contact only; never sees coach notes. Can volunteer for **fruit** duty (not goalkeeper).
- **Coach (Damien)** — replies for anyone; sees all contacts and coach notes; assigns fruit + goalkeeper duties; "Nudge" button (WhatsApp green) for non-repliers; "Edit" affordance on fixtures.
- Header chip "Parent of Levi" / "Coach" opens the **Viewing as** sheet (hat switcher + Sign out). Shown only when the account holds both hats.

## Device & layout
- Designed at **402 × 874** (iPhone 16/17 Pro logical size) inside the iOS bezel; content column is fluid — use `max-width: 560px` centred on wider screens (existing app rule).
- Status bar area: 62 px. Header sits under it: `padding: 64px 16px 10px`, white 96% + `backdrop-filter: blur(10px)`, 1 px hairline bottom, sticky. Condenses after 24 px scroll (kicker line hides).
- Page background `#F4F4F3`. Content padding `14px 16px 130px` (bottom clearance for the nav). Cards stacked with `gap: 14px`.
- Bottom nav: absolute, `left/right: 14px; bottom: 30px`, white 96% + blur, 1 px `#E7E3E3`, radius 20, shadow `0 10px 30px rgba(26,16,18,.14)`, 5 items (Home, Calendar, Results, Squad, Ask), each `min-height: 48px`, icon 18 + 10 px uppercase label. Active = `#FDEAEC` pill, `#C8102E` text. Hides (`translateY(160px)`, 0.26 s) while a text field is focused.
- Bottom sheet: overlay `rgba(26,16,18,.38)`; sheet white, radius `20px 20px 0 0`, `padding: 10px 16px 44px`, grabber 36 × 4 `#E7E3E3`, rises 0.26 s `cubic-bezier(.2,.8,.2,1)`, max-height 82%.
- Toast: `#1A1012` pill, white 13/700 text, 108 px above the bottom, 2.2 s.

## Screens

### 1. Sign-in
Centered crest 84 px, "Olympic FC U8 / Kangaroos White" 22/800, "Sign in to see your team" 14 muted. One card (radius 18) with the variant's form. Inputs: 48 px tall, `#F4F4F3` fill, 1 px `#E7E3E3`, radius 11; team-code input uses DM Mono with `.08em` tracking. Primary button: `#C8102E`, white 15/800, radius 13, 48 px. Footer "Kangaroos K1 Central Hub · footballmgr.au" 12 muted. Success → Home + **Viewing as** sheet.

### 2. Home
1. **Next game card** — label "NEXT GAME · ROUND 7 · HOME" (11/700, `.14em`, `#C8102E`), countdown "1d 23h" right (12/600 muted, clock icon). 3-column matchup: our crest 48 px circle with 2 px red ring + name 12/800; centre kick-off "08:00" in Anton 30 red + "SAT 13 JUNE" 10/700 `.08em` muted; opponent crest 48 (no ring) + name 12/600 muted. Hairline; venue row (pin icon, 12 muted, ellipsis) + "Details" soft pill (`#F1EDEE`, 12/800). Then the **reply row** for Levi (parent) or the counts pills + "Who's in" link (coach).
2. **Duties card** (whole card is a button → Duties): two halves split by a 1 px divider — tinted icon square 30 px radius 9 (fruit: `#FFF1DA`/`#B3760A` apple icon; goal: `#FDEAEC`/`#C8102E` shield-check), 10 px label, value 12.5/800 (`#6B5A5D` when "Not assigned yet").
3. **Next 7 days** — label + "Calendar ›" link. Rows: day block (9 px DOW + Anton 20 numeral), kind icon square 32 radius 10 (game red tint / training amber tint / birthday pink `#FCE7F3`/`#BE185D`), title 14/800 + meta 12 muted (ellipsis), status pill 11/800 ("Levi's in", "No reply", coach: "5 in · 4 to reply"), chevron `#9AA3A6`. Hairline between rows. Game → Match detail. Training → sheet (1a/1c) or inline expand (1b).
4. **Season so far** — 4 stat tiles (`#F4F4F3` radius 14, Anton 24 + 10 px uppercase label; PTS tile red-tinted with red text), form pips 24 px radius 7 (W `#1E9E57`, D `#9AA3A6`, L `#E5484D`), "13 for · 12 against". "All stats ›" → Stats.
5. **Birthdays coming up** — cake icon squares, "Oliver O. turns 8 / Thu, 18 June", "Levi H. turns 8 / Fri, 24 July".

### 3. Calendar
- Header kicker "June 2026". Card per model (grid / none / week strip), then the **list card** ("Coming up in June" / "June · tap a row to reply" / selected-day title) using the same event rows as Home, then **Add to your calendar** card ("Subscribe once and it stays in sync when a game moves — better than importing.") with Google / Apple / Outlook soft buttons → the app's `/api/calendar?key=` subscribe URL.
- Month grid (1a): Mon-first, 7 columns, cells 54 px, radius 10; today `#FDEAEC`/red text; selected `#C8102E`/white. Game days show the **opponent's circular crest 22 px**; training = amber dot 6 px; birthday = pink dot. Legend row under the grid. ‹ › month buttons 36 px soft.
- Week strip (1c): three 7-day pages in a scroll-snap row; chips 66 px tall, radius 14, white with hairline; DOW 9 px, Anton 18 numeral, crest 18 px or dot.
- Data for June 2026: training Mon + Thu 16:30 JF O'Grady; games Sat 6 (R6 away Ripley Valley, 7–0), 13 (R7 home Oxley United), 20 (R8 away Olympic Red), 27 (R9 home Lions Blue); Oliver O.'s birthday Thu 18.

### 4. Results
- Compact **Season so far** card (form pips + "1–2–2 / W · D · L" Anton 22).
- **MatchRow**: round (Anton 18) + date (9.5 muted) in a 34 px column · home crest 30 px circle + name (12, 2-line clamp) · centre 56 px: score Anton 20 coloured by our result (win green / loss red / draw grey) or kick-off in DM Mono 12 amber `#F6A623` · away crest + name right-aligned. Olympic's side gets the 2 px red crest ring and 800 weight; the other side 600 muted. Hairline between rows.
- 1a: "Results" card then "Fixtures" card. 1b: segmented control (`#E7E3E3` track radius 13, white active thumb radius 11 with `0 1px 2px rgba(10,30,18,.08)`), rows expand to show scorers + venue + "Match details ›". 1c: two cards as a horizontal snap pager + "Swipe left for fixtures".
- Footnote (12 muted): "MiniRoos doesn't publish ladders at U8 — results only help grade the leagues. These are just our own numbers."

### 5. Match detail (header "Round 7", kicker "vs Oxley United · Sat, 13 June")
Hero card as Home but with score/time in Anton 34 (played: score coloured by result + "Win/Loss/Draw"; upcoming: red time + date), venue row with **Directions** pill (Google Maps search URL), kit + arrival pills ("Red kit", "Arrive 07:30" = kick-off − 30 min). Then: Goals list (played, tap → player), Match video card (YouTube link, video icon), **Who's in** card (counts text, Levi's reply row for parents, "See everyone's replies" button), Duties card for the round, **This week's focus** card ("Spread out and find space" 17/800, "One thing for the kids to think about on Saturday — Coach Damien"). Later rounds show "Replies open the week of the game." Coach sees an "Edit" text button top-right.

### 6. Squad (kicker "10 players · 2 coaches")
Players card rows: shirt number Anton 20 red (30 px col), name 14/800 + position tag (9/800, radius 6, GK `#FFF1DA`/`#B3760A`, DEF `#E6F0FF`/`#2563A8`, MID `#E6F6EC`/`#1F8A4C`, FWD `#FFE6E6`/`#C0393D`), goals text 12 muted, right: reply control (coach: every row; parent: own child only), chevron. Tap → Player (1a/1c) or inline expand with segmented + "Full profile" (1b). Coaches card: Damien (Head coach, red avatar) and Cameron (Assistant coach) with **WhatsApp** buttons — the only place `#25D366` is used.

### 7. Player profile
Card: shirt number Anton 56 red, name 20/800, position tag + "Turns 8 on Fri, 24 July". Three tiles: Goals / Games / In goal (Anton 26). Reply card for Round 7 (if the viewer may reply for this player). **Family** card (family names 14/800, phone in DM Mono 13, WhatsApp button) only for the coach or the child's own parent; otherwise the line "Contact details are only shown to the family and the coaches." **Coach notes** card (badge "Coaches only") for coaches.

### 8. Availability — "Who's in" (kicker: event + date/time)
Segmented "Sat · Game / Thu · Training" (separate reply sets per event). Three count tiles: In (`#E6F6EC`/`#1F8A4C`), Out (`#FDEAEC`/`#C0393D`), No reply (white). List card sorted in → out → no reply: initials avatar 34 px `#F1EDEE`, name + position tag, hint line, right control per model; the viewer's own child row has a `#FFF7F8` background. Coach: **Nudge the N who haven't replied** (WhatsApp green, full width) → toast "Reminder sent to N families". Parent footnote: "You can reply for Levi. Coaches can reply for anyone."

### 9. Duties
Intro: "Two jobs each week: a family brings half-time fruit, and one player takes a turn in goal." One card per round R5–R10 (past rounds at 50% opacity): "R7 · vs Oxley United · Sat, 13 June", then two slots (Fruit duty / In goal) each with icon square, 10 px label, value 14/800 or "Not assigned yet" (muted), hint text ("Tap to volunteer" / "Tap to assign" / "Swipe right to take it"). Parent claim → "Levi H.'s family"; coach picks from families (fruit) or players (goal). Toast "Levi H.'s family on fruit for Round 7".

### 10. Stats
Five tiles (Played, Won green, Drew grey, Lost red, Pts red-tinted), For / Against / Diff card with form pips, **Goals by round** chart (two bars per round: For `#1A1012`, Against `#D9D3D4`, 9 px per goal, 66 px tall; score under each in the result colour; tap → match), **Top scorers** card (shirt number, name + tag, red progress bar relative to top scorer, "4 goals"). 1b segmented Team / Players; 1c pager.

### 11. Ask
Intro card (sparkles icon in red-tint square): "Ask about fixtures, training, duties or the MiniRoos rules." / "It answers from our documents and schedule. It won't make up rules." Question chips (four canned questions) per model. Thread: user bubbles `#C8102E` white 14 (radius 16/16/4/16, right-aligned, max 85%), assistant bubbles white with hairline (radius 16/16/16/4, max 92%) + "From: Team schedule" source line (11/600 muted). "Checking the team's documents…" typing bubble. Sticky input bar (46 px pill input + 46 px red send circle) 104 px above the bottom, drops to 0 when the keyboard is up and the nav hides. Canned answers for the four chips; free text goes to the assistant API (`/api/ask`) with the fixtures, training, duties, squad, focuses and MiniRoos format as context; fallback copy: "That isn't covered by the team's documents or schedule, so I won't guess. Try fixtures, training, duties or the MiniRoos rules — or message Coach Damien."

## Interactions & behaviour
- Navigation: 5 root tabs; sub-screens (Match, Player, Who's in, Duties, Stats) push onto a stack; back button (36 px soft square, chevron-left) pops. Tab tap resets to the root and scrolls to top.
- Reply toggles: choosing the already-selected value clears it. Toast copy: "Levi's in for Saturday" / "Levi's out for training" / "Levi's reply cleared".
- Swipe (1c): pointer-drag with `touch-action: pan-y`; row translates with the finger (clamped ±120 px); background reveals green (right) / red (left) with "In" / "Out" labels once |dx| > 8; commit at |dx| > 70; snap back with 0.18 s ease. A completed swipe suppresses the row's tap for 350 ms.
- Motion: presses/tabs 0.18 s; sheets rise 0.26 s `cubic-bezier(.2,.8,.2,1)`; toast fades/rises 0.2 s. No bounces or decorative loops.
- Header condenses (kicker hides) after 24 px scroll; nav hides while typing.
- Empty states are calm and true: "Not assigned yet", "No goals yet", "Nothing on this day. Enjoy the rest.", "No scorers recorded for this one."

## State management
- `screen`, `tab`, `nav[]` (back stack), `role` (`parent` | `coach`), `variant`.
- `avail: { [eventKey]: { [playerId]: 'in' | 'out' | null } }` — keys `g7`, `tr11`, … (one set per game/training occurrence). Counts derived: in / out / none (10 players).
- `duties: { [round]: { fruit: string|null, gk: string|null } }`.
- `matchRound`, `playerId`, `calDay`, expanded-row keys (`weekOpen`, `calOpen`, `squadOpen`, `resOpen`), `resTab`, `stTab`, `faqOpen`.
- `sheet: null | { type: 'reply' | 'event' | 'day' | 'duty' | 'hat', … }`, `note`, `toast`, `kb`, `condensed`, `swipe: { key, x0, dx, drag }`.
- Ask: `thread[]`, `input`, `asking`.
- Data sources in the app: fixtures/players/sessions from the team record; `computeStats`, `nextFixture`, `countdown`, `monthItems`, `upcomingItems`, `nextBirthdays` from `lib/dashboardData.js`; roles from `lib/directory.js`; MiniRoos facts from `lib/rulesData.js`.

## Design tokens
Colours: `--pitch #C8102E` · `--pitch-d #7A0A1B` · ink `#1A1012` · muted `#6B5A5D` · paper `#F4F4F3` · card `#FFFFFF` · soft `#F1EDEE` · line `#E7E3E3` · win `#1E9E57` · loss/danger `#E5484D` · draw `#9AA3A6` · amber `#F6A623` · WhatsApp `#25D366` (WhatsApp actions only). Tints: red `#FDEAEC`, amber `#FFF1DA`, green `#E6F6EC`, blue `#E6F0FF`, pink `#FCE7F3`. Strong-on-tint text: red `#C0393D`, amber `#B3760A`, green `#1F8A4C`, blue `#2563A8`, pink `#BE185D`. Chart against `#D9D3D4`. Own-child row `#FFF7F8`.

Type: **Anton** 400 for numbers and short display words only (scores, shirt numbers, day numerals, counts): 56 / 34 / 30 / 26 / 24 / 22 / 20 / 18. **DM Sans** for everything else: 28/800 canvas title, 22/800 sign-in, 20/800 sheet titles & player name, 17/800 focus, 15/800 header title & buttons, 14/800 row names, 14/400 body, 13, 12 muted meta, 11/700 `.14em` uppercase section labels, 10/700 `.1em` uppercase tile labels, 9/800 `.06em` position tags. **DM Mono** 500 for times, phone numbers, team code.

Spacing: 4 · 8 · 12 · 14 (card gap) · 16 (gutter) · 20 · 24. Hit targets ≥ 44 px (buttons 44–48; nav items 48; pills 32–36 inside rows).

Radii: sheet/nav 20 · card 18 · card-sm 16 · tile 14 · button/input-lg 13 · segmented 12–13 (thumb 10–11) · input 11 · icon square 9–11 · tag 6 · pill 999 · avatar/crest 50%.

Shadows: card `0 1px 2px rgba(10,30,18,.04)` + 1 px `#E7E3E3` border · nav `0 10px 30px rgba(26,16,18,.14)` · sheet `0 -10px 30px rgba(26,16,18,.18)` · toast `0 10px 30px rgba(20,6,10,.3)` · our crest ring `0 0 0 2px #C8102E`.

## Assets
- `Olympic FC crest — the round club-site logo (see registry), rendered as a 30 × 31 contain image in the header, 48 px circular cover with 2 px red ring in match-ups, 30 px circles in rows.
- `assets/crests/*.png` — opponent crests (oxley-united, springfield-united, mfc-kangaroos = Moggill FC, lions-fc, eastern-suburbs, gold-coast-united are 512 px squares built from club artwork; ripley-valley, olympic-red, st-george are Squadi exports kept as fallbacks; springfield-strikers shares springfield-united.png). Always circular (`object-fit: cover; border-radius: 50%`); square artwork is padded on its own background colour so nothing important is cropped by the circle.
- **Club crest registry** — `clubs` in the app's static data (and `Club Crests.dc.html` for a visual check). `crest` is either club artwork already saved as `assets/crests/<key>.png` (512 px squares built from files the club supplied) or the logo on the club's own website, hotlinked in the prototype with `fallback` to a local file. For production, download the hotlinked ones into `assets/crests/<key>.png` (square, ≥256 px) and drop the hotlinks:
  - `olympic-fc` (also `olympic-red`) — https://olympicfc.com.au/wp-content/uploads/2024/01/ROUND-GRADIENT-OFC-LOGO.png
  - `lions-fc` (also `lions-orange`, `lions-blue`) — in project (club artwork; 167 px source — ask the club for hi-res)
  - `ripley-valley` — https://ripleyvalleyfc.majestri.com.au/hosted/org/298/imgs/34739.png
  - `st-george` — https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/render/image/public/base44-prod/public/69660e08604b119239ee5cb3/dcdb07343_StGeorgeFCLogoOUT.png (stgwfc.com)
  - `rochedale-rovers` — https://rochedalerovers.majestri.com.au/hosted/org/110/imgs/55815.png
  - `logan-lightning` — https://www.loganlightningfc.com/hosted/org/149/imgs/8328.png
  - `eastern-suburbs` — in project (club-supplied tiger badge on white)
  - `moreton-city-excelsior` — https://static.wixstatic.com/media/300462_1934b5844e654d2c86f292ac91547746~mv2.png
  - `brisbane-city` — https://brisbanecityfc.com.au/wp-content/uploads/2021/08/BCFC-logo-150px.png (150 px; ask the club for hi-res)
  - `gold-coast-knights` — https://gcknights.com.au/wp-content/uploads/2024/10/GCK-Logo-2024-2-stars.png
  - `wynnum-wolves` — https://wynnumwolvesfc.com.au/wp-content/uploads/2024/11/Wolves-LogoRGB.png
  - `oxley-united`, `springfield-united`, `gold-coast-united`, `mfc-kangaroos` (Moggill FC) — in project (club artwork)
  - `springfield-strikers` — same club as Springfield United; uses `springfield-united.png`.
  Rendering: square/round logos use `object-fit: cover`; portrait shields (`fit: 'contain'` in the registry) sit in a white circle rather than being cropped. Every crest `<img>` has an `onError` fallback to the local file. Club logos are the clubs' property — use is fine inside a team app, don't restyle or recolour them.
- Icons: **Lucide** (stroke 2, round caps, `currentColor`): home, calendar, trophy, users, sparkles, clock, map-pin, navigation, chevron-left/right/down, check, x, apple, shield-check, clipboard-list, cake, message-circle (WhatsApp actions), video, pencil, log-out, send. Sizes 12 inline · 15–18 rows/nav · 18 feature.
- Fonts from Google Fonts: Anton; DM Sans (opsz 9..40, 400/500/700/800); DM Mono 500.

## Files
- `Team Hub App.dc.html` — full prototype (template + logic in one file; all styles inline so values can be read straight off the elements).
- `Team Hub Options.dc.html` — canvas of all screens × three interaction models.
- `assets/` — crests. `ios-frame.jsx`, `support.js` — prototype scaffolding only.
