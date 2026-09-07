# Olympic FC team hub — design rules

These rules hold across directions. Direction C ("Clean sheet", Sep 2026) supersedes
anything here about a red-gradient header, a maroon-black nav, "two dark surfaces",
page glow or a ScoreboardHero: Direction C has zero gradients and zero dark surfaces
(the toast is the only `#1A1012` fill). Tokens are in `tokens/`.

## Voice and copy
- Sentence case everywhere. AU English. No emoji in UI strings; lucide icons instead.
- First names for kids ("Levi's in for Saturday"). Families as "Levi H.'s family".
- Empty states are calm and true: "Not assigned yet", "No goals yet", "Nothing on this
  day. Enjoy the rest.", "No scorers recorded for this one." Never "—" as a value.
- Toasts say what happened, honestly: "Reminder copied — paste it in the group", not
  "Reminder sent". 2.2 s, then gone.
- Section labels 11/700 `.14em` uppercase muted. Tile labels 10/700 `.1em` uppercase.

## Type
- Anton 400 for numbers and short display words only (scores, shirt numbers, day
  numerals, counts): 56 / 34 / 30 / 26 / 24 / 22 / 20 / 18.
- DM Sans for everything else: 28/800 canvas title · 22/800 sign-in · 20/800 sheet
  titles and player name · 17/800 focus · 15/800 header title and buttons · 14/800 row
  names · 14/400 body · 13 · 12 muted meta · 11/700 section labels · 10/700 tile labels ·
  9/800 `.06em` position tags.
- DM Mono 500 for times, phone numbers and the team code (`.08em` on the code input).

## Position tags and result colours
- GK `#FFF1DA`/`#B3760A` · DEF `#E6F0FF`/`#2563A8` · MID `#E6F6EC`/`#1F8A4C` · FWD
  `#FFE6E6`/`#C0393D`. 9/800, radius 6.
- Win `#1E9E57` · Draw `#9AA3A6` · Loss `#E5484D` · upcoming kick-off in DM Mono amber
  `#F6A623`. Form pips 24 px radius 7 in the same colours.

## MatchRow
Round (Anton 18) + date (9.5 muted) in a 34 px column · home crest 30 px circle + name
(12, two-line clamp) · centre 56 px: score Anton 20 coloured by our result, or kick-off
in DM Mono 12 amber · away crest + name right-aligned. Olympic's side gets the 2 px red
crest ring and 800 weight; the other side 600 muted. Hairline between rows.

## Crests
- Always circular: `border-radius: 50%; object-fit: cover`. Artwork in `public/crests`
  is pre-padded so the circle clips nothing. Never hotlink; `lib/clubs.js` maps a Squadi
  team name to a local file, and an unknown club renders an initials disc.
- Sizes: 84 sign-in · 48 match-ups (2 px red ring on ours) · 30 rows and header · 22
  calendar grid · 18 week strip · 34 initials avatars.
- Club logos are the clubs' property: use them as supplied, never restyled or
  recoloured.

## Cards, sheets, nav
- Cards: white, 1 px `--line`, radius 18, shadow `0 1px 2px rgba(10,30,18,.04)`, stacked
  with a 14 px gap. Tiles `#F4F4F3` radius 14. Icon squares 30–34 px radius 9–11 in a tint.
- Bottom sheet: overlay `rgba(26,16,18,.38)`, white, radius 20 top, grabber 36 × 4
  `--line`, rises 0.26 s `cubic-bezier(.2,.8,.2,1)`, max-height 82 %.
- Nav: five items (Home, Calendar, Results, Squad, Ask), white 96 % + blur, 1 px
  `--line`, radius 20, active pill `#FDEAEC` with red text; hides while a text field has
  focus. Duties, Stats and Settings are pushed sub-screens with a back button.
- Header: white 96 % + blur, hairline below, sticky; kicker hides after 24 px of scroll.
  Hat chip "Viewing as …" opens the Viewing-as sheet (team, hat, Team settings for
  coaches, Sign out).

## Motion
Presses and tabs 0.18 s; sheets 0.26 s `cubic-bezier(.2,.8,.2,1)`; toast fades/rises
0.2 s. No bounces, no decorative loops. Respect `prefers-reduced-motion`.

## Hit targets
Buttons 44–48 px; nav items 48; pills 32–36 inside rows; nothing tappable under 44 px
unless it sits inside a larger tappable row.
