// Bulk import of training sessions and games from a CSV file or a pasted
// list. Pure: text in, sessions and fixtures out, then a merge that never
// adds the same thing twice. The dashboard's import sheet does the file
// reading and the saving.
//
// Two shapes are read, detected automatically:
//  (a) A header row naming the columns. Any order, extra columns ignored:
//        Type, Date, Start, Finish (or Duration), Title, Opponent,
//        Home or away, Venue, Round, Notes, Repeat, Until, Score
//      A row is a game when its Type says so or it has an opponent; otherwise
//      it is whatever the sheet was opened for (training by default).
//      An XPS Network import file works as it is: Session Type
//      (Game/Practice/Event), Team/Group, Date, Time, Duration (minutes),
//      Arrive X min before, Label, Notes, Location, Location Description.
//      Its Coach's Notes column is never read: session notes are for
//      everyone.
//  (b) No header: one item per line.
//        training: Date, start, finish, location, title, notes
//        games:    Date, time, opponent, home or away, venue, round
//      Times and the later cells are optional.
//
// Dates are day first (12/01/2027, 12 Jan 2027, Tue 12 Jan) or ISO. A date
// with no year means its next occurrence. Times are 17:30, 5:30pm, 5.30 pm or
// a range (5-6pm) in the start cell; a bare 1-6 o'clock is taken as pm, which
// the preview shows before anything is saved.
import { splitCSV } from "@/lib/majestri";
import { occurrences } from "@/lib/dashboardData";

const uid = () => Math.random().toString(36).slice(2, 9);
const pad = (n) => String(n).padStart(2, "0");
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const clean = (s) => String(s ?? "").trim();

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDaysISO = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// A day-first date in any of the usual spellings -> "yyyy-mm-dd", or "".
export function parseDate(raw, todayISO = isoToday()) {
  let t = clean(raw).replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return "";
  t = t.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s+/i, ""); // "Tue 12 Jan"
  t = t.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");                      // "12th"
  let y = null, m = 0, d = 0, x;
  if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = t.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2}|\d{4}))?$/))) { d = +x[1]; m = +x[2]; y = x[3] ? +x[3] : null; }
  else if ((x = t.match(/^(\d{1,2})[ \-]([A-Za-z]{3,})\.?(?:[ \-](\d{2}|\d{4}))?$/))) { d = +x[1]; m = MONTHS[x[2].slice(0, 3).toLowerCase()] || 0; y = x[3] ? +x[3] : null; }
  else if ((x = t.match(/^([A-Za-z]{3,})\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/))) { m = MONTHS[x[1].slice(0, 3).toLowerCase()] || 0; d = +x[2]; y = x[3] ? +x[3] : null; }
  else return "";
  if (!m || !d) return "";
  if (y != null && y < 100) y += 2000;
  const valid = (yy) => { const dt = new Date(Date.UTC(yy, m - 1, d)); return dt.getUTCFullYear() === yy && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d; };
  if (y == null) {
    // No year: the next time that date comes round (a month's grace for a
    // list pasted just after it started).
    const from = addDaysISO(todayISO, -30);
    y = +todayISO.slice(0, 4);
    if (!valid(y) || `${y}-${pad(m)}-${pad(d)}` < from) y += 1;
  }
  return valid(y) ? `${y}-${pad(m)}-${pad(d)}` : "";
}

// One clock time -> "HH:MM", or "". `pm` forces the afternoon ("5" in "5-6pm").
export function parseTime(raw, { pm = false } = {}) {
  const t = clean(raw).toLowerCase().replace(/\./g, ":").replace(/\s+/g, "");
  if (!t) return "";
  if (t === "noon" || t === "midday") return "12:00";
  const x = t.match(/^(\d{1,2})(?::?(\d{2}))?(?::\d{2})?(am|pm|a|p)?$/);
  if (!x) return "";
  let h = +x[1];
  const min = x[2] ? +x[2] : 0;
  const mark = x[3] ? x[3][0] : "";
  if (h > 23 || min > 59) return "";
  if (mark) {
    if (h < 1 || h > 12) return "";
    if (mark === "p" && h < 12) h += 12;
    if (mark === "a" && h === 12) h = 0;
  } else if (pm) {
    if (h < 12) h += 12;
  } else if (h >= 1 && h <= 6 && x[1].length === 1) {
    h += 12; // "5:30" at a football club is the afternoon
  }
  return `${pad(h)}:${pad(min)}`;
}

