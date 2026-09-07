# Direction C handoff → footballmgr.au — Claude Code build brief

**Written 7 Sep 2026.** Entry point for any Claude Code session building from the Claude Design bundle `design_handoff_team_hub_mobile/` (Direction C "Clean sheet", 11 screens × 3 interaction models). Read this first, then the bundle's `README.md`. **Where the two disagree, this brief wins** — it knows the repo; the bundle does not.

Target repo: `damienmifsud/FootballManager` (Next.js). UI lives in `components/Dashboard.jsx` (its `const CSS` block is the stylesheet), data helpers in `lib/dashboardData.js`, roles in `lib/directory.js`, MiniRoos facts in `lib/rulesData.js`. Storage is Upstash Redis behind API routes; auth is Auth.js.

---

## 1. What is in the bundle (16 files, 1.2 MB)

| File | What | Use it for |
|---|---|---|
| `README.md` (21.7 KB) | Canonical spec: screens §1–11, behaviour, state, tokens, assets | The spec. Read fully. |
| `Team Hub App.dc.html` (151 KB) | Interactive prototype: markup with **inline styles** (lines 1–805) + logic class (lines 807–1173) | Values and behaviour. See §5 for the line map. |
| `Team Hub Options.dc.html` (14 KB) | Canvas of all screens in models 1a / 1b / 1c | Only if a variant question comes up |
| `Club Crests.dc.html` (17 KB) | Visual crest registry | Not needed for code |
| `assets/crests/*.png` (9) | 6 club crests at 512 px; 3 Squadi fallbacks at 128 px (`olympic-red`, `ripley-valley`, `st-george`) | Copy to the app's static assets (S0); replace the 128 px ones (S11) |
| `support.js`, `ios-frame.jsx` | Prototype runtime + iPhone bezel | **Ignore.** |

The `.dc.html` files are Claude Design's template DSL (`<sc-if>`, `<sc-for>`, `{{ }}`). They only run in a browser with `support.js`. Claude Code reads them; it cannot click through them. Damien does the click-through.

---

## 2. Overrides — where the bundle is wrong or blind about this repo

1. **Persistence.** The README says "server data via `window.storage` shim". Wrong. The app persists through API routes + Upstash Redis. **Every new write** (training replies, duty claims, duty assignment, hat preference) gets **its own narrow API route and its own Redis key**, mirroring the existing RSVP route. **Never call `clientStorage.set()` for partial data** — `clientStorage.js` ignores its key argument: `get()` returns the whole team document and `set()` overwrites all of it.
2. **Safe areas.** The prototype renders inside an iPhone bezel, so its offsets include a 62 px status bar and home-indicator allowance: header `padding-top: 64px`, nav `bottom: 30px`, toast `bottom: 108px`, Ask bar `bottom: 104px`, content `padding-bottom: 130px`. Do not copy these literally. Keep the safe-area mechanism `Dashboard.jsx` already uses for its sticky header and floating nav, and express the new offsets relative to it: nav top edge = nav bottom offset + 62 (48 item + 6×2 padding + 1×2 border); toast sits +16 above nav top, Ask bar +12, content clearance +38. Re-derive `--nav-clearance` from that, not from "130".
3. **Stack.** React + the `const CSS` block with CSS variables. No Tailwind. The bundle's inline styles are *values to read*, not a pattern to copy — lift them into classes in the CSS block. `max-width: 560px` centred column stays (existing rule; the prototype is fluid at 402 px).
4. **Icons.** `lucide-react` is already a dependency; use it. Six icons are new to the app's current set: `Navigation`, `ChevronDown`, `MessageCircle`, `Video`, `Pencil`, `LogOut`. Stroke 2, round caps, `currentColor`. Sizes 12 inline · 15–18 rows/nav · 18 feature.
5. **Fonts.** Add **DM Sans 800** to the Google Fonts link (the prototype uses `font-weight:800` in 137 places). Full set: Anton 400; DM Sans opsz 9..40 at 400/500/700/800; DM Mono 500.
6. **Design-skill precedence.** The design skill at `.claude/skills/olympic-fc-team-hub-design/` predates Direction C. Its README rules for a *red-gradient header*, *maroon-black nav*, *"two dark surfaces"*, *page glow* and *ScoreboardHero* are **superseded**. Direction C has zero gradients and zero dark surfaces (the toast is the only `#1A1012` fill). Everything else in the skill (voice, copy rules, position tags, result colours, MatchRow layout, circular crests, motion) still holds. Token delta in §4.
7. **Match day / GameDay / Settings are absent from the bundle.** The in-flight GameDay slice 1 (data contract, "Match day" hub card on the fixture, Settings cards) has no home in these 11 screens. Decisions D2 and D3 below fix that — do not build Match detail (S3) until D2 is answered.
8. **Sample data.** Everything in `Component.D` (players, fixtures, June 2026 calendar, `me: 6`, `duties` seeded for R5–R6) is prototype sample data. Use the app's team record and the helpers named in README §State management (`computeStats`, `nextFixture`, `countdown`, `monthItems`, `upcomingItems`, `nextBirthdays`).
9. **Ask.** The app's `/api/ask` and its loaded documents are the source of truth. The prototype's `prompt()` (lines 1094–1110) is a reference for tone and format only (under 60 words, sentence case, no markdown, never invent rules). Keep the canned-chip pattern; keep the fallback copy verbatim from README §11.
10. **Crests.** The prototype hotlinks 8 opponent crests plus the Olympic crest from club websites. **Never hotlink in production.** A complete rebuilt set is supplied alongside this brief (`crests-512.zip`): all 15 club files at 512 px (19 registry keys incl. aliases), one consistent circle-safe treatment (round badges fill edge-to-edge; square/shield artwork padded on its own background so the circular crop clips nothing), plus `clubs-registry.js` with every key pointing at a local file — no `fit`, no `fallback`, no `http`. Keep a null-guard in `crestEl` (initials disc) for any club added later without artwork.

