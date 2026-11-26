import { NextResponse } from "next/server";
import { getData, setData, legacyOwnerSlug } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { sanitizeLeagueSetup, leagueSetupFor } from "@/lib/leagueSetup";

export const dynamic = "force-dynamic";

// Narrow league-setup endpoint: reads and writes ONLY data.squadi, the Squadi
// draw a team's /league page embeds (shape in lib/leagueSetup.js).
//
// The page used to load the whole team document to read one key, and save by
// posting the whole document back with that key changed, so a setup saved
// from a page that had been open a while could overwrite a score or a squad
// edit made in the meantime. Here the write re-reads the document and
// replaces just squadi; team, players, fixtures and sessions are the freshly
// read copies. lib/protect.js keeps the whole-document save from undoing it.
//
// GET: any member of the team (or anyone with the team code in legacy mode).
// Response: { squadi, saved }. `saved` is whether the team has a setup of its
// own; `squadi` is that setup, or null when it has none, in which case the
// page shows "Not configured yet." rather than anybody's draw. Only the
// legacy owner (lib/store.js legacyOwnerSlug) falls back to the pre-multi-team
// default, the same rule that keeps the pre-multi-team document from leaking
// into other teams.
//
// POST: coach hat only in account mode; legacy team-code mode trusts any code
// holder (the one-code-no-roles model, as the other narrow routes do). A
// super admin "viewing as" someone is refused before anything else.
// Body: { squadi: { mode, url, org, yearId, comp, divisionId, teamId } }
// Response: { ok: true, squadi } — the sanitised setup exactly as stored, so
// the page can show what was saved rather than what was typed.
// Errors carry a sentence the page shows as it is.

export const COACH_ONLY = "Only coaches can change the league setup.";
export const NO_TEAM_DATA = "This team has no data yet. Open the team hub once, then set up the league page.";

export async function GET(req) {
  const v = await resolveViewer(req);
  if (v.error) return viewerError(v);
  const doc = await getData(v.team.slug);
  return NextResponse.json(leagueSetupFor(doc, { legacyOwner: v.team.slug === legacyOwnerSlug() }));
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body.squadi : null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: COACH_ONLY }, { status: 403 });
  }
  const team = v.team;

  const { squadi, error } = sanitizeLeagueSetup(input);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: NO_TEAM_DATA }, { status: 404 });

  // Replace just this one key; everything else is the freshly read document,
  // so a reply or a score that landed since the page loaded rides along intact.
  await setData(team.slug, { ...data, squadi });
  return NextResponse.json({ ok: true, squadi });
}
