# Team Dashboard — website (Olympic FC red & white)

A hosted version of the team dashboard (fixtures, results, training calendar, duties,
squad, stats, match video) with the things the chat artifact could **not** do:

1. **Server-stored shared data** for everyone on the team.
2. **A live, subscribable calendar feed** that Google Calendar and Outlook/Microsoft 365
   keep in sync automatically.
3. **One shared password** protecting the whole site — or, optionally, account
   login (Google / Microsoft / magic-link) with real roles.

The dashboard UI is reused unchanged in `components/Dashboard.jsx` (only a `"use client";`
line was added). A shim (`lib/clientStorage.js`) gives it a server-backed `window.storage`.
The colour scheme is set with the CSS variables at the top of `components/Dashboard.jsx`
(`--pitch` = Olympic FC red `#C8102E`); tweak there if the club updates its shade.

---

## Access model

The site runs in one of two modes, chosen by whether `AUTH_SECRET` is set.

**Team-code mode (default — `AUTH_SECRET` not set).** One shared code per team
(`SITE_PASSWORD`, or each team's `password` in `TEAMS`) — everyone types the same thing
to get in. There are **no accounts and no roles**: everyone with the code reads and
writes everything. The **Coach PIN** in the in-app Settings only hides the edit controls
behind a PIN in the browser — it is a client-side courtesy toggle, not access control.
Rotate the code any time by changing the env var.

**Account mode (`AUTH_SECRET` set + at least one sign-in provider).** People sign in
with Google, Microsoft or a magic link, and what they can see and do depends on their
role: super admin, club admin, coach, parent or player, with optional per-person overrides. The
full ladder, how each role is assigned and what it can do is in
[Account login and roles](#account-login-and-roles-google--microsoft--magic-link)
below. **Set `ADMIN_EMAILS` before you enable `AUTH_SECRET`** — it is the only way to
reach `/admin`; without it the site has no super admin.

In both modes the **calendar feed** uses its own secret key in the URL (calendar apps
can't send the login cookie), so the feed works without anyone logging in.

---

## Run it locally

Requires Node 20+.

```bash
cp .env.example .env.local      # then edit it
#   SITE_PASSWORD  = the team code
#   CALENDAR_KEY   = a long random string
npm install
npm run dev                     # http://localhost:3000  ->  redirects to /login
```

In local dev (no Upstash configured) data is saved to `.data/team.json`.

---

## Deploy to Vercel

Vercel's filesystem is ephemeral, so production needs a real store — a free **Upstash
Redis** database (1 minute to create).

1. Push this folder to a GitHub repo.
2. In [Upstash](https://upstash.com) create a Redis database → copy its **REST URL** and
   **REST TOKEN**.
3. In [Vercel](https://vercel.com) → New Project → import the repo. Add environment variables:
   - `SITE_PASSWORD` = the team code
   - `CALENDAR_KEY` = a long random string
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from Upstash
4. Deploy, add a custom domain if you like.

First visit: enter the team code, then make any edit so the data is written to the store.

---

## Deploying on Render instead (alternative)

A `render.yaml` blueprint is included. Two caveats vs Vercel: Render's **free** plan
spins the service down after ~15 min idle (30–60s cold start for the first parent to
open it — avoid; use the always-on starter plan), and `vercel.json`'s cron doesn't
apply — schedule the sync with cron-job.org hitting `/api/sync?key=CRON_SECRET` or a
Render Cron Job. Same env vars as Vercel. Upstash Redis works identically from Render.

---

## The live shared calendar

Subscribe URL (note the key):

```
https://YOUR-DOMAIN/api/calendar?key=YOUR_CALENDAR_KEY
```

This always reflects the current schedule — edit a game, and every subscribed calendar
updates on its next refresh.

- **Google Calendar:** Other calendars → **+** → *Subscribe to calendar* → *From URL*.
- **Outlook / Microsoft 365:** *Add calendar* → *Subscribe from web*.
- **Apple Calendar:** *File → New Calendar Subscription*.

Treat the feed URL as semi-private (anyone with the full URL incl. key can read the
schedule). Rotate `CALENDAR_KEY` if it leaks.

---

## Team-code mode vs. account mode

Both are built in; `AUTH_SECRET` picks between them.

| | Team-code mode | Account mode |
|---|---|---|
| Parent effort | type one code | sign in with Google / Microsoft, or click a magic link |
| Roles | none — everyone reads and writes everything | super admin, club admin, coach, parent, player, plus per-person overrides |
| Revoking access | rotate the code (everyone re-enters it) | remove the email from the roster, staff list or `/admin`; or block it with an override |
| Per-parent features | no | yes — bound to their own children for RSVPs, redacted view, "Viewing as" hats |
| Club-wide view | no | yes — club admins see every team, super admins coach every team |
| Setup | 1 env var | `AUTH_SECRET`, one provider's keys, `ADMIN_EMAILS`, emails on player records |

Recommendation: the shared code is enough for a single junior team where everyone is
trusted to edit. Switch to account mode when you need to allow or deny individuals, keep
ratings and coach notes away from parents, or run several teams under one club login.
The switch is one env var and is reversible — until `AUTH_SECRET` is set nothing changes.

---

## League fixtures (Squadi embed)

`/league` embeds the same Squadi widget the FQ website uses, pre-filtered via URL
parameters — the page has a **Set up** panel (saved for everyone on that team) where you
either build the link from filters or paste the full embed URL.

Each team has its own setup. A team that has not saved one shows the season's draw from
the club's set-up when its website link there is the team's Squadi fixtures page (see
"Setting a draw up from its link" below), and "Not configured yet." when there is
neither, rather than anybody else's draw. Above the draw, **Draws** lists every draw the
club's set-up has a link for (the season's, and each other competition's, wherever it
is), each with **Open the draw**. Only the original team falls back to the U8 Kangaroos White draw it
has always shown: the legacy owner (`legacyOwnerSlug` in `lib/store.js`), or the team
whose own Squadi sync IDs are that team's. If another team saved that default under the
old page, those ids are ignored when its setup is read.

The setup is read and saved only through its own narrow route (`/api/league`): coaches
only, it writes just that one key on the team document, it accepts a pasted link only if
it is an `https://` link on `squadi.com`, and it refuses a save from a page that was
opened for a different team. Whole-document saves never change it. The quickest way to
get the link is the panel's **Open the Squadi fixtures page**: choose the filters there
and copy the address bar URL.

Parameters Squadi accepts: `organisationKey` (FQ Metro is prefilled), `yearId`
(**2025 = 7, 2026 = 8**), `competitionUniqueKey` (changes each season), `divisionId`
(the age-group filter — a numeric id, or `All`), and optional `teamId` to pin one team.

**To pin Year 2026 + U8:** U8 is Coles MiniRoos. When FQ publishes the 2026 MiniRoos
draws, open their competitions page, choose the filters, right-click the widget →
Inspect → copy the iframe `src` (or the request URL in the Network tab) — it contains the
2026 `competitionUniqueKey` and the U8 `divisionId`. Paste into the Set up panel once;
every parent then sees the filtered view.

Note: this works on the website only — the chat-artifact sandbox can't iframe Squadi.
---

## "Ask" assistant (Q&A over your PDFs + live game data)

Signed-in parents and coaches get an **Ask** tab. Coaches load reference material
in Settings → Team knowledge (upload a PDF — the text is extracted in the browser —
or paste text). Questions are answered by Claude using ONLY those documents plus a
summary of your fixtures, training, squad and focuses; it's instructed not to invent
rules and to say when something isn't covered.

Requires `ANTHROPIC_API_KEY` (server-side; never sent to the browser). Optional
`ANTHROPIC_MODEL` overrides the model. Without a key the tab shows a friendly
"not configured" message. Document text is capped per request so a large rulebook
can't blow the context; keep it to a few key PDFs (scanned/image-only PDFs won't
extract — use a text PDF or paste the text).

---

## Account login and roles (Google / Microsoft / magic-link)

Set `AUTH_SECRET` to switch the site from team-code mode to account login. Each
provider activates only when its keys are present, so you can start with one. Until
`AUTH_SECRET` is set, nothing changes — the team-code login stays. This is a beta of
Auth.js v5; test on a preview deploy before switching the live site.

### Providers

**Magic-link (easiest first step):** add `AUTH_RESEND_KEY` + `AUTH_EMAIL_FROM`
(Resend account, verified domain). Parents type their email, click the link, done.
Requires the Upstash adapter (already wired) to store the one-time tokens.

**Google:** Google Cloud → Credentials → OAuth client (Web). Redirect URI
`https://YOUR-DOMAIN/api/auth/callback/google`. Set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

**Microsoft:** Entra ID → App registrations. Redirect URI
`https://YOUR-DOMAIN/api/auth/callback/microsoft-entra-id`. Set the three
`AUTH_MICROSOFT_ENTRA_ID_*` vars.

`AUTH_URL` should be your site URL.

### Roles

Roles exist only in account mode. They are resolved from the signed-in email in
`lib/directory.js`, from most to least access:

- **Super admin** — the emails in `ADMIN_EMAILS` (comma-separated, no quotes). A super
  admin has coach access to every team, including teams added later (opened from club
  admin when it is not one of their own: see My teams below), and is the only role
  that can open `/admin`: club access control, the team wizard, league sync, managing
  club admins, setting per-person per-team overrides, and **View as** any user
  (read-only, marked by an orange banner). Super admins are immune to overrides.
  **Set this before enabling `AUTH_SECRET`** — with no `ADMIN_EMAILS` nobody can
  reach `/admin`.
- **Club admin** — the emails in `CLUB_ADMIN_EMAILS`, or added at `/admin`. View-only
  on every team (opened from club admin): reads everything, writes nothing to team
  data. Can open `/admin` to
  create and edit teams in the wizard (not delete them, and no access control). Typical
  use: the club's technical director.
- **Coach** — either listed in the team's `coachEmails` (in the `TEAMS` JSON or set in
  the `/admin` wizard), **or** any row on the team's staff list that has an email.
  Head coach, Assistant coach and Manager are titles shown in the app; the rights are
  the same coach-level access.
- **Parent** — the emails on their child's player record (Majestri import, the wizard
  roster, or the Squad tab). Parents read the team with redactions — no ratings, lineup
  rules, coach notes or other families' contacts, and game plans / match records only
  as far as the coach's **Parents can see** switches allow — and write only their own
  children's RSVPs.
- **Player** — the player's *own* email on their own record (Squad tab, player editor,
  **Player's own email**). A player signs in as themselves and gets exactly what a parent
  gets, for their own record: they read the team with the same redactions and reply for
  themselves. It is meant for adult teams and older players; leave it blank for a young
  player, whose parents reply for them. Someone who plays alongside their child holds one
  role there for both ("Player and parent of Leo"). See
  [Player logins](#player-logins) below.
- **Overrides** (`/admin`) — per email, per team, force coach, parent, viewer or
  blocked. Overrides never apply to super admins. The parent override keeps a player to
  their own record in the same way it keeps a parent to their children.

### Who can do what

The same table is shown on `/admin` (data in `lib/roleMatrix.js`). "Coach" covers
assistant coaches and managers on the staff list too. A player signed in with their own
email is the same column as a parent, for their own record: "Own family" means a
parent's children and, for a player, themselves. The last column is team-code mode,
where there are no accounts.

| Feature | Super admin | Club admin | Coach | Parent or player | Team code |
|---|---|---|---|---|---|
| **See** | | | | | |
| Fixtures, results, calendar, training, duties | Yes | Yes | Yes | Yes | Yes |
| Squad list, positions, photos, goals and assists | Yes | Yes | Yes | Yes | Yes |
| Parents' contact details and family PINs | Yes | No | Yes | Own family | Yes |
| Player ratings and coach notes | Yes | No | Yes | No | Yes |
| Lineup rules and the coach PIN | Yes | No | Yes | No | Yes |
| Game plan before kick-off | Yes | If the coach allows | Yes | If the coach allows | Yes |
| Live lineup and clock on game day | Yes | If the coach allows | Yes | If the coach allows | Yes |
| Match record and minutes played | Yes | If the coach allows | Yes | If the coach allows | Yes |
| Ask the team assistant | Yes | Yes | Yes | Yes | Yes |
| Calendar subscribe link | Yes | Yes | Yes | Yes | Yes |
| **Do** | | | | | |
| Reply In or Out for games and training | Anyone | No | Anyone | Own family | Anyone |
| Duties: fruit, jerseys and the goalkeeper | Yes | No | Yes | Own family | Yes |
| Edit fixtures, scores, squad, staff, team details | Yes | No | Yes | No | Yes |
| Set the game plan and run the live match | Yes | No | Yes | No | Yes |
| Settings: parents can see, match format, home shape, lineup rules | Yes | No | Yes | No | Yes |
| Rate players and write coach notes | Yes | No | Yes | No | Yes |
| Sync fixtures now | Yes | No | Yes | No | Yes |
| Add web pages and PDFs to the assistant's knowledge | Yes | No | Yes | No | Yes |
| League page setup | Yes | No | Yes | No | Yes |
| Switch team or role, sign out | Yes | Yes | Yes | Yes | Yes |
| **Club** | | | | | |
| Open `/admin` | Yes | Yes (wizard and this table) | No | No | Not available |
| Create and edit teams (the wizard) | Yes | Yes | No | No | Not available |
| People: every login and what it is attached to | Yes | No | No | No | Not available |
| Add or remove club admins | Yes | No | No | No | Not available |
| Per-person per-team overrides | Yes | No | No | No | Not available |
| View as any user (read only) | Yes | No | No | No | Not available |

"If the coach allows" follows the team's **Parents can see** switches in Settings. A
coach who is also a parent gets exactly the Parent or player column while wearing the
parent hat.
Every visit still refreshes Squadi and Majestri fixtures quietly for everyone (a draw on
Dribl is refreshed when a coach visits); only the manual "sync now" is coach-level. Duties: coaches assign or clear any duty; parents and players claim fruit or
jersey duty for their own family (never the goalkeeper) and can hand it back. Every duty write goes
through its own narrow route (`/api/duty`), so a claim never touches the rest of the fixture.

### My teams, roles, and running the club

One email can hold more than one role on the same team (a coach whose child plays
there) and be on several teams. There are three levels, and a person can be at any of
them at once:

- **Club**: the super admin and club admins. They create teams and manage access, and
  can open any team when they need to.
- **Team**: the staff (head coach, assistant coach, manager). They run their own team.
- **Squad**: players and their families. A parent replies for their own child, and a
  player with their own login replies for themselves.

**My teams** (`/teams`) lists the teams a person is on *themselves*, each with their
roles there as pills ("Assistant coach", "Parent of Leo", "Player"). Someone on one team
goes straight into it; someone on several lands on My teams and picks.

**Both teams together.** A family on two or more teams (a child in each, or a parent's
own team and their child's) also gets them together on My teams: **Coming up** lists the
next two weeks across those teams by day, each event with its team, and a reply button
for each of the family's own players. A reply is given right there, for whichever team it
belongs to. **Together** or **One team at a time** is the family's choice and is
remembered; the team cards below always open a single team.

- The list is the family's view whatever role the person is otherwise acting in: a coach
  who is also a parent sees their children's events there, not the squad's.
- It carries only what a parent on each team already sees (opponent, date, time, place,
  round) and the family's own replies (`GET /api/family`, `lib/familyWeek.js`).
- A reply from it names its team (`teamSlug` on `/api/rsvp`). A reply that names its
  team is always answered as the parent on that team, and a team the login is not on is
  refused, so naming a team can never do more than the family's own reply could.
- A player left out of a competition's squad, a guest outside their dates and a
  cancelled game are not asked, the same as inside the team.

Running the club is not the same as being on every team in it. A super admin's coach
access to a team they hold no role on, and a club admin's view of it, are **club-level**:
the access is exactly as described above, but those teams are not listed under My teams.
They are opened from **Club admin** (Teams, then Open), which My teams links to. A super
admin who is on a team's staff reads as that role there ("Assistant coach"); "Super
admin" is the label only where they hold no role of their own.

Inside a team, the chip in the header shows the current role. Tapping it opens **Viewing
as**: the person's roles on this team (tap one to switch), **Team settings** for a coach,
**Switch team** back to My teams, **Club admin** for the people who run the club, and
**Sign out**. Nobody is asked to choose a role up front: a team opens in the strongest
role held there.

**Club admin** (`/admin`) has three sections for a super admin:

- **Teams**: the team wizard (create, edit, open any team) and the league page link.
- **People**: everyone with a login and everything each is attached to, one card per
  person with their roles as pills ("Assistant coach · U9 Reds", "Parent of Leo · U9
  Reds", "Player · Fast Fives", "Club admin"). Search by name, email, role or team. Open
  a card to set that person's role on a team (Coach, Parent or player only, View only,
  No access, or **As listed** to go back to the team's own lists), add them to another
  team, make them a club admin, or view the site as them. Roles themselves come from each team's staff list
  and the emails on its players' records; nothing on a roster is edited from this
  page. It holds every family's email address, so club admins do not get it.
- **Access**: view as a user, the club admins list, every per-team override in one
  place, and the who-can-do-what table.

A club admin sees the team wizard, the role table and the league link on one page.

The choice is stored in the `team_slug` and `act_as` cookies and re-validated on every
request: a cookie can only narrow what the person is entitled to, never widen it. The
home page and every API route resolve the team with the same rule (`resolveTeamSlug` in
`lib/hats.js`), so what a page shows and what its data routes serve cannot differ.

### Player logins

A player gets a login of their own when a coach puts the player's own email on their
record: Squad tab, open the player, **Edit**, **Player's own email**. Nothing else is
needed. The next time that address signs in, it lands in the team as **Player**.

- **What they can do** is what a parent can do, for themselves only: see the team, reply
  In or Out for their own games and training, take or hand back fruit or jersey duty in
  their own name, and see their own contact details. They never see a team-mate's email,
  another family's contacts, ratings or coach notes.
- **Who it is for:** adult teams and older players. For a young player leave the field
  blank and keep the parents' emails under Parents / guardians; the parents reply for
  them. Adding a child's own address is the club's decision to make with the family.
- **One login, one player.** An address that is already another player's own email in the
  team is refused. An address a family shares belongs under Parents / guardians.
- **Who sees the address:** the coaches, the player, and that player's parents. It is
  removed from the team document before it is sent to anyone else.
- **A player who is also a parent or a coach.** A child in the same team rides on the same
  role ("Player and parent of Leo"), so there is nothing to switch to reply for both. A
  player on the staff list holds two roles, Coach and Player, and opens the team as coach.
- **Taking it away:** clear the field and save. That address is refused from its next
  request on.
- The words change with the role: a signed-in player reads "You", "Your reply" and
  "You're in for Saturday" where a parent reads their child's name.

Under the hood a player's own email gives a `player` membership (`lib/directory.js`),
which sits under the same family hat a parent wears (`lib/hats.js`, `selfIds` marks the
record that is the person themselves). Every rule written for a parent keys on that
hat's player ids, so there is no second set of checks to keep in step.

### Prerequisites and notes

- Parent emails must be on the player records (the Majestri import captures them; or
  add them in the wizard roster or the Squad tab).
- A player's own email is typed in by a coach, one player at a time (the Majestri file
  has no column for it). See Player logins above.
- Coaches need an email in `coachEmails` or on the team's staff list.
- **Player names:** the Majestri import keeps each player's full name. The whole team
  sees it in the squad list and on the player's page; tight spots (replies, duties, the
  planner, birthdays) use the short form, first name and initial ("Levi H."). Coaches
  can edit both in the player editor.
- **Importing players:** Squad tab, **Import player list**: upload the Majestri CSV or
  paste it. Importing a list again updates the players already in the squad instead of
  adding them twice, which is also how to fill in last names on a squad that was
  imported before they were kept.
- **Importing staff with them:** the same file's Coach, Assistant Coach and Manager rows
  are read back as the team's staff, each with what will happen, and come across with the
  players in one save unless you switch them off. A staff member with an email can sign
  in and edit the team, so the rules for that address are strict:
  - It is taken only from the row's primary contact, and only when the file says that
    contact *is* the person (the same name, or no name). Any other address on the row is
    ignored, and someone whose contact is another person comes in without a login.
  - Someone already on the staff list is matched by email, by name, or by the first name
    they were typed under ("Pat" for Pat Lane, when only one row could be them). Only
    their blank details are filled; nothing they have is replaced, and the read-back says
    which row they were matched to.
  - The file's "Coach" becomes the team's Head coach unless it already has one.
  - Nothing else about a staff member is kept: no date of birth, no gender.
  When creating a team in the wizard, the same rows are offered under Players and
  parents: **Use them as this team's staff** fills the staff rows under Team identity,
  which stay editable.
- **Importing a season's results:** Results tab, **Import results** (coaches only). For a
  season whose draw keeps no scores: Squadi shows every game of a MiniRoos-age season as
  an unconfirmed 0-0, and the sync never takes a season's scores. Paste one game per
  line, the round and the score with ours first (`R1 4-6`), or that it was rained out
  (`R6 rained out`, also washed out, cancelled, abandoned or called off). Each line is
  matched to the season game of its round, so a game moved for weather still finds its
  result. It is never matched to another competition's game or a carnival's. Every line
  is read back before anything is saved:
  - the game a line matched and what it will do;
  - a line naming another opponent, or saying W, L or D against its score, is left out;
  - a game that already has a score keeps it.

  A scored game is saved as played and a rained-out game as cancelled. Goal scorers are
  not part of it.
- **Importing training and games:** Calendar tab, **Import training**, or Results tab,
  **Import games** (coaches only; both are also in Team settings under Import & data).
  Upload a CSV or paste a list. The sheet reads it back before anything is saved: how
  many, the dates they cover, how the first one was understood, and any rows it
  skipped with the reason.
  - *Training:* columns `Date, Start, Finish, Title, Venue, Notes`, in any order.
    `Duration` (minutes) works in place of `Finish`. `Repeat` = weekly with an `Until`
    date makes one weekly session instead of a row per week. With no header row: one
    session per line as date, start, finish, venue, title, notes.
  - *Games:* columns `Date, Time, Opponent, Home or away, Venue, Round, Notes`. A
    `Score` column (3-1, ours first) marks a game as played. With no header row: one
    game per line in that order, and "@ Rovers" means away.
  - A `Type` column (Training, Game, Event, Carnival) lets one file carry both.
  - An **XPS Network import file** works as it is: Practice rows become training,
    Duration gives the finish time, "Arrive X min before" becomes a note, and the
    Coach's Notes column is never read. If the file covers several teams the sheet
    asks which to import.
  - Dates are day first (12/01/2027, 12 Jan 2027) or 2027-01-12. Times can be 17:30,
    5:30pm or 5.30 PM; a bare 1 to 6 o'clock is taken as the afternoon.
  - Importing the same file again adds nothing. A session on the same day at the same
    time with the same title, or a game on the same day against the same opponent, is
    left as it is apart from filling in a blank finish time, venue, note or round. A
    dated session that an existing weekly session already runs is not added on top.
  - Dates outside the team's season would be saved but not shown, so the sheet offers
    to extend the season to fit them.
  - **Taking an import back:** the same sheet lists **Earlier imports**, each with a
    Remove that takes out everything that import added (and the replies on it) in one
    go. Sessions and games typed in by hand, other imports, and imported games that
    have since been played are left alone.
  - Imported games are marked as entered by hand, so the Squadi sync never changes
    them. For a team whose fixtures come from Squadi, leave the league games to the
    sync (importing them as well would list them twice) and import only what Squadi
    does not carry.
- **Env teams taken over by the wizard:** editing an env-defined team in `/admin`
  stores a copy in the data store; from then on the stored copy wins for that slug.

---

## Running multiple teams (one site, one repo, one Redis)

Define every team in the `TEAMS` env var (JSON array — see `.env.example`). The code a
parent types at login selects their team, and everything is scoped to it: data, the
calendar feed (each team has its own `calendarKey`, so each team gets its own subscribe
URL), the Squadi sync (the cron/pinger syncs all teams in one call; the in-app Sync
button syncs only your team), and change emails (subject carries the team name).

Rules and notes:
- **Passwords must be unique per team** — the code IS the team selector.
- **Adding a team** = append one object to `TEAMS` and save (Render restarts with the
  new env; no code change, no deploy). Grab the new team's Squadi IDs from the FQ
  widget via DevTools, same as before.
- **Migration:** when you first set `TEAMS`, give your existing team any slug — its
  data auto-migrates from the old storage key on first read. Keep its password the
  same and parents won't notice anything.
- Isolation is enforced server-side: a team's code or calendar key can only ever reach
  that team's data.
- If `TEAMS` is not set, the original single-team env vars work exactly as before.

---

## Automatic fixture sync from Squadi

`/api/sync` polls Squadi's public fixtures endpoint for Olympic FC U8 Kangaroos White
(IDs baked in, overridable via env) and applies schedule changes to the dashboard:
date/time moves, venue & field changes, and new fixtures. **It never touches scorers,
duties, availability, focus or videos, nor the season's scores** (entered by hand), and
writes nothing if the response looks wrong. Another competition can be set to take its
scores from its draw, which only ever fills a game that has no score yet (see "Scores
from a competition's draw" below). Because the live calendar feed rebuilds from the same data, a moved game
updates in every subscribed parent calendar automatically.

Ways it runs:
- **On visit:** opening the dashboard quietly triggers a background sync, throttled
  server-side to at most once per 15 minutes — so the schedule is near-live whenever
  anyone is actually looking, without hammering Squadi.
- **Manual:** the "Sync fixtures now" button on `/league` (Set up panel).
- **Vercel Cron:** `vercel.json` schedules a daily run (7am Brisbane). Set `CRON_SECRET`
  in Vercel; their cron sends it automatically. (Hobby plan allows daily; Pro can run
  every few minutes — edit the schedule if you upgrade.)
- **Faster polling on the free plan:** point cron-job.org (free) at
  `https://YOUR-DOMAIN/api/sync?key=YOUR_CRON_SECRET` every 15–30 minutes.

**Change emails (optional):** create a free resend.com account, set `RESEND_API_KEY`
and `NOTIFY_EMAILS` (comma-separated). When the sync detects changes it emails the list,
e.g. "Round 7 vs Oxley United: time Sat 13 Jun 08:00 → 09:30". The first bulk import is
deliberately not emailed.

Caveat: this is an undocumented endpoint — it may change shape without notice. The sync
fails closed (no writes, error logged) rather than guessing.

### More than one competition

A team often plays something alongside its season: a winter tournament with part of the
squad, an invitational league on other days. In the `/admin` wizard the **Competitions**
step holds the season's Squadi IDs (one team, or two: see below) and a row for each
other competition: a name and its three IDs (or, for a draw on Dribl, its fixtures
request, or for one on Majestri, its page and your team: see below). A row can be saved
with just its name while its draw is not
published yet; the sync leaves it alone until its source is added with Edit.

Every sync pulls each draw that has its IDs. A game from another competition is labelled
with that competition's name wherever its round shows (Results, the match screen, Home,
Duties, the calendar feed), keeps its own round numbers, and does not count toward the
season record or the stats, the same as a carnival game. If one draw cannot be fetched
the others are still applied, and the Sync button names the one that failed.

For a team defined in `TEAMS`, the same list goes on the team entry:
`"competitions":[{"id":"winterfest","name":"Winterfest","squadi":{"competitionId":"…","divisionId":"…","teamId":0}}]`.
`id` is permanent (a game is tagged with it) and `name` can change.

Each draw has the name the club knows it by. A competition's is the name box at the top
of its row (a link read fills it in only while it is empty, and it can be typed over at
any time), and its games are labelled with it. The season can have one too, **Season
name** at the top of the step (for example "FQ Season"): it names the season's draw on
the league page and in the Sync button's report when it could not be fetched, and left
empty the season is simply "Season". In `TEAMS` it is `"seasonName":"…"` on the team.

Every draw's row, the season's and each competition's, also takes a **website link**: the
address of the page the draw is on (its Squadi or Dribl fixtures page, a competition's
page on Majestri, or a tournament's own site). It is kept beside the IDs, has an **Open** link beside it once saved, and is
what the team's league page lists under **Draws**. It can be saved before the IDs are
known, and it must be a full `https://` address. In `TEAMS` it is `"link":"https://…"` on
the season's `squadi` entry or on the competition.

#### Setting a draw up from its link

When the website link is the team's own fixtures page on Squadi or Dribl, or a
competition's page on a club's Majestri site, the rest of the row is filled in from it,
on a phone or a computer, with no IDs to hunt for. Paste
the link into the row's link box (or type it and press **Read link**), check what is
read back under the box, and save.

- **Squadi.** Open the Squadi fixtures page, choose the competition, the division and
  your team, and copy the address (it carries `competitionUniqueKey`, `divisionId` and
  `teamId`). The site looks the competition up on Squadi, fills in the three IDs the sync
  uses, and reads back the team as Squadi names it, the division, the competition and how
  many games are published. If that is not your team, the link was for another one.
  A tournament's page that shows every division (`divisionId=All`, as Winterfest's does)
  works too: the division is kept as `All`, and the sync follows the team through every
  division of the competition, its group and its finals.
- **Dribl.** Open the competition's fixtures page on Dribl, choose your club and age
  group, and copy the address (`….dribl.com/fixtures?season=…&competition=…&league=…&club=…`).
  It goes in a competition row of its own. Your browser asks Dribl which match centre
  that address belongs to, fills in the **Dribl fixtures request** the sync fetches (see
  below), reads the draw once and says what it found: your team, the competition and how
  many games. When the draw has more than one of your club's teams it asks which is
  yours, and offers their names as Dribl spells them.
- **Majestri.** Open the competition's page on the club's Majestri site and copy the
  address (`….majestri.com.au/comp-summary?compID=…`; a team's own page,
  `team-summary?teamID=…&compID=…`, works too). It goes in a competition row of its own.
  The site reads the page and says back the competition, the division and how many games
  it has, then lists its teams in the **team on Majestri** box: choose yours and it says
  how many of the games are yours. A team's own page names your team already.

A link to any other site is kept as the website link and nothing is read from it. The
server never requests a pasted address: for Squadi it asks Squadi's own service, using
the key and IDs read from the link once they have been checked, and for Majestri it asks
the club's Majestri site for the competition's page, at an address built from the
competition's number (`/api/feed-link`, for super admins and club admins, which stores
nothing). Dribl is only ever asked by the
browser, as it is for the sync, with a plain request to its API and no cookies. Every
box a link fills in can still be typed by hand, and typing in one puts the read-back
away.

The Dribl lookup has not been tried against the real Dribl from the build environment,
which Dribl turns away. If Dribl's answer is not what the app expects, the box says so,
naming the fields it found, the link is still kept, and the request can be pasted by
hand as below.

#### A competition whose draw is on Dribl

Some competitions publish their draw on Dribl's match centre (a page such as
`premierinvitational.dribl.com/fixtures`) rather than on Squadi. A competition's row in
the wizard takes one or the other: its three Squadi IDs, or its **Dribl fixtures
request**. The quick way to get the request is to paste the fixtures page's own link
into the row (above). By hand: open the competition's fixtures page on Dribl, choose
your club and age group there, open DevTools → Network, and copy the address of the
request that starts with `https://mc-api.dribl.com/api/fixtures?`. Beside it, add **your
team's name as Dribl shows it**, which tells the app which side of each game is yours.
(Left empty, the app works it out when exactly one team is in every game of the draw,
and asks for the name when it cannot.)