---

## 3. Decisions

### Locked (do not reopen)
- Direction C "Clean sheet" is the direction. High-fidelity: colours, type, spacing, radii, copy and states are final. Recreate pixel-close.
- Refresh, not rebrand: keep the red, cards, colour-coded position tags, result colours, home-crest · score · away-crest MatchRow with Olympic's side ringed and 800-weight.
- 5-item nav (Home, Calendar, Results, Squad, Ask); Duties and Stats are pushed sub-screens.
- No-reply players stay in the planner's Suggest/auto-fill with a red-dot indicator (7 Sep). Parent visibility is set per team at setup; the match record is coach-only (7 Sep).

### Open — each has a default hypothesis. Build to the default unless Damien overrides.

| # | Decision | Default hypothesis | Blocks |
|---|---|---|---|
| D1 | Interaction model | **1a Sheets** for parents; **1b Inline** In/Out segmented on the coach's Availability screen (the bundle's recommendation). 1c Gestures is reference only. | S2 onward |
| D2 | Where the GameDay "Match day" card lives | Coach-only card on Match detail, directly under the Duties card, using the Duties-card pattern: `ClipboardList` in a red-tint icon square, label MATCH DAY, value "Plan not started" / "Lineup set · 4 blocks", chevron. Tap → the full-screen planner takeover. Parents never see it. | S3 |
| D3 | Where Settings lives in the 5-tab IA | A "Team settings" row in the **Viewing as** sheet (coach only), above Sign out. Opens the existing SettingsTab restyled as stacked cards; GameDay slice-1 Settings cards land there. | S1 sheet |
| D4 | GK write-back (open since before this handoff) | The Duties "In goal" value for a round and the planner's GK slot in block 1 are **one field**. Assigning in Duties pre-fills the planner; changing the planner's block-1 GK updates Duties. | S7 |
| D5 | Training replies (`tr11`-style keys are new in this design) | In scope only if the app already stores training RSVPs. If not: games-only in this rebuild; hide the Game / Training segmented on Availability and the training reply rows until a training-reply store exists (own route + key, per override 1). | S2, S4, S6 |
| D6 | Duty writes (parent claims fruit; coach assigns fruit and GK) | New route + key, RSVP pattern. Parent can claim **fruit only**, never GK. Coach can clear an assignment (the prototype cannot — add a "Clear" in the assign sheet). | S7 |
| D7 | "Nudge" mechanism | No server-side sending. Copy a ready-to-paste reminder naming the N families and open WhatsApp (`wa.me`/share). Toast: "Reminder copied — paste it in the group" (honest), not "Reminder sent". | S6 |
| D8 | Multi-hat accounts | If `lib/directory.js` cannot express coach + parent on one email, hide the header hat chip and fix the role per account. Build the Viewing-as sheet regardless — Sign out and Team settings (D3) still live there. | S1 |