// A start cell that may hold a range ("5-6pm", "17:00 - 18:30", "5pm to 6pm").
export function parseTimeRange(raw) {
  const t = clean(raw);
  if (!t) return { time: "", endTime: "" };
  const parts = t.split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/i).filter(Boolean);
  if (parts.length === 2) {
    const endTime = parseTime(parts[1]);
    const endIsPm = /p/i.test(parts[1]) && !/[ap]/i.test(parts[0].replace(/[^a-z]/gi, ""));
    const time = parseTime(parts[0], { pm: endIsPm });
    if (time && endTime) return { time, endTime };
  }
  return { time: parseTime(t), endTime: "" };
}

const KIND_WORDS = [
  ["game", /game|match|fixture|friendly|trial/i],
  ["carnival", /carnival|tournament|gala|cup\b/i],
  ["training", /train|session|practice|practise/i],
  ["event", /event|activity|social|meeting|photo|presentation|party|bbq/i]
];
// What a Type cell says: "game", "training", "event", "carnival", or "".
export function kindOf(raw) {
  const t = clean(raw);
  if (!t) return "";
  for (const [kind, re] of KIND_WORDS) if (re.test(t)) return kind;
  return "";
}

// "Home", "H", "Away", "A", "@" -> "H" | "A" | "".
export function homeAwayOf(raw) {
  const t = clean(raw).toLowerCase();
  if (/^(h|home)$/.test(t)) return "H";
  if (/^(a|away|@)$/.test(t)) return "A";
  return "";
}

// "3-1", "3 : 1", "3–1" -> [3, 1] (ours first), or null.
function parseScore(raw) {
  const x = clean(raw).match(/^(\d{1,2})\s*[-–—:]\s*(\d{1,2})$/);
  return x ? [+x[1], +x[2]] : null;
}

const HEADERS = {
  type: ["type", "kind", "category", "what", "session type"],
  date: ["date", "day", "when", "session date", "game date", "match date"],
  start: ["start", "start time", "time", "kick off", "kickoff", "kick-off", "ko", "from"],
  end: ["finish", "finish time", "end", "end time", "to", "finishes"],
  duration: ["duration", "length", "minutes", "mins"],
  arrive: ["arrive x min before", "arrive before", "arrive early", "arrive"],
  title: ["title", "name", "session", "activity", "description", "event", "label"],
  group: ["team/group", "team", "group", "squad"],
  locationNote: ["location description", "location notes", "venue notes", "directions"],
  opponent: ["opponent", "opposition", "versus", "vs", "against", "playing"],
  homeAway: ["home or away", "home/away", "h/a", "home away", "homeaway", "h or a"],
  venue: ["venue", "location", "where", "ground", "field", "place", "address"],
  round: ["round", "rd", "rnd"],
  notes: ["notes", "note", "comments", "comment", "info", "details"],
  repeat: ["repeat", "repeats", "recurs", "frequency", "every"],
  until: ["until", "last date", "end date", "ends", "repeat until"],
  score: ["score", "result"],
  us: ["us", "our score", "goals for", "for", "gf"],
  them: ["them", "their score", "goals against", "ga"]
};
// A header cell -> the column it names. A hint in brackets is dropped first
// ("Duration (minutes)", "Session Type (Game/Practice/Event)"). Anything not
// listed, "Coach's Notes" included, is left unread.
const headerKey = (cell) => {
  const t = clean(cell).toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return Object.keys(HEADERS).find((k) => HEADERS[k].includes(t)) || "";
};

// "16:30" + 75 minutes -> "17:45" (never past midnight).
function addMinutes(time, minutes) {
  if (!time || !(minutes > 0)) return "";
  const total = Math.min(+time.slice(0, 2) * 60 + +time.slice(3, 5) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
const joinNotes = (...parts) => parts.map(clean).filter(Boolean).join(" ");

const DEFAULT_TITLE = { training: "Training", event: "Team event", carnival: "Carnival" };

// Text -> rows. A line break inside a quoted cell (a note typed over two
// lines in a spreadsheet) stays in its cell instead of starting a new row.
// Quotes that never close are not a spreadsheet's doing, so then every line
// is its own row.
function splitRows(text) {
  const rows = [];
  let cur = "", quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === "\n" && !quoted) { rows.push(cur); cur = ""; } else cur += ch;
  }
  rows.push(cur);
  return quoted ? text.split("\n") : rows;
}