Dribl's API answers any browser but turns servers away, so `/api/sync` cannot pull this
draw. A coach's browser fetches it instead and posts the games to `/api/dribl`, which
checks every one and applies them exactly as a Squadi draw is applied: the same labels,
change notices and emails, the same rule that replies and duties are never touched, and
scores taken only as the competition's set-up says (see "Scores from a competition's
draw" below). It runs:

- **On a coach's visit:** opening the dashboard as a coach, at most once per 15 minutes.
  A parent's visit does not sync it (only a coach may post a draw).
- **Manual:** the same **Sync fixtures now** button on `/league`.
- **On a schedule, once switched on:** see "A scheduled Dribl sync" below. Until then a
  Dribl draw is as fresh as the last time a coach opened the team.

Dribl publishes no description of its API. If its answer is not in the form the app
reads, nothing is changed and the Sync button says so, naming the fields it found.

**What has been checked, and what has not.** Dribl's API answers a person's browser and
nothing else: a plain request from a server (the build environment, GitHub's runners) is
refused outright by Dribl's Cloudflare ("Sorry, you have been blocked", HTTP 403), for the
match-centre lookup and the fixtures alike, and Dribl's own website and terms cannot be
read from there either. So the app's reading of Dribl's answer has been tested against
stand-ins written from what is known of it, never against a real answer, and nothing
gets past that protection: no disguised browser, no automation. The first real read
happens in a coach's browser, where the link's read-back is the check (below).

**How a Dribl draw is read.**

- *The request.* A fixtures page link is turned into the fixtures request by the
  browser: the match centre's tenant is asked of Dribl's `/api/tenants` lookup (never
  assumed), and every filter in the link (season, competition, league, club, date range,
  time zone) is kept. Only `….dribl.com` page links and `mc-api.dribl.com` requests are
  accepted; the next page is followed only by adding Dribl's cursor to the stored
  request, never by following an address in the answer.
- *Asking politely.* A page Dribl cannot answer just then (429, or a 5xx, or no answer)
  is asked for again, twice at most: after the wait Dribl asks for (`Retry-After`, where
  the browser may see it), or 1 and then 2 seconds, never more than 20. A refusal (403)
  is Dribl saying no, and is not asked again.
- *A game's state.* Read from a flag (`forfeit`, `postponed`, `cancelled`, `abandoned`) or
  the first status-like field (`status`, `match_status`, `fixture_status`,
  `result_status`, `state`), as scheduled, live, completed, postponed, cancelled,
  abandoned or forfeited.
- *Its result.* Taken only from a game Dribl calls completed or forfeited: a game not
  played yet is never a 0–0, while a 0–0 that was played is a result like any other. The
  score is read from `home_score`/`away_score` (or `home_team_score`/`away_team_score`,
  `home_goals`/`away_goals`), and a penalty shootout from `home_penalty_score`/
  `away_penalty_score` (or the like) when the score is level and the penalties differ.
  Whether a result is then filled in is the competition's **Scores from Dribl** choice
  (see "Scores from a competition's draw").
- *The check.* When Dribl calls some of the team's games finished but no score can be
  read from them, or uses a status this app does not know, or gives no status to games
  already played, the read-back says so and lists the names of the fields a game
  carried: a screenshot of it is all it takes to fix the names. Names only: never a
  team, a place or a person.

**Many syncs, many draws.** A team is synced by one sync at a time: the cron, a visit and a
coach's browser posting a Dribl draw each take the team's lock first (Redis set-if-absent
with a one-minute expiry), and one that finds it taken changes nothing and is tried again
next time. A game two of the team's Dribl competitions both ask for is applied once, with
the first. Nothing is ever deleted because a draw did not come back, or came back short.

Crests are the app's own, whichever service a draw comes from: an opponent is matched by
name to the registry in `lib/clubs.js` (files in `public/crests`), and a club with no
file there shows its initials. The logo address a draw gives is kept on the game and
never shown.

For a team defined in `TEAMS`:
`"competitions":[{"id":"premier","name":"Premier Invitational","dribl":{"url":"https://mc-api.dribl.com/api/fixtures?…","team":"Olympic FC U9"}}]`.

#### A scheduled Dribl sync (off until you switch it on)

So that a Dribl draw keeps up with nobody in the app, a GitHub workflow
(`.github/workflows/dribl-sync.yml`) can read it three times a day: 6:23 am, 12:23 pm and
6:23 pm Brisbane time. Each run asks the site for every team's Dribl draws (those with a
Dribl fixtures request saved, whether it came from a pasted link or was typed in), reads
each from Dribl, and posts the games to `/api/dribl`, where they are checked and applied
exactly as a coach's browser's are. A coach's visit still syncs as well.

