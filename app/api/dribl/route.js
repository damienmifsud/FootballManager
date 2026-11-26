import { NextResponse } from "next/server";
import { getMeta } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { driblSources } from "@/lib/competitions";
import { sanitizeDrawRecords } from "@/lib/dribl";
import { applyDraws } from "@/lib/applyDraws";

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
//       to its competition's games exactly as a Squadi draw is
//       (lib/applyDraws.js), and the document is saved once.
//       Response: { ok: true, matchesSeen, created, changes, emailStatus }.
//
// Who may post: the coach hat in account mode; anyone holding the code in
// legacy team-code mode, as with the other writes. A super admin "viewing as"
// someone is refused. The records come from a browser, not from Dribl, so each
// one is checked before it can become a game (sanitizeDrawRecords), and only
// for a competition whose source on this team is Dribl. That gives a coach
// nothing they did not have: a coach can already edit every fixture.

const STALE_MS = 15 * 60 * 1000; // the same throttle as the Squadi sync-on-visit
export const COACH_ONLY = "Only coaches can sync a draw.";
export const NOT_A_DRIBL_COMPETITION = "That competition does not take its draw from Dribl.";

const mayPost = (v) => v.mode !== "account" || v.hat?.role === "coach";

export async function GET(req) {
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  const sources = mayPost(v) ? driblSources(v.team) : [];
  if (!sources.length) return NextResponse.json({ sources: [], due: false });
  const meta = (await getMeta(v.team.slug)) || {};
  const due = !meta.lastDriblSyncAt || Date.now() - meta.lastDriblSyncAt >= STALE_MS;
  return NextResponse.json({
    sources: sources.map((s) => ({ comp: s.comp.id, name: s.comp.name, url: s.dribl.url, team: s.dribl.team || "" })),
    due
  });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const sent = body && typeof body === "object" && !Array.isArray(body) ? body.draws : null;
  if (!Array.isArray(sent) || sent.length === 0 || sent.some((d) => !d || typeof d !== "object" || Array.isArray(d) || typeof d.comp !== "string" || !d.comp)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (!mayPost(v)) return NextResponse.json({ error: COACH_ONLY }, { status: 403 });

  // Each draw must be for one of this team's Dribl competitions, once.
  const sources = driblSources(v.team);
  const draws = [];
  const seen = new Set();
  for (const d of sent) {
    const source = sources.find((s) => s.comp.id === d.comp);
    if (!source || seen.has(d.comp)) return NextResponse.json({ error: NOT_A_DRIBL_COMPETITION }, { status: 400 });
    const records = sanitizeDrawRecords(d.records);
    if (!records) return NextResponse.json({ error: "bad request" }, { status: 400 });
    seen.add(d.comp);
    draws.push({ comp: source.comp, records });
  }

  const applied = await applyDraws(v.team, draws, { source: "Dribl", stamp: "lastDriblSyncAt" });
  if (!applied) return NextResponse.json({ error: "no data" }, { status: 404 });
  return NextResponse.json({ ok: true, ...applied });
}
