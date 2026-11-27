import { NextResponse } from "next/server";
import { getData, setData, legacyOwnerSlug } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { sanitizeLeagueSetup, leagueSetupFor, isOriginalTeam } from "@/lib/leagueSetup";
import { drawLinks } from "@/lib/competitions";

export const dynamic = "force-dynamic";

// Narrow league-setup endpoint: reads and writes ONLY data.squadi, the Squadi
// draw a team's /league page embeds (shape in lib/leagueSetup.js).
//
// The page used to load the whole team document to read one key, and save by
// posting the whole document back with that key changed, so a setup saved
// from a page that had been open a while could overwrite a score or a squad
// edit made in the meantime. Here the write re-reads the document and
// replaces just squadi; team, players, fixtures and sessions are the freshly
// read copies. This route is the key's only writer: lib/protect.js keeps the
// whole-document save from ever writing or undoing it.
//
// GET: any member of the team (or anyone with the team code in legacy mode).
// Response: { teamSlug, squadi, saved, draws }. `saved` is whether the team
// has a setup of its own; `squadi` is that setup, or null when it has none.
// `draws` is every draw the club's set-up holds a website link for (the
// wizard's Competitions step; lib/competitions.js drawLinks): the season's,
// then each other competition's, as { name, provider, link, season?, side? }.
// The page lists them to be opened, and shows the season's own draw in place
// when it is on Squadi and the team has no setup of its own. With neither, it
// says "Not configured yet." rather than showing anybody's draw. Links only:
// no ids and no Dribl request are sent.
// Only the original team (lib/leagueSetup.js isOriginalTeam: the legacy owner,
// as for the pre-multi-team document, or the team whose own Squadi sync ids
// are the original team's) falls back to the pre-multi-team default; on any
// other team that default's ids are taken out of a stored setup as it is read.
//
// POST: coach hat only in account mode; legacy team-code mode trusts any code
// holder (the one-code-no-roles model, as the other narrow routes do). A
// super admin "viewing as" someone is refused before anything else.
// Body: { teamSlug, squadi: { mode, url, org, yearId, comp, divisionId, teamId } }
// teamSlug is the team the page loaded its set-up for (from GET). The team a
// request acts on comes from cookies, which another tab can change, so a save
// from a page opened for one team is refused (412) rather than written to the
// team chosen since.
// Response: { ok: true, squadi } — the sanitised setup exactly as stored, so
// the page can show what was saved rather than what was typed.
// Errors carry a sentence the page shows as it is.

export const COACH_ONLY = "Only coaches can change the league setup.";
export const WRONG_TEAM = "This page was opened for another team. Reload it, then save again.";
export const NO_TEAM_DATA = "This team has no data yet. Open the team hub once, then set up the league page.";

export async function GET(req) {
  const v = await resolveViewer(req);
  if (v.error) return viewerError(v);
  const doc = await getData(v.team.slug);
  const setup = leagueSetupFor(doc, { originalTeam: isOriginalTeam(v.team, legacyOwnerSlug()) });
  return NextResponse.json({ teamSlug: v.team.slug, ...setup, draws: drawLinks(v.team) });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const sent = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const input = sent.squadi;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof sent.teamSlug !== "string" || !sent.teamSlug) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: COACH_ONLY }, { status: 403 });
  }
  const team = v.team;
  if (sent.teamSlug !== team.slug) return NextResponse.json({ error: WRONG_TEAM }, { status: 412 });

  const { squadi, error } = sanitizeLeagueSetup(input);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const data = await getData(team.slug);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: NO_TEAM_DATA }, { status: 404 });
  }

  // Replace just this one key; everything else is the freshly read document,
  // so a reply or a score that landed since the page loaded rides along intact.
  await setData(team.slug, { ...data, squadi });
  return NextResponse.json({ ok: true, squadi });
}
