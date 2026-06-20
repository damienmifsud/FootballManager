// Pure data/display helpers extracted from components/Dashboard.jsx so they can
// be unit tested without rendering the (large) client component. These are all
// side-effect-free: given the team `data` object (or simple values) they return
// derived values. The Dashboard imports them back; the ICS-export code and the
// React components there reference these same functions.

// Local yyyy-mm-dd (avoids UTC off-by-one from toISOString).
export const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const SEASON = 2026;
export const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d; };

// League table-ish stats: record, goals, points, last-5 form, scorer board, per-round series.
export function computeStats(data) {
  const played = data.fixtures.filter(f => f.status === "played" && f.us != null && f.them != null);
  let w = 0, dr = 0, l = 0, gf = 0, ga = 0;
  played.forEach(f => {
    gf += f.us; ga += f.them;
    if (f.us > f.them) w++; else if (f.us === f.them) dr++; else l++;
  });
  const pts = w * 3 + dr;
  const sorted = [...played].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const form = sorted.slice(-5).map(f => f.us > f.them ? "W" : f.us === f.them ? "D" : "L");

  const goalMap = {}, assistMap = {};
  played.forEach(f => {
    (f.goals || []).forEach(x => { goalMap[x.pid] = (goalMap[x.pid] || 0) + x.n; });
    (f.assists || []).forEach(x => { assistMap[x.pid] = (assistMap[x.pid] || 0) + x.n; });
  });
  const scorers = data.players
    .map(p => ({ ...p, goals: goalMap[p.id] || 0, assists: assistMap[p.id] || 0 }))
    .filter(p => p.goals > 0 || p.assists > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists);

  const perRound = sorted.map(f => ({ round: "R" + f.round, GF: f.us, GA: f.them }));
  return { played: played.length, w, dr, l, gf, ga, pts, form, scorers, perRound };
}

// The soonest upcoming fixture (ignores past/played; TBC dates sort last).
export function nextFixture(data) {
  const today = isoLocal(new Date());
  const up = data.fixtures
    .filter(f => f.status === "upcoming" && (!f.dateISO || f.dateISO >= today))
    .sort((a, b) => ((a.dateISO || "9999") + (a.time || "")).localeCompare((b.dateISO || "9999") + (b.time || "")));
  return up[0] || null;
}

// A game whose date has passed but has no recorded score yet.
export const isPastGame = (f) => !!(f?.dateISO && f.dateISO < isoLocal(new Date()));

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

export function countdown(iso, time) {
  if (!iso) return null;
  const t = new Date(iso + "T" + (time || "09:00") + ":00").getTime();
  const diff = t - Date.now();
  if (diff <= 0) return "Kicking off";
  const days = Math.floor(diff / 86400000);
  const hrs = Math.floor((diff % 86400000) / 3600000);
  if (days >= 1) return `${days}d ${hrs}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m`;
}

// Pull a YouTube video id out of any common URL shape (watch, youtu.be, embed, shorts).
export function ytId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  if (m) return m[1];
  const bare = url.trim().match(/^[\w-]{11}$/);
  return bare ? url.trim() : null;
}

