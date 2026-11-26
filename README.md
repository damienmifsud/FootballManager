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

Each team has its own setup. A team that has not saved one shows "Not configured yet."
rather than any draw. Only the original team falls back to the U8 Kangaroos White draw it
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
| Sync fixtures from Squadi now | Yes | No | Yes | No | Yes |
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
Every visit still refreshes fixtures quietly for everyone; only the manual "sync now" is
coach-level. Duties: coaches assign or clear any duty; parents and players claim fruit or
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
date/time moves, venue & field changes, and new fixtures. **It never touches scores,
scorers, duties, availability, focus or videos**, and writes nothing if the response
looks wrong. Because the live calendar feed rebuilds from the same data, a moved game
updates in every subscribed parent calendar automatically.

Ways it runs:
- **On visit:** opening the dashboard quietly triggers a background sync, throttled
  server-side to at most once per 15 minutes — so the schedule is near-live whenever
  anyone is actually looking, without hammering Squadi.
- **Manual:** the "Sync fixtures from Squadi now" button on `/league` (Set up panel).
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
other competition: a name and its three IDs. A row can be saved with just its name while its draw is not published yet;
the sync leaves it alone until the IDs are added with Edit.

Every sync pulls each draw that has its IDs. A game from another competition is labelled
with that competition's name wherever its round shows (Results, the match screen, Home,
Duties, the calendar feed), keeps its own round numbers, and does not count toward the
season record or the stats, the same as a carnival game. If one draw cannot be fetched
the others are still applied, and the Sync button names the one that failed.

For a team defined in `TEAMS`, the same list goes on the team entry:
`"competitions":[{"id":"winterfest","name":"Winterfest","squadi":{"competitionId":"…","divisionId":"…","teamId":0}}]`.
`id` is permanent (a game is tagged with it) and `name` can change.

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

A crest is always one of the site's own files, found by the opponent's name; the logo
address that comes with a Squadi draw is kept but never shown, so nothing is loaded from
another club's website. The set is in `public/crests` (512 px PNGs, padded so a round
crop clips nothing) and `lib/clubs.js` maps a team name to its file by the words in it
("Oxley United U9 Eagles" is Oxley United). A club that is not in the set shows a disc
with its initials. To add one, put its PNG in `public/crests` and add a line for it to
`lib/clubs.js`.

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