// Parse text into { sessions, fixtures, problems, hasHeader }. `mode` is what
// a row is when nothing on it says otherwise: "training" or "games".
export function parseScheduleImport(text, { mode = "training", todayISO = isoToday() } = {}) {
  // An uploaded file can start with a byte-order mark, which would hide the first header.
  // Each row keeps its place in the file (blank lines counted), so a skipped
  // row is reported by the number a spreadsheet shows beside it.
  const kept = splitRows(String(text || "").replace(/^\uFEFF/, "")).map((l, i) => [l.replace(/\r$/, ""), i + 1]).filter(([l]) => l.trim());
  const lines = kept.map(([l]) => l), rowNo = kept.map(([, n]) => n);
  // A line break inside a cell reads as a space.
  const split = (line) => (line.includes("\t") ? line.split("\t") : splitCSV(line)).map((c) => c.replace(/\s*\r?\n\s*/g, " ").trim());
  const rows = lines.map(split);
  const sessions = [], fixtures = [], problems = [];
  // Which team or group each item's row named, by item id (an XPS file can
  // carry several teams); kept beside the items so it is never saved on them.
  const groupOf = new Map();
  if (!rows.length) return { sessions, fixtures, problems, hasHeader: false, groups: [], groupOf };

  // A header is a first row that names a date column and at least one other.
  const keys = rows[0].map(headerKey);
  const hasHeader = keys.includes("date") && keys.filter(Boolean).length >= 2;
  const fail = (n, line, reason) => problems.push({ row: n, text: clean(line).slice(0, 60), reason });

  const addGame = (n, line, g) => {
    if (!g.dateISO) return fail(n, line, "no date it can read");
    if (!g.opponent) return fail(n, line, "no opponent");
    const round = /^\d{1,3}$/.test(clean(g.round)) ? +g.round : null;
    const score = g.score || null;
    fixtures.push({
      id: uid(), round, dateISO: g.dateISO, time: g.time || "", opponent: g.opponent.slice(0, 60), venue: clean(g.venue).slice(0, 120),
      homeAway: g.homeAway || "H", status: score ? "played" : "upcoming", us: score ? score[0] : null, them: score ? score[1] : null,
      fruit: "", gk: "", goals: [], assists: [], notes: clean(g.notes).slice(0, 500), video: "", chapters: [], manual: true
    });
    groupOf.set(fixtures[fixtures.length - 1].id, clean(g.group));
  };
  const addSession = (n, line, s) => {
    if (!s.dateISO) return fail(n, line, "no date it can read");
    const kind = s.kind === "event" || s.kind === "carnival" ? s.kind : "training";
    const base = {
      id: uid(), title: clean(s.title).slice(0, 80) || DEFAULT_TITLE[kind], kind,
      time: s.time || "", endTime: s.endTime || "", location: clean(s.location).slice(0, 120), notes: clean(s.notes).slice(0, 500)
    };
    const weekly = kind !== "carnival" && /week|every/i.test(clean(s.repeat));
    if (weekly) {
      const untilISO = parseDate(s.until, todayISO);
      if (clean(s.until) && !untilISO) return fail(n, line, "an Until date it can't read");
      if (untilISO && untilISO < s.dateISO) return fail(n, line, "an Until date before its start");
      sessions.push({ ...base, recur: "weekly", weekday: new Date(s.dateISO + "T00:00:00").getDay(), startISO: s.dateISO, untilISO, dateISO: "" });
    } else {
      sessions.push({ ...base, recur: "once", dateISO: s.dateISO });
    }
    groupOf.set(base.id, clean(s.group));
  };
  // "vs City", "v City", "@ City", "at City" -> the name, and Away for the last two.
  const opponentOf = (raw) => {
    const t = clean(raw);
    const away = /^(@|at\s|away\s+(to|at|v|vs)\s)/i.test(t);
    return { name: t.replace(/^(@|at\s|away\s+(to|at|v|vs)\s|home\s+(to|v|vs)\s|vs?\.?\s)\s*/i, "").trim(), away };
  };

  if (hasHeader) {
    const at = (k) => keys.indexOf(k);
    rows.slice(1).forEach((r, i) => {
      const n = rowNo[i + 1], line = lines[i + 1];
      const get = (k) => (at(k) >= 0 && at(k) < r.length ? clean(r[at(k)]) : "");
      if (!r.some((c) => clean(c))) return;
      const typed = kindOf(get("type"));
      const opp = opponentOf(get("opponent"));
      const isGame = typed === "game" || (!typed && (opp.name || mode === "games"));
      const dateISO = parseDate(get("date"), todayISO);
      const range = parseTimeRange(get("start"));
      const mins = /^\d{1,3}$/.test(get("duration")) ? +get("duration") : 0;
      const endTime = parseTime(get("end"), { pm: !!range.time && +range.time.slice(0, 2) >= 12 }) || range.endTime || addMinutes(range.time, mins);
      const early = /^\d{1,3}$/.test(get("arrive")) && +get("arrive") > 0 ? `Arrive ${+get("arrive")} minutes early.` : "";
      const notes = joinNotes(get("notes"), get("locationNote"), early);
      const group = get("group");
      if (isGame) {
        // In a games file the "Title" column is as good a place as any for the opponent.
        const o = opp.name ? opp : opponentOf(get("title"));
        const ours = get("us"), theirs = get("them");
        const score = parseScore(get("score")) || (/^\d{1,2}$/.test(ours) && /^\d{1,2}$/.test(theirs) ? [+ours, +theirs] : null);
        addGame(n, line, { dateISO, time: range.time, opponent: o.name, homeAway: homeAwayOf(get("homeAway")) || (o.away ? "A" : ""), venue: get("venue"), round: get("round"), notes, score, group });
      } else {
        addSession(n, line, { dateISO, kind: typed, title: get("title"), time: range.time, endTime, location: get("venue"), notes, repeat: get("repeat"), until: get("until"), group });
      }
    });
  } else {
    rows.forEach((r, i) => {
      const n = rowNo[i], line = lines[i];
      const cells = r.map(clean);
      const dateISO = parseDate(cells[0], todayISO);
      let k = 1;
      const range = parseTimeRange(cells[k]);
      let time = "", endTime = "";
      if (range.time) { time = range.time; endTime = range.endTime; k += 1; }
      if (mode === "games") {
        const o = opponentOf(cells[k]); k += 1;
        let homeAway = o.away ? "A" : "";
        if (homeAwayOf(cells[k])) { homeAway = homeAwayOf(cells[k]); k += 1; }
        addGame(n, line, { dateISO, time, opponent: o.name, homeAway, venue: cells[k], round: cells[k + 1], notes: cells[k + 2] });
      } else {
        if (!endTime && time && parseTime(cells[k])) { endTime = parseTime(cells[k], { pm: +time.slice(0, 2) >= 12 }); k += 1; }
        addSession(n, line, { dateISO, kind: "training", time, endTime, location: cells[k], title: cells[k + 1], notes: cells[k + 2] });
      }
    });
  }
  const groups = [...new Set([...groupOf.values()].filter(Boolean))];
  return { sessions, fixtures, problems, hasHeader, groups, groupOf };
}

