# Team Dashboard — website (Olympic FC red & white)

A hosted version of the team dashboard (fixtures, results, training calendar, duties,
squad, stats, match video) with the things the chat artifact could **not** do:

1. **Server-stored shared data** for everyone on the team.
2. **A live, subscribable calendar feed** that Google Calendar and Outlook/Microsoft 365
   keep in sync automatically.
3. **One shared password** protecting the whole site.

The dashboard UI is reused unchanged in `components/Dashboard.jsx` (only a `"use client";`
line was added). A shim (`lib/clientStorage.js`) gives it a server-backed `window.storage`.
The colour scheme is set with the CSS variables at the top of `components/Dashboard.jsx`
(`--pitch` = Olympic FC red `#C8102E`); tweak there if the club updates its shade.

---

## Access model (what you asked for)

- **One shared site code** (`SITE_PASSWORD`) — everyone types the same thing to get in.
  No accounts, no roles. Set it once; share it with the parents; rotate it any time by
  changing the env var.
- **Editing:** anyone signed in can edit (you said no need to separate). If you'd rather
  parents not change scores by accident, set a **Coach PIN** in the dashboard's in-app
  Settings — that hides the edit controls behind a PIN while still letting everyone view.
- **Calendar feed** uses its own secret key in the URL (calendar apps can't send the
  login cookie), so the feed works without anyone logging in.

---

## Run it locally

Requires Node 18+.

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

## Shared password vs. Google / Microsoft login

You're on the **shared password** now — simplest, no accounts, fits a junior team.

If you later want **Google / Microsoft sign-in** instead, the trade is:

| | Shared password (current) | Google / Microsoft (OAuth) |
|---|---|---|
| Parent effort | type one code | sign in with existing Google/MS account |
| New passwords | one, shared | none |
| Real access control | rotate code if it leaks | per-parent **email allowlist** (revoke individuals) |
| Per-parent features | no | yes (identity, "your duty") |
| Setup | 1 env var | register an OAuth app in Google Cloud **and** Azure AD, add NextAuth, maintain an email allowlist |

Recommendation: keep the shared code unless you specifically need to allow/deny
individual parents or show per-parent info. If you do, the build is NextAuth with Google
and Microsoft Entra providers + an allowlist check — ask and it can be added.

---

## League fixtures (Squadi embed)

`/league` embeds the same Squadi widget the FQ website uses, pre-filtered via URL
parameters — the page has a **Set up** panel (saved for everyone) where you either build
the link from filters or paste the full embed URL.

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

## Parent & coach login (Google / Microsoft / magic-link)

Set `AUTH_SECRET` to switch the site from team-code mode to account login. Each
provider activates only when its keys are present, so you can start with one.
After signing in, a person sees a **Your teams** list built from the resolver:
parents are matched by the emails on their child's record, coaches via a
`coachEmails` array on the team. Picking a team drops them straight in — for a
parent, already bound to their child for attendance (no kid-picking).

**Magic-link (easiest first step):** add `AUTH_RESEND_KEY` + `AUTH_EMAIL_FROM`
(Resend account, verified domain). Parents type their email, click the link, done.
Requires the Upstash adapter (already wired) to store the one-time tokens.

**Google:** Google Cloud → Credentials → OAuth client (Web). Redirect URI
`https://YOUR-DOMAIN/api/auth/callback/google`. Set `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

**Microsoft:** Entra ID → App registrations. Redirect URI
`https://YOUR-DOMAIN/api/auth/callback/microsoft-entra-id`. Set the three
`AUTH_MICROSOFT_ENTRA_ID_*` vars.

Prerequisites: parent emails must be on the player records (the Majestri import
captures them; or add them in the player editor), and `AUTH_URL` should be your
site URL. Until `AUTH_SECRET` is set, nothing changes — the team-code login stays.
This is a beta of Auth.js v5; test on a preview deploy before switching the live site.

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
For revocable per-parent access, use the Google/Microsoft option above.
