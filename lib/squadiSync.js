// Server-side sync against Squadi's public fixtures endpoint.
// Conservative by design: only date/time/venue/opponent are ever written, keyed by
// Squadi match id. Scores, scorers, duties, availability, focus, videos are NEVER touched.
// If the response doesn't look like the expected shape, nothing is changed.
//
// A team can have more than one Squadi draw: its season, plus any other
// competition on the team's registry entry (lib/competitions.js). applySync
// runs once per draw. A game from another competition carries that
// competition's id and name (fixture.comp, fixture.compName), which is how the
// dashboard labels it and keeps it out of the season record.
//
// The season itself can be two draws: one squad that plays as two teams each
// round has two labelled feeds (lib/teams squadiFeeds), and a game carries
// its feed's label as fixture.side.

import { isRef } from "@/lib/clubLogos";
import { roundNameText } from "@/lib/rounds";

const pad2 = (n) => String(n).padStart(2, "0");
const uid = () => Math.random().toString(36).slice(2, 9);

// One team's draw. Exported for lib/squadiLookup.js, which reads the same
// address once when a fixtures link is pasted, to say what it found. A
// division of "All" (Squadi's own word for it in a link) is the team's games
// in every division of the competition: a tournament's group and its finals,
// which Squadi keeps as divisions of their own.
export const ALL_DIVISIONS = "All";
export const isAllDivisions = (divisionId) => String(divisionId ?? "").trim().toLowerCase() === "all";
export const apiUrl = (cfg) =>
  `https://api.squadi.com/livescores/round/matches?competitionId=${cfg.competitionId}${isAllDivisions(cfg.divisionId) ? "" : `&divisionId=${cfg.divisionId}`}&teamIds=[${cfg.teamId}]&ignoreStatuses=[1]`;

// A game's result as the competition confirmed it: final, locked by the
// competition, with a whole score for each side. Squadi shows 0-0 for every
// game of a draw that keeps no results (MiniRoos at U8, say), but never locks
// those, so a game whose result is not locked has no score here.
const whole = (n) => Number.isInteger(n) && n >= 0 && n < 1000;
export const confirmedScore = (m, home) => {
  if (!(m.resultStatus === "FINAL" && m.isResultsLocked === true && whole(m.team1Score) && whole(m.team2Score))) return null;
  const score = home ? { us: m.team1Score, them: m.team2Score } : { us: m.team2Score, them: m.team1Score };
  // A shootout, when a level game had one: the two sides' penalties differ.
  const p1 = m.team1PenaltyScore, p2 = m.team2PenaltyScore;
  const pens = score.us === score.them && whole(p1) && whole(p2) && p1 !== p2 ? (home ? { us: p1, them: p2 } : { us: p2, them: p1 }) : null;
  return pens ? { ...score, pens } : score;
};

// Brisbane is UTC+10 year-round (no DST in QLD).
function toBrisbane(utcIso) {
  const d = new Date(new Date(utcIso).getTime() + 10 * 3600 * 1000);
  return {
    dateISO: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  };
}

function fmt(iso, time) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) + (time ? " " + time : "");
}