It makes **plain requests and nothing more**: Node's own `fetch`, no browser, nothing that
pretends to be one. Dribl turns most servers away (GitHub's included, when this was
written), so until Dribl lets the club's requests through, a run fails and says
"refused by Dribl". That is the cue to ask Dribl to let them through. They do not need to
give an API key or admin access: one Cloudflare rule is enough, for example one that
allows GET requests to `mc-api.dribl.com` carrying a header with a value the club gives
them (the reader sends `X-Club-Sync` by default).

Set it up once:

1. **The site.** In Render, under Environment, set `CRON_SECRET` to a long random value if
   it is not set already (the scheduled Squadi sync uses the same key).
2. **GitHub.** Under the repository's Settings, Secrets and variables, Actions: add the
   secret `CRON_SECRET` with the same value, and the variable `SITE_URL` with the site's
   address (`https://…`).
3. **When Dribl agrees a header:** add the secret `DRIBL_CLUB_KEY` with the value, and the
   variable `DRIBL_CLUB_HEADER` if they chose a name other than `X-Club-Sync`.
4. **Switch it on:** add the variable `DRIBL_SYNC` with the value `on`. To try it at once,
   open Actions, then Dribl sync, then **Run workflow**: a run started by hand runs even
   while it is switched off. Switch it off after the competition by removing the variable.

