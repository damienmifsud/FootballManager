// Server-side sync against Squadi's public fixtures endpoint.
// Conservative by design: only date/time/venue/opponent are ever written, keyed by
// Squadi match id. Scores, scorers, duties, availability, focus, videos are NEVER touched.
// If the response doesn't look like the expected shape, nothing is changed.

const COMPETITION_ID = process.env.SQUADI_COMPETITION_ID || "1439"; // Metro Coles MiniRoos & U12 (2026)
const DIVISION_ID = process.env.SQUADI_DIVISION_ID || "10661"; // U8 Kangaroo K1 Central Hub
const TEAM_ID = Number(process.env.SQUADI_TEAM_ID || "110013"); // Olympic FC U8 Kangaroos WHITE

const API = `https://api.squadi.com/livescores/round/matches?competitionId=${COMPETITION_ID}&divisionId=${DIVISION_ID}&teamIds=[${TEAM_ID}]&ignoreStatuses=[1]`;

const pad2 = (n) => String(n).padStart(2, "0");
const uid = () => Math.random().toString(36).slice(2, 9);

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
export function normalize(json) {
  if (!json || !Array.isArray(json.rounds)) throw new Error("Unexpected Squadi response shape");
  const out = [];
  for (const r of json.rounds) {
    const roundNo = parseInt(String(r.name || "").replace(/\D/g, ""), 10) || (r.sequence ?? 0) + 1;
    for (const m of r.matches || []) {
      if (!m.startTime || !m.team1 || !m.team2) continue;
      const isBye = m.team1.name === "Bye" || m.team2.name === "Bye";
      if (isBye) { out.push({ squadiId: m.id, round: roundNo, bye: true }); continue; }
      const home = m.team1.id === TEAM_ID;
      const { dateISO, time } = toBrisbane(m.startTime);
      const venueName = m.venueCourt?.venue?.name || "";
      const field = m.venueCourt?.name ? String(m.venueCourt.name).trim() : "";
      out.push({
        squadiId: m.id,
        round: roundNo,
        dateISO,
        time,
        opponent: (home ? m.team2.name : m.team1.name).trim(),
        homeAway: home ? "H" : "A",
        venue: field ? `${venueName} – ${field}` : venueName,
        substatus: m.matchSubstatusRefId ?? null
      });
    }
  }
  return out;
}

export async function fetchSquadi() {
  const res = await fetch(API, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Squadi responded ${res.status}`);
  return normalize(await res.json());
}

// Apply Squadi fixtures onto our data. Returns { data, changes[], created, skipped }.
export function applySync(data, squadi) {
  const fixtures = [...(data.fixtures || [])];
  const changes = [];
  const now = Date.now();
  let created = 0;

  for (const s of squadi) {
    if (s.bye) continue; // byes aren't games to attend

    // Match by stored squadiId first, then by round number — but NEVER adopt
    // manually-created fixtures (carnivals, friendlies, non-Squadi games).
    let i = fixtures.findIndex((f) => f.squadiId === s.squadiId);
    if (i === -1) i = fixtures.findIndex((f) => f.round === s.round && !f.squadiId && !f.manual);

    if (i === -1) {
      fixtures.push({
        id: uid(), squadiId: s.squadiId, round: s.round,
        dateISO: s.dateISO, time: s.time, opponent: s.opponent, venue: s.venue,
        homeAway: s.homeAway, status: "upcoming", us: null, them: null,
        fruit: "", gk: "", goals: [], assists: [], notes: "",
        schedChanges: [{ field: "New game", oldText: "", newText: `${fmt(s.dateISO, s.time)} @ ${s.venue}`, at: now }]
      });
      created++;
      changes.push(`NEW — Round ${s.round} vs ${s.opponent}: ${fmt(s.dateISO, s.time)} @ ${s.venue}`);
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

    if (diffs.length) changes.push(`Round ${s.round} vs ${s.opponent}: ${diffs.join("; ")}`);

    // Write only schedule fields; everything else on the fixture is preserved.
    const keptChanges = (f.schedChanges || []).filter((c) => now - (c.at || 0) < 14 * 86400000);
    fixtures[i] = {
      ...f, squadiId: s.squadiId, round: s.round,
      dateISO: s.dateISO, time: s.time, venue: s.venue,
      opponent: s.opponent, homeAway: s.homeAway,
      schedChanges: [...keptChanges, ...entries].slice(-6)
    };
  }

  return { data: { ...data, fixtures, isSample: false }, changes, created };
}
