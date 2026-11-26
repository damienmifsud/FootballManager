---
name: olympic-fc-team-hub-design
description: Design system for the Olympic FC team hub (footballmgr.au) — tokens, type, copy rules, component patterns and motion for the parent/coach dashboard in components/Dashboard.jsx, the sign-in pages and the club admin screens. Use when building or restyling any dashboard, sign-in or admin screen, card, sheet, nav or crest.
---

# Olympic FC team hub — design skill

Key facts: the app is `damienmifsud/FootballManager` (Next.js). The UI lives in
`components/Dashboard.jsx`; its `const CSS` block is the stylesheet and its `:root`
holds the tokens. Data helpers are in `lib/dashboardData.js`, roles in
`lib/directory.js` (worn hat via `lib/viewer.js`), MiniRoos facts in
`lib/rulesData.js`, crests in `lib/clubs.js` + `public/crests/`. No Tailwind; lift
values into classes in the CSS block. Icons are `lucide-react`.

> Current build target: `design/handoff-2026-09-direction-c/` (Direction C, Sep 2026).
> Read its `CLAUDE-CODE-BRIEF.md` first, then its `README.md`. They override "The
> refresh" and the dark-chrome rules in this skill's README wherever they differ.

Where the styles live (one design, three stylesheets, same token values):
- `components/Dashboard.jsx` — the dashboard: `const CSS`, tokens on `:root`.
- `components/AuthShell.jsx` — sign-in, My teams and the splash pages: `auth-` classes.
- `components/AdminShell.jsx` — club admin (`/admin`: access manager, team wizard, role table) and the
  league page (`/league`): `adm-` classes, the dashboard's sub-header and cards.

`components/MatchDayPlanner.jsx` is the one screen outside Direction C: a full-screen pitch-side
tool with its own palette, not covered by the handoff.

Files here:
- `README.md` — voice and copy rules, position tags, result colours, MatchRow, crests, motion.
- `tokens/colors.css` — colour tokens with the Direction C delta applied (no gradients, no dark chrome).
- `tokens/spacing.css` — spacing, radii, shadows, type scale.

Build order for Direction C is in the brief (S0 shell prep → S11 crests). Each slice
is its own PR and ends with a review stop.