// Keep only the items whose row named one of these teams or groups (an item
// with no group named is always kept).
export function onlyGroups(parsed, wanted) {
  const want = new Set(wanted || []);
  const keep = (x) => { const g = parsed.groupOf?.get(x.id) || ""; return !g || want.has(g); };
  return { ...parsed, sessions: parsed.sessions.filter(keep), fixtures: parsed.fixtures.filter(keep) };
}

const key = (s) => clean(s).toLowerCase().replace(/\s+/g, " ");
const sessionKey = (s) => (s.recur === "weekly"
  ? ["w", s.kind || "training", s.weekday, s.time || "", key(s.title), s.startISO || "", s.untilISO || ""]
  : ["o", s.kind || "training", s.dateISO || "", s.time || "", key(s.title)]).join("|");

// Fold parsed sessions and games into the team document's lists without
// adding anything twice. A session already there (same kind, date, start time
// and title) is left as it is, except that a blank finish time, location or
// note is filled in. A game already there (same date and opponent, and the
// same time when both have one) is treated the same way for its time, venue
// and round. Nothing already entered is overwritten. Pure.
//
// A dated session that lands on a weekly session's own day and start time
// (inside `season`, the window that will apply once the import is saved) is
// already on the calendar and is not added on top of it.
export function mergeSchedule(data, parsed, { season = null } = {}) {
  const sessions = [...((data && data.sessions) || [])];
  const fixtures = [...((data && data.fixtures) || [])];
  const out = { sessions, fixtures, addedSessions: [], addedFixtures: [], updated: 0, unchanged: 0, covered: 0 };
  const weeklies = sessions.filter((w) => w && w.recur === "weekly");
  const coveredByWeekly = (s) => s.recur === "once" && s.dateISO && weeklies.some((w) =>
    (w.kind || "training") === (s.kind || "training") && (w.time || "") === (s.time || "") &&
    occurrences(w, +s.dateISO.slice(0, 4), season).includes(s.dateISO));
  const fillBlanks = (cur, next, fields) => {
    const patch = {};
    for (const f of fields) if ((cur[f] == null || cur[f] === "") && next[f] != null && next[f] !== "") patch[f] = next[f];
    return patch;
  };

  const seen = new Map(sessions.map((s, i) => [sessionKey(s), i]));
  for (const s of (parsed && parsed.sessions) || []) {
    const k = sessionKey(s);
    if (!seen.has(k) && coveredByWeekly(s)) { out.covered += 1; continue; }
    if (!seen.has(k)) { seen.set(k, sessions.length); sessions.push(s); out.addedSessions.push(s); continue; }
    const i = seen.get(k);
    const patch = fillBlanks(sessions[i], s, ["endTime", "location", "notes"]);
    if (Object.keys(patch).length) { sessions[i] = { ...sessions[i], ...patch }; out.updated += 1; } else out.unchanged += 1;
  }

  const taken = new Set();
  for (const g of (parsed && parsed.fixtures) || []) {
    const i = fixtures.findIndex((f, idx) => !taken.has(idx) && f && f.dateISO === g.dateISO && key(f.opponent) === key(g.opponent) && (!f.time || !g.time || f.time === g.time));
    if (i === -1) { taken.add(fixtures.length); fixtures.push(g); out.addedFixtures.push(g); continue; }
    taken.add(i);
    const patch = fillBlanks(fixtures[i], g, ["time", "venue", "round"]);
    if (Object.keys(patch).length) { fixtures[i] = { ...fixtures[i], ...patch }; out.updated += 1; } else out.unchanged += 1;
  }
  return out;
}