---

## 4. Token delta — apply to the skill's `tokens/colors.css` + `spacing.css` **and** the `:root` in `Dashboard.jsx`'s CSS block

```css
/* ---- REMOVE (Direction C: no dark chrome, no gradients, no page glow) ---- */
--header-grad, --board-grad, --board-1, --board-2, --board-line, --page-glow
/* --shadow-crest only applied to a crest on red; nothing in Direction C does that */

/* ---- CHANGE ---- */
--nav-bg:        rgba(24,8,12,.95)           → rgba(255,255,255,.96);
--shadow-nav:    0 10px 30px rgba(20,6,10,.4) → 0 10px 30px rgba(26,16,18,.14);
--nav-clearance: 92px                         → re-derive per override 2 (prototype: 130px);
--r-sheet:       22px                         → 20px;
--ev-birthday:   #d6409f                      → #BE185D;
--red-tint:      #fdecec                      → #FDEAEC;   /* one red tint; same as --pitch-tint */

/* ---- ADD ---- */
--card-gap:          14px;
--header-bg:         rgba(255,255,255,.96);  --header-blur: 10px;   /* hairline --line below, sticky */
--nav-blur:          12px;  --nav-inset: 14px;                       /* nav has 1px --line border */
--nav-active-bg:     #FDEAEC;  --nav-active-fg: var(--pitch);  --nav-idle-fg: var(--muted);
--sheet-overlay:     rgba(26,16,18,.38);
--shadow-sheet:      0 -10px 30px rgba(26,16,18,.18);               /* sheet max-height 82%, grabber 36×4 --line */
--toast-bg:          var(--ink);
--shadow-toast:      0 10px 30px rgba(20,6,10,.3);
--crest-ring:        0 0 0 2px var(--pitch);                        /* Olympic's side only */
--blue-tint:         #E6F0FF;  --blue-strong:  #2563A8;
--pink-tint:         #FCE7F3;  --pink-strong:  #BE185D;
--red-strong:        #C0393D;  --amber-strong: #B3760A;  --green-strong: #1F8A4C;
--chart-against:     #D9D3D4;                                        /* Stats bars: For = --ink, Against = this */
--row-mine:          #FFF7F8;                                        /* viewer's own child row */
--seg-track:         var(--line);  --seg-thumb-shadow: 0 1px 2px rgba(10,30,18,.08);
--r-seg:             13px;  --r-seg-thumb: 11px;  --r-icon-sm: 9px;
```

Type additions (DM Sans unless stated): Anton sizes used are 56 / 34 / 30 / 26 / 24 / 22 / 20 / 18 (numbers and short display words only, weight 400). DM Sans: 28/800 canvas title · 22/800 sign-in · 20/800 sheet titles and player name · 17/800 focus · 15/800 header title and buttons · 14/800 row names · 14/400 body · 13 · 12 muted meta · 11/700 `.14em` uppercase section labels · 10/700 `.1em` uppercase tile labels · 9/800 `.06em` position tags. DM Mono 500 for times, phones, team code (`.08em` tracking on the code input).

Crest sizes: 84 sign-in · 48 match-ups (2 px red ring on ours) · 30 rows and header (header is `object-fit: contain`, 30×31) · 22 calendar grid · 18 week strip · 34 initials avatars. Always `border-radius: 50%; object-fit: cover`; portrait shields (`fit: 'contain'` in the registry) sit on a white circle. Every crest `<img>` has an `onError` fallback to the local file.

---

