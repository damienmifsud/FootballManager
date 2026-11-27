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
export const confirmedScore = (m, home) =>
  m.resultStatus === "FINAL" && m.isResultsLocked === true && whole(m.team1Score) && whole(m.team2Score)
    ? (home ? { us: m.team1Score, them: m.team2Score } : { us: m.team2Score, them: m.team1Score })
    : null;

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
      out.push({
        squadiId: m.id,
        round: roundNo,
        dateISO,
        time,
        opponent: (home ? m.team2.name : m.team1.name).trim(),
        opponentLogo: (home ? m.team2 : m.team1).logoUrl || "",
        ourLogo: (home ? m.team1 : m.team2).logoUrl || "",
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
// comp is null for the season's draw and { id, name } for another competition's.
// `side` is the feed's label on a two-feed squad: new fixtures carry it, a
// matched fixture has it stamped silently (saved, no change line), change
// lines lead with it, and the round-number fallback never adopts a fixture
// that already belongs to the other side.
// `scoreFrom` names the site a draw's scores may be taken from, and is given
// only for a competition whose set-up says its scores come from there (a
// competition on Majestri: lib/majestriDraw.js). Squadi's and Dribl's records
// carry no score, so the season's results are always entered by hand.
export function applySync(data, squadi, { comp = null, side, scoreFrom = "" } = {}) {
  const fixtures = [...(data.fixtures || [])];
  // "Round 3" in the season, "McKay · Round 3" on a two-feed squad and
  // "Winterfest Round 3" elsewhere, so a change line (the notice, the email)
  // says which draw moved.
  // A game with no round (a final, a pool game) is named by its competition alone.
  const roundOf = (s) => {
    const round = s.round ? `Round ${s.round}` : "";
    return `${side ? side + " · " : ""}${comp ? [comp.name, round].filter(Boolean).join(" ") : round || "Game"}`;
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
  const scoreOf = (s) => {
    const sc = scoreFrom && s.score && typeof s.score === "object" ? s.score : null;
    const whole = (n) => Number.isInteger(n) && n >= 0 && n < 1000;
    return sc && whole(sc.us) && whole(sc.them) && s.dateISO <= todayISO ? { us: sc.us, them: sc.them } : null;
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

    if (i === -1) {
      const score = scoreOf(s);
      fixtures.push({
        id: uid(), squadiId: s.squadiId, round: s.round, ...sideTag,
        dateISO: s.dateISO, time: s.time, opponent: s.opponent, venue: s.venue,
        opponentLogo: s.opponentLogo || "", ourLogo: s.ourLogo || "",
        homeAway: s.homeAway, status: score || s.dateISO < todayISO ? "played" : "upcoming",
        us: score ? score.us : null, them: score ? score.them : null, ...(score ? { scoreFrom } : {}),
        fruit: "", gk: "", goals: [], assists: [], notes: "",
        ...tag,
        schedChanges: [{ field: "New game", oldText: "", newText: `${fmt(s.dateISO, s.time)} @ ${s.venue}`, at: now }]
      });
      created++;
      mutated = true;
      changes.push(`NEW — ${roundOf(s)} vs ${s.opponent}: ${fmt(s.dateISO, s.time)} @ ${s.venue}`);
      continue;
    }

    const f = fixtures[i];
    const diffs = [];
    const entries = [];
    if (f.dateISO !== s.dateISO || f.time !== s.time) {
      diffs.push(`time ${f.dateISO ? `${fmt(f.dateISO, f.time)} → ` : ""}${fmt(s.dateISO, s.time)}`);
      entries.push({ field: "Time", oldText: f.dateISO ? fmt(f.dateISO, f.time) : "", newText: fmt(s.dateISO, s.time), at: now });
    }
    if ((f.venue || "") !== s.venue) {
      diffs.push(`venue ${f.venue ? `"${f.venue}" → ` : ""}"${s.venue}"`);
      entries.push({ field: "Venue", oldText: f.venue || "", newText: s.venue, at: now });
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
      (s.ourLogo && s.ourLogo !== (f.ourLogo || ""));
    // Which draw a game came back in is the truth about its competition: a
    // renamed competition renames its games, and a game the season's draw
    // returns is a season game whatever it was tagged before. Silent, like logos.
    const tagChanged = comp ? (f.comp !== comp.id || f.compName !== comp.name) : ("comp" in f || "compName" in f);
    // Likewise the side: a matched game takes its feed's label, silently.
    const sideChanged = !!side && f.side !== side;
    const score = f.status !== "cancelled" && f.us == null && f.them == null && !f.scoreFrom ? scoreOf(s) : null;
    if (entries.length || statusFwd || logoChanged || tagChanged || sideChanged || score) mutated = true;

    // Write only schedule fields, and a score only as above; everything else on
    // the fixture is preserved.
    // Status flips forward (upcoming -> played) once the date passes; never backward,
    // and a coach-set "played" is never undone. Silent: not a schedule change.
    const keptChanges = (f.schedChanges || []).filter((c) => now - (c.at || 0) < 14 * 86400000);
    const { comp: _comp, compName: _compName, ...untagged } = f;
    fixtures[i] = {
      ...untagged, ...tag, squadiId: s.squadiId, round: s.round, ...sideTag,
      dateISO: s.dateISO, time: s.time, venue: s.venue,
      opponent: s.opponent, homeAway: s.homeAway,
      opponentLogo: s.opponentLogo || f.opponentLogo || "", ourLogo: s.ourLogo || f.ourLogo || "",
      status: f.status === "upcoming" && (score || s.dateISO < todayISO) ? "played" : f.status,
      ...(score ? { us: score.us, them: score.them, scoreFrom } : {}),
      schedChanges: [...keptChanges, ...entries].slice(-6)
    };
  }

  return { data: { ...data, fixtures, isSample: false }, changes, created, mutated };
}
