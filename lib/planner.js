// Pure logic for the match-day planner (lineups, substitution blocks,
// fair-minutes auto-fill). Extracted from the planner component so it can be
// unit tested; the UI in components/MatchDayPlanner.jsx is a thin layer over
// these. All functions are side-effect-free.
import { activeOn } from "@/lib/dashboardData";

export const FORMATION_PRESETS = {
  3: ["1-1-1", "2-1", "1-2"],
  4: ["1-2-1", "2-2", "2-1-1"],
  5: ["2-2-1", "1-2-2", "2-1-2", "3-1-1"],
  6: ["2-3-1", "3-2-1", "2-2-2", "3-1-2", "2-1-2-1"],
  7: ["2-3-2", "3-3-1", "3-2-2", "2-4-1"],
  8: ["3-3-2", "2-4-2", "3-2-3", "3-4-1", "2-3-3"],
  9: ["3-4-2", "4-3-2", "3-3-3", "4-4-1"],
  10: ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "3-4-3", "5-3-2"]
};

export const round1 = (n) => Math.round(n * 10) / 10;
export const fmtMin = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
export const fmtRange = (a, b) => fmtMin(a) + "–" + fmtMin(b) + "'";
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

// Match format defaults by MiniRoos age group (lib/rulesData.js):
// U6-U7 4-a-side no GK, U8-U9 7-a-side, U10-U11 9-a-side; 2 x 20' (25' at U10+).
export function defaultFormatForAgeGroup(ageGroup) {
  const n = parseInt(String(ageGroup || "").replace(/\D/g, ""), 10);
  if (n >= 6 && n <= 7) return { gameLength: 40, periods: 2, playersOnField: 4, hasGK: false, formation: "2-2", subInterval: 10 };
  if (n >= 10 && n <= 11) return { gameLength: 50, periods: 2, playersOnField: 9, hasGK: true, formation: "3-4-1", subInterval: 10 };
  return { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };
}

// Effective format for a fixture: per-game override, else the team default,
// else the age-group default.
export function resolveFormat(data, fixture) {
  return fixture?.plan?.format || data?.team?.matchFormat || defaultFormatForAgeGroup(data?.team?.ageGroup);
}