## 5. How to read the prototype (line map for `Team Hub App.dc.html`)

Each element is one long line, so `sed -n a,bp | cut -c1-600` and `grep -n` work well. Styles are inline — values are read straight off the element.

| Region | Lines | Notes |
|---|---|---|
| Header (root + sub variants, hat chip, condense) | 30–51 | `notCondensed` hides the kicker after 24 px scroll |
| Home | 52–180 | Next game, Duties, Next 7 days, Season so far, Birthdays |
| Calendar | 181–275 | Month grid (1a) / agenda (1b) / week strip (1c), list card, Subscribe card |
| Results | 276–330 | `matchRow()` values |
| Squad | 331–375 | Players card + Coaches card (only WhatsApp-green use) |
| Player | 376–426 | Family card visibility, Coach notes badge |
| Match detail | 427–502 | Hero, Goals, Video, Who's in, Duties, Focus, Edit |
| Availability | 503–537 | Segmented, three count tiles, sorted list, Nudge |
| Duties | 538–566 | One card per round R5–R10, past rounds at 50 % |
| Stats | 567–624 | Five tiles, For/Against/Diff, Goals-by-round bars, Top scorers |
| Ask | 625–662 | Chips, thread bubbles, sticky input bar |
| Sign-in | 663–697 | Team-code (1a) / magic link (1b) / SSO (1c) |
| Bottom nav | 698–706 | 5 items, `navShift` hides while typing |
| Toast | 707–710 | |
| Sheets (reply · event · day · duty · hat) | 711–805 | |
| **Logic class** | 807–1173 | `D` = data + `clubs` registry (810–869; `clubs` at 814) · `state` (871–876) · `replyRow` (937) · `eventRow` (971) · `calCells`/`weeks` (994–1011) · `matchRow`/`matchVals` (1012–1032) · `stats`/`rounds`/`scorers` (1033–1040) · `squadRows`/`playerVals` (1041–1054) · `dutyRows`/`slot` (1055–1077) · `sheetVals` (1078–1093) · `prompt`/`ask` (1094–1120) · `renderVals` (1121–1171) |

Screen gating in markup: `<sc-if value="{{ s.home }}">` etc. Role gating: `isCoach` / `isParent`. Variant gating: `isA` / `isB` / `isC`.

---

## 6. Build slices (in order; each ends with a review stop)