// Taking an import back. What an import adds is stamped with when it was made
// (`imported`, the same on every item of that import), so the whole lot can be
// found and removed later instead of one session at a time.

// A merge result -> its two lists, with the items this import added stamped.
export function stampImport(merged, stamp) {
  const ids = new Set([...merged.addedSessions, ...merged.addedFixtures].map((x) => x.id));
  const mark = (x) => (ids.has(x.id) ? { ...x, imported: stamp } : x);
  return { sessions: merged.sessions.map(mark), fixtures: merged.fixtures.map(mark) };
}

// A game that has been played is part of the season's record, so removing an
// import leaves it where it is.
const isPlayed = (f) => f.status === "played" || f.us != null || f.them != null;

// The imports still on the team's lists, newest first: how many sessions and
// games each would remove, and how many played games it would leave.
export function importBatches(data) {
  const by = new Map();
  const at = (stamp) => { if (!by.has(stamp)) by.set(stamp, { stamp, sessions: 0, games: 0, played: 0 }); return by.get(stamp); };
  for (const s of (data && data.sessions) || []) if (s && s.imported) at(s.imported).sessions += 1;
  for (const f of (data && data.fixtures) || []) if (f && f.imported) at(f.imported)[isPlayed(f) ? "played" : "games"] += 1;
  return [...by.values()].filter((b) => b.sessions + b.games > 0).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
}

// The team's lists without one import: its sessions and its unplayed games go
// (with the replies on them); played games stay. A game that belonged to a
// removed carnival becomes an ordinary fixture, as when a carnival is deleted
// by hand. Pure.
export function removeImport(data, stamp) {
  const all = (data && data.sessions) || [];
  const gone = new Set(all.filter((s) => s && s.imported === stamp).map((s) => s.id));
  const unlink = ({ carnivalId, ...f }) => f;
  return {
    sessions: all.filter((s) => !gone.has(s.id)),
    fixtures: ((data && data.fixtures) || [])
      .filter((f) => !(f && f.imported === stamp && !isPlayed(f)))
      .map((f) => (f && f.carnivalId && gone.has(f.carnivalId) ? unlink(f) : f))
  };
}

// A starter file for each mode: the header and two example rows.
export function scheduleTemplate(mode = "training") {
  return mode === "games"
    ? ["Date,Time,Opponent,Home or away,Venue,Round,Notes",
       "14/02/2027,9:00am,City,Home,Home Ground,1,",
       "21/02/2027,10:15am,Rovers,Away,Rovers Park,2,Arrive 30 minutes early"].join("\n") + "\n"
    : ["Date,Start,Finish,Title,Venue,Notes,Repeat,Until",
       "12/01/2027,5:00pm,6:00pm,Training,Home Ground,Bring a water bottle,,",
       "14/01/2027,5:00pm,6:00pm,Training,Home Ground,,weekly,25/03/2027"].join("\n") + "\n";
}