Until it is switched on, the scheduled runs are skipped and nothing is asked of anyone.
With it on and no Dribl draw set up, a run asks the site and nothing else. The repository
is public, and so is what a run prints: counts, and each failure by its kind (refused by
Dribl, Dribl did not answer, the team's name needs checking), never a team's name, a
competition, an id or a link. GitHub pauses a scheduled workflow in a public repository
after 60 days without a commit; if that happens, turn it back on in the Actions tab.

#### A competition whose draw is on Majestri

A club can run a competition of its own on its Majestri site, such as a summer fives
league, with the draw on a page like `<club>.majestri.com.au/comp-summary?compID=…`.
Paste that page's link into a competition row (above) and choose your team. What is
saved is the competition's page, your team's name and Majestri's number for it; the sync
goes by the number, so a team renamed on Majestri is still found, and by the name when
the number is not on the page.

Majestri answers servers, so this draw is pulled by `/api/sync` with the Squadi ones: on
visit, by the Sync button and by the cron, and a change email names Majestri as where
the change came from. The page is read for its rounds, dates, times, fields and teams. A game whose
teams are not drawn yet (a final shown as TBA) is left out until they are, a bye is not a
game, and a semi-final or final, which has no round number, is named by the competition.
A game keeps its place when it moves to another time or field, as on Squadi. Replies and
duties are never touched, and scores are taken only as below.

Majestri's page is a web page, not a published feed, so it may change shape without
notice. If it is not in the form the app reads, nothing is changed and the Sync button
says so. The server only ever asks for the competition's page on the club's own
`….majestri.com.au` address and follows no redirect.

For a team defined in `TEAMS`:
`"competitions":[{"id":"fives","name":"Summer Fives","majestri":{"url":"https://<club>.majestri.com.au/comp-summary?compID=…","team":"…","teamId":"…"},"link":"https://<club>.majestri.com.au/comp-summary?compID=…"}]`.

#### Scores from a competition's draw

The season's scores are entered by hand: MiniRoos keeps no results at U8, and Squadi
shows every one of those games as 0–0. Any other competition can take its scores from its
draw instead. In the wizard, a competition whose draw is on Squadi, Dribl or Majestri has a
**Scores from …** switch under its draw: on for a competition being added, off for one
saved before the switch existed, and changed with Edit at any time. With it on:

- A game's score comes in once its result is final: on Squadi, once the competition has
  confirmed it (Squadi locks a confirmed result, and never locks the 0–0s of a draw that
  keeps no results); on Dribl and Majestri, once the result is shown there.
- It fills a game that has no score yet, on or after the game's date, and marks it as
  taken from that site. It never changes a score already in the app, typed in or taken
  before, and a score a coach clears stays cleared. A cancelled game takes none.
- It is quiet: no change notice and no email, since a result is not a schedule change.

A draw's link read-back says how many of your games came with their scores. Dribl's
answer could not be seen from where this was written, so its reader looks for the usual
names and says, with the fields it found, when a finished Dribl competition gives none
it can read (see "A competition whose draw is on Dribl").

The season record and the stats count the season's games only, as before: a
competition's results show on its own games and in Results. In `TEAMS`, the choice is
`"scores":true` on the competition.

#### A squad for a competition

A competition often takes part of the team. In **Team settings → Competition squads**
the coach turns **Everyone** off for a competition and switches off the players who are
not going. From then on its games are for that squad:

- only those players are counted on Home, the match screen and Who's in, listed for
  duties and put in the game manager's roster;
- only their families are asked to reply. A family whose child is not going is told so on
  that game ("Alex isn't in the Winterfest squad.") and their Home card moves on to the
  next game their child is part of;
- everyone still sees the game in Results and on the calendar.

The season is always everyone. A squad is kept per competition on the team document
(`competitionSquads`) and saved through its own route, `/api/competition-squad` (coach
only), so no other save can undo it. If every player in a squad has since left the team,
the competition goes back to everyone.

### One squad that plays as two teams

Some squads enter the season as two teams and play two games each round. In the
**Competitions** step, under Season, **Add a second team** gives the season a second
row; each row then needs a short label (at most 12 characters, and different from the
other), which names that side on every one of its games.

Each sync applies both feeds onto the same squad. A round with a game on each side is a
paired round: both games show with their side's label, one reply covers both, and the
calendar feed has one event per game with the side in the team's name. If one feed
cannot be fetched the other is still applied, and the Sync button names the side that
failed. A team with one feed has no sides, and nothing changes for it. Other
competitions keep a single feed each.

For a team defined in `TEAMS`, `squadi` is then an array of the two labelled feeds:
`"squadi":[{"label":"Reds","competitionId":"…","divisionId":"…","teamId":0},{"label":"Blues","competitionId":"…","divisionId":"…","teamId":0}]`.

## Opposition crests, and where the game is

Wherever a game is written "vs Somebody" the opposition's crest is beside it: the Next
game card, every game row (Home's next 7 days, the calendar list and a day's sheet,
where it stands in place of the trophy icon), Results, the duties list, the header of
a game's own screens (match detail, and Who's in for the game), the match day planner,
and **My teams** for a family on two or more teams.