| Slice | Scope | Done when |
|---|---|---|
| **S0 Repo prep** | Bundle + this brief committed under `design/`; skill committed under `.claude/skills/` with the §4 delta applied and a SKILL.md pointer to this handoff; the 16 PNGs from `crests-512.zip` in the app's static crest folder (replacing the bundle's 9); DM Sans 800 in the font link. | `git ls-files design/handoff-2026-09-direction-c` = 17; skill dir exists; fonts link updated. No UI change yet. |
| **S1 Shell** | `:root` tokens; white condensing header (root + sub variants, back button, hat chip → Viewing-as sheet incl. Team settings per D3 and Sign out); light 5-item nav (active pill, hide on input focus); bottom sheet + overlay + grabber; toast; push/pop back stack; content clearance. Existing screens render inside the new chrome **unchanged**. | Every current tab opens under the new chrome; nav hides when the Ask input is focused; no `--header-grad`, `--nav-bg` dark or `--page-glow` left in the CSS block. |
| **S2 Home** (README §2) | Next game card (countdown, 3-column match-up, venue + Details, reply row / coach counts), Duties card, Next 7 days, Season so far, Birthdays. | Renders from real helpers; parent sees Levi-style own-child reply row, coach sees counts + Who's in. Needs D1, D5. |
| **S3 Results + Match detail** (§4, §5) | MatchRow, compact Season card, footnote; Match hero, Goals, Video, Who's in, Duties, This week's focus, coach Edit, **Match day card per D2**. | Played / upcoming both render; result colouring correct; Match day card coach-only. |
| **S4 Calendar** (§3) | Month grid with opponent crests at 22 px, category dots, legend, list card, Subscribe card → existing `/api/calendar?key=`. | Today / selected states correct; day tap → day sheet. |
| **S5 Squad + Player** (§6, §7) | Position tags, goals text, reply control visibility (coach: all; parent: own child), Coaches card with WhatsApp; Player tiles, Family card visibility, Coach notes badge. | Contact visibility matches `lib/directory.js`; "Contact details are only shown to the family and the coaches." line for other parents. |
| **S6 Availability** (§8) | Game / Training segmented (D5), three count tiles, list sorted in → out → no reply, own-child row tint, Nudge (D7), parent footnote. | Counts derive from the same store Home uses; Nudge does what D7 says. |
| **S7 Duties** (§9) | One card per round, two slots, past rounds faded, parent fruit claim + coach assign (D6), GK field shared with planner (D4). | Writes go through their own route + key; toast copy per README. |
| **S8 Stats** (§10) | Five tiles, For/Against/Diff + form pips, Goals-by-round bars (9 px per goal, 66 px tall), Top scorers with progress bars. | Bars tap → match; scorer rows tap → player. |
| **S9 Ask** (§11) | Intro card, chips, thread bubbles + source line, typing bubble, sticky input bar above the nav (drops to 0 with keyboard, nav hides). Existing `/api/ask`. | Canned chips answer instantly; free text hits the API; fallback copy verbatim. |
| **S10 Sign-in** (§1) | Existing Auth.js flow restyled (card, inputs, primary button, footer); success → Home + Viewing-as sheet when the account has two hats (D8). | Sign-in works end to end; hat sheet only when applicable. |
| **S11 Crest registry** | Drop the 16 PNGs from `crests-512.zip` into the static crest folder; replace the `clubs` array with `clubs-registry.js` (19 keys, all local, no `fit`, no `fallback`); add a null-guard to `crestEl` that renders an initials disc; delete the bundle's three 128 px Squadi thumbnails. | No `http` crest URL anywhere in the app; every key resolves to a 512 px local file. |

Ship note: S1 changes the chrome on every screen at once, so it is the first visible change parents see. Deploy S1 mid-week, not on a Friday; the existing screens under the new chrome are functionally unchanged, so rollback is one revert.

---

## 7. Repo layout for the S0 commit

```
design/
  handoff-2026-09-direction-c/
    CLAUDE-CODE-BRIEF.md                 ← this file
    design_handoff_team_hub_mobile/      ← the zip, extracted, unchanged (16 files)
.claude/skills/olympic-fc-team-hub-design/
    SKILL.md                             ← add the pointer line below
    README.md, tokens/, components/, …   ← §4 delta applied to tokens/colors.css + spacing.css
<static crest folder>/                   ← confirm the app's path first (Next.js: usually public/)
    16 PNGs from crests-512.zip (15 clubs + olympic-red alias) — complete
```

Line to add to SKILL.md (after the "Key facts" paragraph):

> Current build target: `design/handoff-2026-09-direction-c/` (Direction C, Sep 2026). Read its `CLAUDE-CODE-BRIEF.md` first, then its `README.md`. They override "The refresh" and the dark-chrome rules in this skill's README wherever they differ.

---

## 8. Kickoff prompt (paste into Claude Code after the S0 commit)

```
Read design/handoff-2026-09-direction-c/CLAUDE-CODE-BRIEF.md in full, then
design/handoff-2026-09-direction-c/design_handoff_team_hub_mobile/README.md,
then lines 807–1173 of "Team Hub App.dc.html" (the logic class). Do not write code yet.

Then inspect the repo directly: the const CSS block and :root in components/Dashboard.jsx,
the current header and nav JSX, how safe areas are handled today, lib/dashboardData.js,
lib/directory.js, the RSVP API route and the Redis key it uses, and whether training
sessions have any RSVP store.

Output, then stop for my review:
1. A mapping table: every prototype data/state item (Component.D.players, .fixtures,
   .clubs, state.avail, state.duties, role, me) → the app's real data and helper, one row
   each, marked "exists" / "new store needed" / "prototype-only".
2. Your answer to each open decision D1–D8 with the repo evidence, using the brief's
   default hypotheses unless the repo contradicts them.
3. The S1 shell plan as a file-by-file change list — no code.
```