// What kind of video link is this?
export function videoKind(url) {
  if (!url || !url.trim()) return null;
  if (ytId(url)) return "youtube";
  if (/veo\.(co|com)/i.test(url)) return "veo";
  if (/^https?:\/\//i.test(url.trim())) return "other";
  return null;
}

export const mapsUrl = (venue) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(venue);

// Guest players are only "active" within their from/until window; regular players always.
export function activeOn(p, iso) {
  if (!p.guest) return true;
  const d = iso || isoLocal(new Date());
  if (p.fromISO && d < p.fromISO) return false;
  if (p.untilISO && d > p.untilISO) return false;
  return true;
}

// AU mobile to international format for wa.me links (0400… -> 61400…).
export function intlPhone(ph) {
  let d = (ph || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "61" + d.slice(1);
  return d;
}

// Schedule changes detected by the Squadi sync, shown for 14 days.
export const recentChanges = (f) => (f?.schedChanges || []).filter(c => Date.now() - (c.at || 0) < 14 * 86400000);

export const initials = (name) => (name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();

export const secToClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
};

export const clockToSec = (str) => {
  const parts = String(str).split(":").map(n => parseInt(n, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

// Expand a training/activity session into its dates within `year`.
export function occurrences(s, year = SEASON) {
  if (!s) return [];
  if (s.recur !== "weekly") {
    if (!s.dateISO) return [];
    return new Date(s.dateISO + "T00:00:00").getFullYear() === year ? [s.dateISO] : [];
  }
  const yStart = new Date(`${year}-01-01T00:00:00`);
  const yEnd = new Date(`${year}-12-31T00:00:00`);
  let from = s.startISO ? new Date(s.startISO + "T00:00:00") : yStart;
  let to = s.untilISO ? new Date(s.untilISO + "T00:00:00") : yEnd;
  if (from < yStart) from = yStart;
  if (to > yEnd) to = yEnd;
  const out = [];
  const d = new Date(from);
  while (d.getDay() !== (s.weekday ?? 2)) d.setDate(d.getDate() + 1);
  let guard = 0;
  while (d <= to && guard++ < 60) { out.push(isoLocal(d)); d.setDate(d.getDate() + 7); }
  return out;
}

// All games + training occurrences + birthdays for a given month (0-11) of `year`.
export function monthItems(data, year, month) {
  const items = [];
  data.fixtures.forEach(f => {
    if (!f.dateISO) return;
    const dt = new Date(f.dateISO + "T00:00:00");
    if (dt.getFullYear() === year && dt.getMonth() === month)
      items.push({ key: f.id, dateISO: f.dateISO, time: f.time, kind: "game", title: "vs " + f.opponent, ref: f });
  });
  (data.sessions || []).forEach(s => {
    occurrences(s, year).forEach(iso => {
      const dt = new Date(iso + "T00:00:00");
      if (dt.getMonth() === month)
        items.push({ key: s.id + iso, dateISO: iso, time: s.time, kind: s.kind || "training", title: s.title, ref: s, occ: iso });
    });
  });
  (data.players || []).forEach(p => {
    if (!p.dob || p.dob.length < 10) return;
    const iso = `${year}-${p.dob.slice(5, 10)}`;
    const dt = new Date(iso + "T00:00:00");
    if (isNaN(dt) || dt.getMonth() !== month) return;
    if (!activeOn(p, iso)) return; // expired guests don't get calendar birthdays
    const by = parseInt(p.dob.slice(0, 4), 10);
    const age = by > 1990 ? year - by : null;
    items.push({ key: "bday" + p.id, dateISO: iso, time: "", kind: "birthday", title: age ? `${p.name} turns ${age} 🎂` : `${p.name}'s birthday 🎂`, ref: p });
  });
  return items.sort((a, b) => (a.dateISO + (a.time || "")).localeCompare(b.dateISO + (b.time || "")));
}

// Games + training/activity occurrences + birthdays within the next `days` days.
export function upcomingItems(data, fromISO, days = 7) {
  const lastISO = isoLocal(addDays(fromISO, days - 1));
  const inRange = (iso) => iso >= fromISO && iso <= lastISO;
  const items = [];
  (data.fixtures || []).forEach(f => {
    if (f.dateISO && inRange(f.dateISO))
      items.push({ key: f.id, dateISO: f.dateISO, time: f.time, kind: "game", title: "vs " + f.opponent, ref: f });
  });
  const years = new Set([+fromISO.slice(0, 4), +lastISO.slice(0, 4)]);
  (data.sessions || []).forEach(s => {
    const seen = new Set();
    years.forEach(y => occurrences(s, y).forEach(iso => {
      if (inRange(iso) && !seen.has(iso)) { seen.add(iso); items.push({ key: s.id + iso, dateISO: iso, time: s.time, kind: s.kind || "training", title: s.title, ref: s, occ: iso }); }
    }));
  });
  (data.players || []).forEach(p => {
    if (!p.dob || p.dob.length < 10) return;
    years.forEach(y => {
      const iso = `${y}-${p.dob.slice(5, 10)}`;
      if (isNaN(new Date(iso + "T00:00:00").getTime())) return;
      if (!inRange(iso) || !activeOn(p, iso)) return;
      const by = parseInt(p.dob.slice(0, 4), 10);
      const age = by > 1990 ? y - by : null;
      items.push({ key: "bday" + p.id + y, dateISO: iso, time: "", kind: "birthday", title: age ? `${p.name} turns ${age} 🎂` : `${p.name}'s birthday 🎂`, ref: p });
    });
  });
  return items.sort((a, b) => (a.dateISO + (a.time || "")).localeCompare(b.dateISO + (b.time || "")));
}

// The next `n` upcoming player birthdays from `fromISO` (rolls to next year once this year's has passed).
export function nextBirthdays(data, fromISO, n = 2) {
  const out = [];
  (data.players || []).forEach(p => {
    if (!p.dob || p.dob.length < 10) return;
    const md = p.dob.slice(5, 10);
    let year = +fromISO.slice(0, 4);
    let iso = `${year}-${md}`;
    if (iso < fromISO) { year += 1; iso = `${year}-${md}`; }
    if (isNaN(new Date(iso + "T00:00:00"))) return;
    if (!activeOn(p, iso)) return; // expired guests don't get birthdays
    const by = parseInt(p.dob.slice(0, 4), 10);
    out.push({ p, iso, age: by > 1990 ? year - by : null });
  });
  return out.sort((a, b) => a.iso.localeCompare(b.iso)).slice(0, n);
}