// Normalize Squadi's response into simple fixture records.
export function normalize(json, cfg) {
  if (!json || !Array.isArray(json.rounds)) throw new Error("Unexpected Squadi response shape");
  const ourId = Number(cfg.teamId);
  const out = [];
  for (const r of json.rounds) {
    // A round's number is in its name ("Round 7"). A round named without one
    // takes its place in the draw: a season's "Finals" after six rounds is
    // round 7. A tournament's finals, kept in a division of their own, are
    // numbered past 99 ("Quarter Finals" is Squadi's 101st) and take no number:
    // such a game is named by its competition, as a final elsewhere is.
    const next = (r.sequence ?? 0) + 1;
    const roundNo = parseInt(String(r.name || "").replace(/\D/g, ""), 10) || (next > 0 && next < 100 ? next : null);
    for (const m of r.matches || []) {
      if (!m.startTime || !m.team1 || !m.team2) continue;
      const isBye = m.team1.name === "Bye" || m.team2.name === "Bye";
      if (isBye) { out.push({ squadiId: m.id, round: roundNo, bye: true }); continue; }
      const home = m.team1.id === ourId;
      const { dateISO, time } = toBrisbane(m.startTime);
      const score = confirmedScore(m, home);
      const venueName = m.venueCourt?.venue?.name || "";
      const field = m.venueCourt?.name ? String(m.venueCourt.name).trim() : "";
      // A round with no number (a tournament's finals) keeps its name.
      const roundName = roundNo == null ? roundNameText(r.name) : "";
      out.push({
        squadiId: m.id,
        round: roundNo,
        ...(roundName ? { roundName } : {}),
        dateISO,
        time,
        opponent: (home ? m.team2.name : m.team1.name).trim(),
        opponentLogo: (home ? m.team2 : m.team1).logoUrl || "",
        ourLogo: (home ? m.team1 : m.team2).logoUrl || "",
        // Squadi's own number for the team we play: how the club logo library
        // (lib/clubLogos.js) knows the same team in every game it plays.
        ...(Number.isInteger((home ? m.team2 : m.team1).id) ? { opponentRef: `squadi:team:${(home ? m.team2 : m.team1).id}` } : {}),
        homeAway: home ? "H" : "A",
        venue: field ? `${venueName} – ${field}` : venueName,
        substatus: m.matchSubstatusRefId ?? null,
        // Taken only for a competition set up to take its scores (applySync).
        ...(score ? { score } : {})
      });
    }
  }
  return out;
}