Wherever someone is asked to answer, the sheet says what for and where. The **reply
sheet** (in a team and on My teams), the sheet for taking a **duty**, and the reply card
on a player's own screen all show the opposition and its crest, the date and time, home
or away, the ground, and a **Directions** button that opens the ground in Google Maps.
A game with no ground yet says "Venue to be confirmed". A reply on a paired round
covers both games, so its sheet gives each side's kick-off and field, with the ground
named once when the two share it. Training says where it is too.

The built-in crests come first, unless the admin has chosen a logo for the club from its
own website (below). They are the site's own files, found by the opponent's name: the set is in `public/crests` (512 px PNGs, padded so a round crop clips nothing)
and `lib/clubs.js` maps a team name to its file by the words in it ("Oxley United U9
Eagles" is Oxley United). To add one, put its PNG in `public/crests` and add a line for
it to `lib/clubs.js`. A club with neither a built-in crest nor a logo found for it (below)
shows a disc with its initials.

### Logos found on Squadi and Dribl (the club logo library)

Tournaments bring opposition the built-in set doesn't cover: interstate clubs,
independent academies, tournament-only teams. For those, the site uses the logo Squadi or
Dribl gives the team, kept in a club logo library (`lib/clubLogos.js`, one document for
the whole club, stored beside the teams). It is an extension of the built-in set, not a
second one:

- **A built-in crest wins over anything found.** A team the set knows keeps its crest
  whatever a draw says, and the library never changes the set. Only a logo the admin
  chose for the club (below) comes before it, since a club can change its crest.
- **Where the logos come from.** Squadi gives each team a logo on every game. For a
  league team it is the club's: Squadi files it under the club's organisation number,
  and every team of that club carries the same one. For some tournaments (Winterfest
  among them), every team carries the competition's own logo instead. That is no one's
  crest and is never used, so those teams keep their initials unless the club is in the
  built-in set. Dribl gives each side's logo on its games (`home_logo`/`away_logo`, or
  similar), and the match centre's club list (`/api/list/clubs`) gives each club's. Both
  are read in a coach's browser, as Dribl's games are. Squadi's team and club lists need a
  Squadi login, so they are not used.