export function parseFormation(str) {
  if (!str) return [];
  return String(str).split(/[^0-9]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n) && n > 0);
}
export function fallbackFormation(n) {
  if (FORMATION_PRESETS[n]) return FORMATION_PRESETS[n][0];
  if (n <= 2) return String(Math.max(1, n));
  const a = Math.ceil(n / 3), c = Math.floor(n / 3), b = n - a - c;
  return [a, b, c].join("-");
}
export function rowLabels(count, rowIdx, totalRows) {
  const D = { 1: ["CB"], 2: ["LB", "RB"], 3: ["LB", "CB", "RB"], 4: ["LB", "LCB", "RCB", "RB"], 5: ["LWB", "LCB", "CB", "RCB", "RWB"], 6: ["LWB", "LB", "LCB", "RCB", "RB", "RWB"] };
  const A = { 1: ["ST"], 2: ["LS", "RS"], 3: ["LW", "ST", "RW"], 4: ["LW", "LS", "RS", "RW"], 5: ["LW", "LS", "ST", "RS", "RW"] };
  const mid = (p) => ({ 1: ["C" + p], 2: ["L" + p, "R" + p], 3: ["L" + p, "C" + p, "R" + p], 4: ["L" + p, "LC" + p, "RC" + p, "R" + p], 5: ["L" + p, "LC" + p, "C" + p, "RC" + p, "R" + p] });
  const pick = (obj, tag) => obj[count] || Array.from({ length: count }, (_, i) => tag + (i + 1));
  if (totalRows === 1) return pick(mid("M"), "M");
  if (rowIdx === 0) return pick(D, "D");
  if (rowIdx === totalRows - 1) return pick(A, "F");
  const midRows = totalRows - 2;
  const m = rowIdx - 1;
  let pre = "M";
  if (midRows === 2) pre = m === 0 ? "DM" : "AM";
  else if (midRows >= 3) pre = m === 0 ? "DM" : m === midRows - 1 ? "AM" : "M";
  return pick(mid(pre), pre);
}
// Pitch spots (x/y as % of the pitch) for a formation's rows, GK included.
export function makePositions(rows, hasGK) {
  const list = [];
  if (hasGK) list.push({ key: "GK", label: "GK", x: 50, y: 90.5, gk: true });
  const total = rows.length;
  const yBottom = 72.5, yTop = 19;
  rows.forEach((count, r) => {
    const y = total === 1 ? (yBottom + yTop) / 2 : yBottom - (r * (yBottom - yTop)) / (total - 1);
    const labels = rowLabels(count, r, total);
    for (let i = 0; i < count; i++) {
      list.push({ key: "r" + r + "c" + i, label: labels[i] || "P", x: ((i + 1) / (count + 1)) * 100, y });
    }
  });
  const seen = {};
  list.forEach((p) => {
    if (seen[p.label]) { seen[p.label] += 1; p.label = p.label + seen[p.label]; }
    else seen[p.label] = 1;
  });
  return list;
}
// Evenly spaced sub times inside each period (period breaks are always subs).
export function computeAutoSubs(gameLength, periods, interval) {
  const out = [];
  if (!interval || interval <= 0) return out;
  const plen = gameLength / periods;
  for (let p = 0; p < periods; p++) {
    for (let t = interval; t < plen - 0.01; t += interval) out.push(round1(p * plen + t));
  }
  return out;
}
// Blocks of play between kick-off, sub times, period breaks and full time.
export function computeSegments(gameLength, periods, subTimes) {
  const set = new Set([0, round1(gameLength)]);
  const plen = gameLength / periods;
  for (let p = 1; p < periods; p++) set.add(round1(plen * p));
  (subTimes || []).forEach((t) => {
    const r = round1(Number(t));
    if (r > 0 && r < gameLength) set.add(r);
  });
  const b = [...set].sort((x, y) => x - y);
  const segs = [];
  for (let i = 0; i < b.length - 1; i++) segs.push({ start: b[i], end: b[i + 1] });
  return segs;
}
// Clamp stored assignments onto the current segments/positions/roster:
// unknown players, unknown positions and duplicates are dropped.
export function sanitizeAssignments(raw, segments, positions, roster) {
  const ids = new Set(roster.map((p) => p.id));
  return segments.map((s, i) => {
    const src = (raw && raw[i]) || {};
    const out = {};
    const used = new Set();
    positions.forEach((p) => {
      const id = src[p.key];
      if (id && ids.has(id) && !used.has(id)) { out[p.key] = id; used.add(id); }
    });
    return out;
  });
}
export function diffOnOff(prevSeg, curSeg) {
  const prev = new Set(Object.values(prevSeg || {}));
  const cur = new Set(Object.values(curSeg || {}));
  return {
    on: [...cur].filter((id) => !prev.has(id)),
    off: [...prev].filter((id) => !cur.has(id))
  };
}
// Fill EMPTY spots only, giving each the available player with the fewest
// planned minutes; ties prefer whoever is already on (fewer swaps) and then
// whoever held the spot in the previous block (continuity).
export function autoFillAssignments(plan, segments, positions, roster) {
  const avail = roster.filter((p) => p.available);
  if (!avail.length) return plan;
  const mins = {};
  avail.forEach((p) => (mins[p.id] = 0));
  plan.forEach((seg, i) => {
    const d = segments[i].end - segments[i].start;
    Object.values(seg).forEach((id) => { if (mins[id] != null) mins[id] += d; });
  });
  const next = plan.map((s) => ({ ...s }));
  segments.forEach((s, i) => {
    const d = s.end - s.start;
    const seg = next[i];
    const onIds = new Set(Object.values(seg));
    const empty = positions.filter((p) => !seg[p.key]);
    if (!empty.length) return;
    let cands = avail.filter((p) => !onIds.has(p.id));
    const prev = i > 0 ? next[i - 1] : {};
    const prevOn = new Set(Object.values(prev));
    empty.forEach((pos) => {
      if (!cands.length) return;
      cands.sort((a, b) =>
        mins[a.id] - mins[b.id] ||
        ((prevOn.has(b.id) ? 1 : 0) - (prevOn.has(a.id) ? 1 : 0)) ||
        a.name.localeCompare(b.name)
      );
      const low = mins[cands[0].id];
      const ties = cands.filter((c) => mins[c.id] <= low + 0.001);
      const pick = ties.find((c) => prev[pos.key] === c.id) || ties.find((c) => prevOn.has(c.id)) || ties[0];
      seg[pos.key] = pick.id;
      mins[pick.id] += d;
      cands = cands.filter((c) => c.id !== pick.id);
    });
  });
  return next;
}
// Planned minutes per player id.
export function minutesFor(plan, segments, roster) {
  const m = {};
  roster.forEach((p) => (m[p.id] = 0));
  plan.forEach((seg, i) => {
    const d = segments[i].end - segments[i].start;
    Object.values(seg).forEach((id) => { if (m[id] != null) m[id] += d; });
  });
  return m;
}

// The planner's roster for a fixture, derived from the team's player list and
// the game's RSVPs. Guests outside their window are excluded entirely.
// Availability: "out" -> unavailable; "in" -> available; no reply -> available
// but flagged (noReply) so the coach sees the risk. Per-game coach overrides
// (plan.overrides) win over the RSVP without ever touching it.
export function rosterForFixture(data, fixture, overrides = {}) {
  const avail = fixture?.availability || {};
  return (data?.players || [])
    .filter((p) => activeOn(p, fixture?.dateISO))
    .sort((a, b) => (a.number || 0) - (b.number || 0) || String(a.name).localeCompare(String(b.name)))
    .map((p) => {
      const status = avail[p.id]?.status || null;
      const o = overrides[p.id];
      const available = o ? o === "in" : status !== "out";
      return {
        id: p.id,
        name: p.name || "?",
        number: p.number != null && p.number !== "" ? String(p.number) : "",
        available,
        noReply: !status && !o,
        rsvp: status,
        overridden: !!o
      };
    });
}

// Kick-off assignments for a brand-new plan: pin the fixture's in-goal duty
// (fixture.gk) into the GK spot for every block, so auto-fill works around a
// keeper who plays the whole game.
export function seedAssignments(segments, positions, roster, gkId) {
  const hasGKSpot = positions.some((p) => p.key === "GK");
  const gkOk = gkId && hasGKSpot && roster.some((p) => p.id === gkId && p.available);
  return segments.map(() => (gkOk ? { GK: gkId } : {}));
}

// Current clock position of a persisted timer (running timers tick forward
// from their anchor timestamp), capped at full time.
export function timerElapsed(timer, gameLength, now = Date.now()) {
  if (!timer) return 0;
  const cap = gameLength * 60;
  if (!timer.running) return Math.max(0, Math.min(cap, timer.elapsed || 0));
  const e = (timer.elapsed || 0) + (now - (timer.anchorTs || now)) / 1000;
  return Math.max(0, Math.min(cap, e));
}
