import { NextResponse } from "next/server";
import { getData, getMeta } from "@/lib/store";
import { fetchSquadi } from "@/lib/squadiSync";
import { applyDraws } from "@/lib/applyDraws";
import { squadiSources, majestriSources, seasonNameOf } from "@/lib/competitions";
import { fetchMajestri } from "@/lib/majestriDraw";
import { getTeams } from "@/lib/teams";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { cronAuthorized } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";
const STALE_MS = 15 * 60 * 1000; // sync-on-visit throttle


// One team's sync. A team has one draw or several (lib/competitions.js): its
// season, which is two labelled feeds on a squad that plays as two teams,
// plus any other competition whose Squadi ids are complete. Each is applied
// in turn onto the same document, which is saved once. One draw failing (a
// competition not published yet, one side's feed down) never stops the
// others: it is listed under `failed` and the rest are applied. Only when
// every draw fails is the whole sync an error, as it was with one.
async function syncTeam(team, ifStale) {
  // Every draw the server reads itself: Squadi's, and any competition on
  // Majestri (lib/majestriDraw.js). A draw on Dribl is read by a coach's
  // browser instead (/api/dribl). Scores are only ever taken from another
  // competition whose set-up says so (`scores`); the season's are entered by
  // hand.
  const leave = (s, site) => (s.comp && s.scores ? { scoreFrom: site } : {});
  const sources = [
    ...squadiSources(team).map((s) => ({ ...s, provider: "Squadi", read: () => fetchSquadi(s.squadi), ...leave(s, "Squadi") })),
    ...majestriSources(team).map((s) => ({ comp: s.comp, provider: "Majestri", read: () => fetchMajestri(s.majestri), ...leave(s, "Majestri") }))
  ];
  if (!sources.length) return { team: team.slug, skipped: "no squadi config" };
  if (ifStale) {
    const meta = await getMeta(team.slug);
    if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < STALE_MS) {
      return { team: team.slug, skipped: "recent" };
    }
  }
  if (!(await getData(team.slug))) return { team: team.slug, skipped: "no team data yet" };

  // Fetch every draw first; the document is only read once they are all in
  // (applyDraws), so a reply or a score saved while Squadi was answering is
  // in the copy the sync applies to, not lost under it.
  const draws = await Promise.all(sources.map(async (src) => {
    try { return { ...src, records: await src.read() }; }
    catch (e) { return { ...src, error: String(e?.message || e) }; }
  }));
  // A failed draw is named the way people know it: the competition, the side
  // of a two-feed squad, or simply the season.
  const failed = draws.filter((d) => d.error).map((d) => ({ name: d.comp ? d.comp.name : d.side || seasonNameOf(team), ...(d.side ? { side: d.side } : {}), error: d.error }));
  if (failed.length === draws.length) throw new Error(failed[0].error);

  // The rest is the same for any draw, wherever it was fetched (lib/applyDraws.js).
  // `checked` names the sites whose draws came in, for "up to date with …".
  const ok = draws.filter((d) => !d.error);
  const checked = [...new Set(ok.map((d) => d.provider))];
  // Each draw names its provider, for the club logo library (lib/applyDraws.js).
  const applied = await applyDraws(team, ok.map((d) => ({ comp: d.comp, side: d.side, records: d.records, provider: d.provider.toLowerCase(), ...(d.scoreFrom ? { scoreFrom: d.scoreFrom } : {}) })), { source: checked.join(" and ") });
  if (!applied) return { team: team.slug, skipped: "no team data yet" };
  return { team: team.slug, ...applied, checked, ...(failed.length ? { failed } : {}) };
}

export async function GET(req) {
  const ifStale = !!new URL(req.url).searchParams.get("ifStale");

  // Cron / pinger (CRON_SECRET, as a Bearer header or ?key=): sync every
  // configured team. A signed-in viewer syncs their own team, below.
  if (cronAuthorized(req, { allowQueryKey: true })) {
    const results = [];
    for (const team of await getTeams()) {
      try {
        results.push(await syncTeam(team, ifStale));
      } catch (e) {
        results.push({ team: team.slug, ok: false, error: String(e?.message || e) });
      }
    }
    return NextResponse.json({ ok: true, results });
  }

  // Signed-in caller: sync just their team. A sync writes the team document,
  // so it is always a write (a super admin "viewing as" someone is refused).
  // The throttled sync-on-visit (?ifStale=1) is open to ANY hat — a parent
  // opening the dashboard keeps the fixtures near-live for everyone. A manual
  // sync (no ifStale, the /league "Sync now" button) needs the coach hat in
  // account mode; legacy team-code mode trusts anyone holding the code.
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && !ifStale && v.hat?.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const team = v.team;

  try {
    const result = await syncTeam(team, ifStale);
    return NextResponse.json({ ok: true, changes: [], ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