- **Club, team or neither.** A club's logo is shown for all its teams. A team's own logo
  (an academy's badge, say) is shown for that team only and comes before its club's.
- **The same club, by evidence only.** Two teams are the same club when the provider says
  so: the same Squadi organisation number, the same Dribl club id, or the very same logo
  image. Never because their names look alike, and never across providers. A team first
  seen without an id is matched later only by its exact name on the same provider. One
  club with many team names stays one club.
- **References, not copies.** The library keeps where the provider shows a logo, never a
  copy of the image. Squadi's licence doesn't let its users copy a copyrighted image
  through it without the owner's permission, and Dribl's terms couldn't be read. So the
  image loads from Squadi's or Dribl's own site, asked for without saying which page it is
  on. Only Squadi's own storage and Dribl's own sites (`*.dribl.com`) are used. Another
  host, for a provider that keeps its logos elsewhere, can be allowed exactly with
  `LOGO_HOSTS` (host names separated by commas, no wildcards): the Dribl read-back names
  any such host.
- **Found as the games come in.** Every sync tells the library what its draws showed,
  after the games are saved and under its own lock. That step can't fail a sync, hold up
  a score or change what the sync reports. What the library knows is worked out afresh on
  every read, so a logo found today shows on every past and future game against that
  team, on every team page. The logo is never saved into a team's games.
- **Club admin → Logos** (super admin) lists every opposition team with what is shown for
  it: the counts, the teams still without a logo, the logos you chose, the logos found and
  where from, and the built-in crests, one row per club. **Find missing logos** reads every team's Squadi draws again on the
  server, and every Dribl draw with its club list in the admin's own browser. No game is
  changed. **Hide** keeps a found logo from being shown. It hides a club's logo for all
  its teams, or a team's own logo for that team. **Show** undoes it. A choice made here
  is never changed by what a draw says later.
- **Any club's logo from its own website.** Every club can be linked to its website and
  given a logo picked from it: **Add club logo** for a team still without one (or with
  one hidden), **Change logo** for a logo found or a built-in crest, and **Change** for a
  club already chosen, when its logo changes. The club's name is guessed from the team's
  ("Valley Wanderers FC NPL U11 Gold" is "Valley Wanderers FC"), or for a built-in crest
  from the words its teams all start with, and can be changed. Before anything is saved,
  the admin sees every opposition team the name covers. Then paste the club's website:
  the server reads that one page and offers what looks like its logo: what the page
  itself calls its logo, images named or captioned logo, crest or badge, the icon the site
  gives phones, and the picture it shares. The logo in use stays on offer beside them.
  Pick one and save. A link straight to a logo image is offered as it is, without the
  server asking the site for it.
- **Held for the club.** A chosen logo shows for every team whose name has every word of
  the club's name (letter case and punctuation aside), its future teams too, as the
  built-in crests are matched. Every word counts, "FC" included, so "Seaside FC" is not
  "Seaside Rovers". A name made only of words every club has ("FC", "Football Club") is
  refused. A chosen logo comes before the built-in crest, anything found on Squadi or
  Dribl, and a hide, since it is the admin's own choice. Where two chosen clubs both fit a
  team, the one with more of its words is shown, and the read-back counts it that way.
  Renaming a club while changing it replaces the old one. **Remove** takes it out again,
  and its teams go back to the built-in crest or what the draws show.
- **Filling the circle.** A logo that isn't a built-in crest is fitted inside its circle on
  white with only a thin margin. One with space of its own around it can be enlarged, up
  to 160% in steps of 5%, with **Size in the circle**, seen at full and list size as it
  changes. The size rides on the logo's link (`#fill=1.3`), which a browser never sends
  with the request for the image, and the enlarged logo is cut back to its circle so it
  never spills past its place. A logo found on Squadi or Dribl can be enlarged too:
  **Change logo** offers it as the logo in use, and saving makes it the club's choice.
- **Reading a club's site, carefully.** Only a public https site is read. Its name is
  looked up first and refused if it points into a private network, every redirect is
  checked the same way, and there is a time and size limit. The request says what it is
  (`club-logo-finder`). A site that puts up a page checking its visitor is a person
  ("One moment, please…") is never got round: the admin is told, and can try again or
  paste the logo's own link. As with Squadi's logos, the link is kept, not a copy, and
  families' phones load the logo from the club's site without saying which page it's on.
- **The Dribl read-back** (pasting a Dribl link in the team form) says how many of the
  teams we play come with a logo the site can show, the host any others are on, the field
  names a game had when Dribl gives no logos, and what Dribl's club list holds. A
  screenshot of it settles what Dribl actually sends.

Messages that leave the site (the WhatsApp reminder, a shared game, the calendar feed)
and the Ask tab's answers are plain text, so they name the opposition without a crest.

---

## Honest limits (unchanged by going to a website)

- **Squadi** still has no public API — keep transcribing scores. Server-side scraping of
  their private endpoints is brittle and against their terms; not built in.
- **Veo** still can't be embedded anywhere (their setting). Veo links open in a new tab;
  YouTube links embed.

## Children's data

This site holds kids' names, locations, schedules and video links. The shared code keeps it
off the open web, but anyone with the code (or the calendar key) can see everything. Keep
both to the team, don't index the site publicly, and align with your club's consent policy.
For revocable per-person access and parent redactions, use account mode (see
"Account login and roles" above).

In account mode a child can be given a login of their own (see "Player logins"). It is
off unless a coach types the child's own email onto their record, it shows the child
nothing a parent would not see, and clearing the field removes it. Decide with the
family before adding one.
