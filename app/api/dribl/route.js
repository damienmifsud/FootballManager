import { NextResponse } from "next/server";
import { getMeta } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { driblSources } from "@/lib/competitions";
import { sanitizeDrawRecords } from "@/lib/dribl";
import { applyDraws } from "@/lib/applyDraws";
import { cronAuthorized } from "@/lib/cronAuth";
import { getTeams, teamBySlug } from "@/lib/teams";

export const dynamic = "force-dynamic";

// The Dribl half of the fixture sync.
//
// Dribl's fixtures API answers any browser but turns servers away, so a
// competition whose draw is on Dribl (lib/dribl.js) cannot be pulled here the
// way /api/sync pulls Squadi's. A coach's browser does the fetching instead:
//
// GET   what this browser should fetch: { sources: [{ comp, name, url, team }],
//       due }. `due` says whether a sync is owed (none in the last 15 minutes).
//       Only someone who may post the result is given anything to fetch:
//       everyone else gets an empty list.
// POST  the draws it fetched: { draws: [{ comp, records }] }. Each is applied
//       to its competition's games exactly as a Squadi draw is applied
//       (lib/applyDraws.js), and the document is saved once.
//       Response: { ok: true, matchesSeen, created, changes, emailStatus }.
//
// Who may post: the coach hat in account mode; anyone holding the code in
// legacy team-code mode, as with the other writes. A super admin "viewing as"
// someone is refused. The records come from a browser, not from Dribl, so each
// one is checked before it can become a game (sanitizeDrawRecords), and only
// for a competition whose source on this team is Dribl. That gives a coach
// nothing they did not have: a coach can already edit every fixture.
//
// The scheduled Dribl reader (scripts/dribl-sync.mjs, run by GitHub on a
// schedule once switched on) uses the same two calls with the scheduled-job
// key, CRON_SECRET, as "Authorization: Bearer <key>" (lib/cronAuth.js; never
// as ?key=, which would put the key in addresses and logs):
//
// GET   every team's Dribl draws: { teams: [{ team, sources: [{ comp, name, url, team }] }] }.
//       `team` on the entry is the team's slug; on a source it is our team's
//       name as Dribl shows it ("" when the set-up gives none).
// POST  one team's draws: { team, draws: [{ comp, records }] }, checked and
//       applied exactly as a coach's are. An unknown slug is a 404.

const STALE_MS = 15 * 60 * 1000; // the same throttle as the Squadi sync-on-visit
export const COACH_ONLY = "Only coaches can sync a draw.";
export const NOT_A_DRIBL_COMPETITION = "That competition does not take its draw from Dribl.";
export const NO_SUCH_TEAM = "There is no team with that slug.";

const mayPost = (v) => v.mode !== "account" || v.hat?.role === "coach";
const sourceList = (sources) => sources.map((s) => ({ comp: s.comp.id, name: s.comp.name, url: s.dribl.url, team: s.dribl.team || "" }));

export async function GET(req) {
  if (cronAuthorized(req)) {
    const teams = [];
    for (const team of await getTeams()) {
      const sources = driblSources(team);
      if (sources.length) teams.push({ team: team.slug, sources: sourceList(sources) });
    }
    return NextResponse.json({ teams });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  const sources = mayPost(v) ? driblSources(v.team) : [];
  if (!sources.length) return NextResponse.json({ sources: [], due: false });
  const meta = (await getMeta(v.team.slug)) || {};
  const due = !meta.lastDriblSyncAt || Date.now() - meta.lastDriblSyncAt >= STALE_MS;
  return NextResponse.json({ sources: sourceList(sources), due });
}

// The draws as they may be applied to `team`: each must be for one of its
// Dribl competitions, once, and its records pass the check one by one.
function drawsFor(team, sent) {
  const sources = driblSources(team);
  const draws = [];
  const seen = new Set();
  for (const d of sent) {
    const source = sources.find((s) => s.comp.id === d.comp);
    if (!source || seen.has(d.comp)) return { error: NOT_A_DRIBL_COMPETITION };
    const records = sanitizeDrawRecords(d.records);
    if (!records) return { error: "bad request" };
    seen.add(d.comp);
    draws.push({ comp: source.comp, records });
  }
  return { draws };
}

async function applyFor(team, sent) {
  const { draws, error } = drawsFor(team, sent);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const applied = await applyDraws(team, draws, { source: "Dribl", stamp: "lastDriblSyncAt" });
  if (!applied) return NextResponse.json({ error: "no data" }, { status: 404 });
  return NextResponse.json({ ok: true, ...applied });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const sent = body && typeof body === "object" && !Array.isArray(body) ? body.draws : null;
  if (!Array.isArray(sent) || sent.length === 0 || sent.some((d) => !d || typeof d !== "object" || Array.isArray(d) || typeof d.comp !== "string" || !d.comp)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // The scheduled reader names the team it read for.
  if (cronAuthorized(req)) {
    const team = typeof body.team === "string" && body.team ? await teamBySlug(body.team) : null;
    if (!team) return NextResponse.json({ error: NO_SUCH_TEAM }, { status: 404 });
    return applyFor(team, sent);
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (!mayPost(v)) return NextResponse.json({ error: COACH_ONLY }, { status: 403 });
  return applyFor(v.team, sent);
}