export async function fetchSquadi(cfg) {
  if (!cfg || !cfg.competitionId || !cfg.divisionId || !cfg.teamId) throw new Error("Team has no Squadi config");
  const res = await fetch(apiUrl(cfg), { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Squadi responded ${res.status}`);
  return normalize(await res.json(), cfg);
}

// Apply one Squadi draw onto our data. Returns { data, changes[], created, mutated }.
// comp is null for the season's draw and { id, name, ground? } for another
// competition's (lib/competitions.js: `ground` is where it is played).
// `side` is the feed's label on a two-feed squad: new fixtures carry it, a
// matched fixture has it stamped silently (saved, no change line), change
// lines lead with it, and the round-number fallback never adopts a fixture
// that already belongs to the other side.
// `scoreFrom` names the site a draw's scores may be taken from, and is given
// only for a competition whose set-up says its scores come from there (a
// competition on Majestri: lib/majestriDraw.js). Squadi's and Dribl's records
// carry no score, so the season's results are always entered by hand.
// The provider's own references for the team a game is against (its team, and
// on Dribl its club, when the game names it), kept on the game for the club
// logo library. Only a well-formed reference is kept; none sent keeps the one
// the game has.
const refsOf = (s) => ({
  ...(isRef(s.opponentRef) && /^(squadi|dribl):team:/.test(s.opponentRef) ? { opponentRef: s.opponentRef } : {}),
  ...(isRef(s.opponentClubRef) && s.opponentClubRef.startsWith("dribl:club:") ? { opponentClubRef: s.opponentClubRef } : {})
});

// A venue that is only a field, court or pitch ("Field 1", "Pitch 3A", "7"):
// what a draw gives when every game is at one ground.
const FIELD_ONLY = /^(?:(?:field|pitch|court|oval|diamond)\s*#?\s*(?:\d{1,3}[a-z]?|[a-z])|\d{1,3}[a-z]?)$/i;

export function applySync(data, squadi, { comp = null, side, scoreFrom = "" } = {}) {
  const fixtures = [...(data.fixtures || [])];
  // "Round 3" in the season, "McKay · Round 3" on a two-feed squad and
  // "Winterfest Round 3" elsewhere, so a change line (the notice, the email)
  // says which draw moved.
  // A game with no round number (a final, a pool game) is named by its
  // round's name when the draw gives one, else by its competition alone.
  const nameOf = (s) => (s.round ? "" : roundNameText(s.roundName));
  const roundOf = (s) => {
    const round = s.round ? `Round ${s.round}` : nameOf(s);
    return `${side ? side + " · " : ""}${comp ? [comp.name, round].filter(Boolean).join(" ") : round || "Game"}`;
  };
  // A competition played at one ground whose draw names only the field
  // ("Field 1"), or no place at all: the ground goes in front, the way Squadi
  // writes a venue ("Riverside Park – Field 1"), so the game says where it is
  // and Directions finds it. A venue the draw names in full is left as it is.
  const ground = typeof comp?.ground === "string" ? comp.ground.trim() : "";
  const placeOf = (s) => {
    const v = String(s.venue || "").trim();
    if (!ground) return v;
    if (!v) return ground;
    return FIELD_ONLY.test(v) ? `${ground} – ${v}` : v;
  };
  const tag = comp ? { comp: comp.id, compName: comp.name } : {};
  const sideTag = side ? { side } : {};
  const changes = [];
  const now = Date.now();
  // "Today" in Brisbane (UTC+10)
  const bd = new Date(now + 10 * 3600 * 1000);
  const todayISO = `${bd.getUTCFullYear()}-${pad2(bd.getUTCMonth() + 1)}-${pad2(bd.getUTCDate())}`;
  let created = 0;
  let mutated = false;
  // A game's score comes in from the draw only when the draw may give scores,
  // the game has a whole score there, and its day has come. It fills a game
  // with no score of its own and is never taken twice: a score in the app,
  // typed in or taken before, is never changed, and one a coach clears stays
  // cleared. A cancelled game takes none. Silent: a result is not a schedule
  // change, so there is no change line and no email.
  // A penalty shootout comes with a level score, when the draw gives one.
  const scoreOf = (s) => {
    const sc = scoreFrom && s.score && typeof s.score === "object" ? s.score : null;
    const whole = (n) => Number.isInteger(n) && n >= 0 && n < 1000;
    if (!(sc && whole(sc.us) && whole(sc.them) && s.dateISO <= todayISO)) return null;
    const p = sc.pens && typeof sc.pens === "object" ? sc.pens : null;
    const pens = p && sc.us === sc.them && whole(p.us) && whole(p.them) && p.us !== p.them ? { us: p.us, them: p.them } : null;
    return { us: sc.us, them: sc.them, ...(pens ? { pens } : {}) };
  };

  for (const s of squadi) {
    if (s.bye) continue; // byes aren't games to attend

    // Match by stored squadiId first, then by round number — but NEVER adopt
    // manually-created fixtures (carnivals, friendlies, non-Squadi games).
    // Only the season adopts by round: every competition has its own Round 1,
    // so another competition's draw matches its own games by id alone, and the
    // season never adopts a game that belongs to another competition. On a
    // two-feed squad each side has its own Round 1 too, so a side never adopts
    // the other side's game.
    let i = fixtures.findIndex((f) => f.squadiId === s.squadiId);
    if (i === -1 && !comp) i = fixtures.findIndex((f) => f.round === s.round && !f.squadiId && !f.manual && !f.comp && (!side || !f.side || f.side === side));

    const venue = placeOf(s);
    const roundName = nameOf(s);
    if (i === -1) {
      const score = scoreOf(s);
      fixtures.push({
        id: uid(), squadiId: s.squadiId, round: s.round, ...(roundName ? { roundName } : {}), ...sideTag,
        dateISO: s.dateISO, time: s.time, opponent: s.opponent, venue,
        opponentLogo: s.opponentLogo || "", ourLogo: s.ourLogo || "", ...refsOf(s),
        homeAway: s.homeAway, status: score || s.dateISO < todayISO ? "played" : "upcoming",
        us: score ? score.us : null, them: score ? score.them : null, ...(score ? { scoreFrom, ...(score.pens ? { pens: score.pens } : {}) } : {}),
        fruit: "", gk: "", goals: [], assists: [], notes: "",
        ...tag,
        schedChanges: [{ field: "New game", oldText: "", newText: `${fmt(s.dateISO, s.time)} @ ${venue}`, at: now }]
      });
      created++;
      mutated = true;
      changes.push(`NEW — ${roundOf(s)} vs ${s.opponent}: ${fmt(s.dateISO, s.time)} @ ${venue}`);
      continue;
    }

    const f = fixtures[i];
    const diffs = [];
    const entries = [];
    if (f.dateISO !== s.dateISO || f.time !== s.time) {
      diffs.push(`time ${f.dateISO ? `${fmt(f.dateISO, f.time)} → ` : ""}${fmt(s.dateISO, s.time)}`);
      entries.push({ field: "Time", oldText: f.dateISO ? fmt(f.dateISO, f.time) : "", newText: fmt(s.dateISO, s.time), at: now });
    }
    // The ground put in front of a field the draw has not moved is not a
    // change of place (the set-up was given the ground, or a new name for
    // it), so it is made without a word: only a field or a venue the draw
    // changed is news.
    const prior = f.venue || "";
    const field = String(s.venue || "").trim();
    const sameField = (FIELD_ONLY.test(field) && (prior === field || prior.endsWith(` – ${field}`))) || (!field && !prior);
    const placeChanged = prior !== venue;
    if (placeChanged && !sameField) {
      diffs.push(`venue ${prior ? `"${prior}" → ` : ""}"${venue}"`);
      entries.push({ field: "Venue", oldText: prior, newText: venue, at: now });
    }
    if ((f.opponent || "") !== s.opponent) {
      diffs.push(`opponent ${f.opponent ? `"${f.opponent}" → ` : ""}"${s.opponent}"`);
      entries.push({ field: "Opponent", oldText: f.opponent || "", newText: s.opponent, at: now });
    }

    if (diffs.length) changes.push(`${roundOf(s)} vs ${s.opponent}: ${diffs.join("; ")}`);

    // A logo fill-in or status roll-forward must persist even when there's no
    // visible schedule change — otherwise crests are computed and then discarded.
    const statusFwd = f.status === "upcoming" && s.dateISO < todayISO;
    const logoChanged = (s.opponentLogo && s.opponentLogo !== (f.opponentLogo || "")) ||
      (s.ourLogo && s.ourLogo !== (f.ourLogo || "")) ||
      Object.entries(refsOf(s)).some(([k, v]) => f[k] !== v);
    // Which draw a game came back in is the truth about its competition: a
    // renamed competition renames its games, and a game the season's draw
    // returns is a season game whatever it was tagged before. Silent, like logos.
    const tagChanged = comp ? (f.comp !== comp.id || f.compName !== comp.name) : ("comp" in f || "compName" in f);
    // Likewise the side: a matched game takes its feed's label, silently.
    const sideChanged = !!side && f.side !== side;
    const score = f.status !== "cancelled" && f.us == null && f.them == null && !f.scoreFrom ? scoreOf(s) : null;
    // A round's name follows the draw, silently, like the tags.
    const roundNameChanged = (f.roundName || "") !== roundName;
    if (entries.length || statusFwd || logoChanged || tagChanged || sideChanged || score || placeChanged || roundNameChanged) mutated = true;

    // Write only schedule fields, and a score only as above; everything else on
    // the fixture is preserved.
    // Status flips forward (upcoming -> played) once the date passes; never backward,
    // and a coach-set "played" is never undone. Silent: not a schedule change.
    const keptChanges = (f.schedChanges || []).filter((c) => now - (c.at || 0) < 14 * 86400000);
    const { comp: _comp, compName: _compName, roundName: _roundName, ...untagged } = f;
    fixtures[i] = {
      ...untagged, ...tag, squadiId: s.squadiId, round: s.round, ...(roundName ? { roundName } : {}), ...sideTag,
      dateISO: s.dateISO, time: s.time, venue,
      opponent: s.opponent, homeAway: s.homeAway,
      opponentLogo: s.opponentLogo || f.opponentLogo || "", ourLogo: s.ourLogo || f.ourLogo || "", ...refsOf(s),
      status: f.status === "upcoming" && (score || s.dateISO < todayISO) ? "played" : f.status,
      ...(score ? { us: score.us, them: score.them, ...(score.pens ? { pens: score.pens } : {}), scoreFrom } : {}),
      schedChanges: [...keptChanges, ...entries].slice(-6)
    };
  }

  return { data: { ...data, fixtures, isSample: false }, changes, created, mutated };
}
