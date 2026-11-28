// Ratings-aware lineup engine for the match-day planner. Pure (no React, no
// imports), so it runs offline at the ground and is unit tested on its own.
//
// Tapping auto-fill runs:
//   Stage A  who's on, block by block: the keeper slot first, then the
//            outfield picks by fair minutes, shaped by the team's lineup rules
//            and the opposition strength chosen for this game.
//   Stage B  where they play: an assignment problem over the block's empty
//            outfield slots, costed by rating, weak-wide, sticky positions and
//            (against a weaker side) variety.
//   Repair   repairPeriodCoverage puts anyone who missed a period on, without
//            emptying anyone else's period and without ever placing a 0.
//   Checks   planIssues lists what the plan breaks; ruleReceipts turns that
//            into one row per active rule for the "Why this lineup" card.
//
// The fill only ever writes EMPTY slots: whatever the coach placed is kept.
// Ported from GameDay v8 (policyIssuesTagged -> planIssues, ruleAudit ->
// ruleReceipts, repairPeriodCoverage, periodFeasible, floorMin); the placement
// stage is new.

export const OPPOSITION = ["weaker", "even", "stronger", "hardest"];
export const OPPOSITION_CHIPS = [
  { id: "weaker", label: "Weaker", blurb: "Mix it up: equal minutes, and kids get a go in new positions." },
  { id: "even", label: "About even", blurb: "Balanced: fair minutes, everyone mostly where they play best." },
  { id: "stronger", label: "Stronger", blurb: "Deliberate: best players anchored in their best spots, everyone else rotates." },
  { id: "hardest", label: "Much stronger", blurb: "Strongest shape all game: rotation only where it costs least, finish strong." }
];
export const sanitizeOpposition = (v) => (OPPOSITION.includes(v) ? v : "even");

const W_RATING = { weaker: 0.5, even: 1, stronger: 2, hardest: 3 };
const FORBID = 1e6;
const EPS = 1e-6;
const GROUPS = ["GK", "DEF", "MID", "FWD"];
const GROUP_WORD = { GK: "in goal", DEF: "in defence", MID: "in midfield", FWD: "up front" };
const UNIT = { 2: "half", 3: "third", 4: "quarter" };
const ORD = ["1st", "2nd", "3rd", "4th"];

/* ------------------------------- labels ---------------------------------- */

// A rule's text as the coach reads it. Rule 1 follows the format's period
// count and is never stored; every other rule shows its own text.
export function ruleLabel(rule, format) {
  if (rule?.id === "bi-period") {
    const n = format?.periods || 2;
    if (n === 1) return "Everyone available gets on the pitch";
    return "Everyone available plays in every " + (UNIT[n] || "half");
  }
  return String(rule?.text ?? "");
}
// "2nd third", "1st half", "4th quarter"; one period is "game".
export function periodName(idx, periods) {
  if (periods <= 1) return "game";
  return (ORD[idx] || idx + 1 + "th") + " " + (UNIT[periods] || "period");
}
const first = (p) => String(p?.name || "?").trim().split(/\s+/)[0];
const fmt = (m) => (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1));

/* ------------------------------- ratings --------------------------------- */

// The stored rating (0-5) or null when unrated. Scoring treats null as 2.5,
// an average player; it is never a 0.
export function ratingOf(p, grp) {
  const r = p?.ratings?.[grp];
  return typeof r === "number" && Number.isFinite(r) ? r : null;
}
const score = (p, grp) => ratingOf(p, grp) ?? 2.5;
// Best non-GK rating.
export const overallRating = (p) => Math.max(score(p, "DEF"), score(p, "MID"), score(p, "FWD"));
export const hasRatings = (p) => GROUPS.some((g) => ratingOf(p, g) != null);
const isWeak = (p, grp) => { const r = ratingOf(p, grp); return r === 1 || r === 2; };
const grpOf = (pos) => (pos?.gk ? "GK" : pos?.grp || "MID");

/* -------------------------------- context -------------------------------- */

// Build the engine's context once (the planner wraps this in a useMemo).
// positionsByBlock lets a later step give each period its own shape; today
// every block shares `positions`.
export function buildLineupCtx({ segments, positions, positionsByBlock, roster, rules, format, opposition, locked }) {
  const segs = segments || [];
  const periods = Math.max(1, Math.round(format?.periods || 1));
  const gameLength = format?.gameLength || (segs.length ? segs[segs.length - 1].end : 0);
  const plen = gameLength / periods || 1;
  const periodOf = segs.map((s) => Math.min(periods - 1, Math.max(0, Math.floor(s.start / plen + 1e-9))));
  return {
    segments: segs,
    periodOf,
    positionsByBlock: positionsByBlock || segs.map(() => positions || []),
    roster: roster || [],
    rules: Array.isArray(rules) ? rules : [],
    format: { ...(format || {}), periods, gameLength },
    opposition: sanitizeOpposition(opposition),
    ...(locked ? { locked } : {})
  };
}

// Everything the stages and checks share, derived from ctx.
function derive(ctx) {
  const { segments, periodOf, positionsByBlock, roster, rules, format } = ctx;
  const active = new Set(rules.filter((r) => r && !r.off).map((r) => r.id));
  const avail = roster.filter((p) => p.available);
  const byId = {};
  roster.forEach((p) => (byId[p.id] = p));
  const availIds = new Set(avail.map((p) => p.id));
  const dur = segments.map((s) => s.end - s.start);
  const periods = format.periods;
  const periodBlocks = Array.from({ length: periods }, () => []);
  periodOf.forEach((P, i) => periodBlocks[P].push(i));
  const slots = positionsByBlock[0]?.length || 0;
  const outfieldOf = (i) => positionsByBlock[i].filter((q) => !q.gk);
  // GameDay's periodFeasible: blocks in the period x spots on the pitch (the
  // keeper's included: a keeper has played the period) >= available.
  const periodFeasible = periodBlocks.map((bs) => bs.length > 0 && bs.reduce((s, i) => s + positionsByBlock[i].length, 0) >= avail.length);
  // GameDay's floorMin, rounded to 0.1'.
  const floor = avail.length ? Math.round(Math.min(format.gameLength / 2, (format.gameLength * slots) / avail.length) * 10) / 10 : 0;
  const maxBlock = dur.reduce((m, d) => Math.max(m, d), 0);
  const benchGuard = avail.length > slots && avail.length <= 2 * slots;
  const hasGK = positionsByBlock.some((ps) => ps.some((q) => q.gk));
  return { active, avail, availIds, byId, dur, periods, periodBlocks, periodFeasible, floor, maxBlock, benchGuard, slots, outfieldOf, hasGK };
}

const allowedAt = (D, p, grp) => !(D.active.has("bi-rating-zero") && ratingOf(p, grp) === 0);

/* ------------------------------ assignment ------------------------------- */

// Hungarian method (rows <= cols), returns the column for each row.
function hungarian(a) {
  const n = a.length, m = n ? a[0].length : 0;
  if (!n || !m) return [];
  const INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
  return res;
}

// Can every player in `players` get a distinct slot they're allowed in?
function matchable(players, slots, ok) {
  const owner = new Array(slots.length).fill(-1);
  const tryP = (pi, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !ok(players[pi], slots[s])) continue;
      seen[s] = true;
      if (owner[s] < 0 || tryP(owner[s], seen)) { owner[s] = pi; return true; }
    }
    return false;
  };
  for (let pi = 0; pi < players.length; pi++) if (!tryP(pi, new Array(slots.length).fill(false))) return false;
  return true;
}

// A swap that takes a weak player out of a central slot without making
// another weak-central or a 0. Shared by the fill and the check so the card
// only warns about what the fill could have fixed.
function wideSwap(D, seg, positions, c, canUse) {
  const pid = seg[c.key];
  const p = D.byId[pid];
  if (!p) return null;
  let best = null;
  for (const s of positions) {
    if (s.gk || s.key === c.key || !seg[s.key] || !canUse(s)) continue;
    const o = D.byId[seg[s.key]];
    if (!o) continue;
    if (!allowedAt(D, p, s.grp) || !allowedAt(D, o, c.grp)) continue;
    if (!s.wide && isWeak(p, s.grp)) continue;
    if (isWeak(o, c.grp)) continue;
    const cost = (5 - score(p, s.grp)) + (5 - score(o, c.grp));
    if (!best || cost < best.cost) best = { s, cost };
  }
  return best && best.s;
}

/* --------------------------------- fill ---------------------------------- */

function targetsFor(ctx, D) {
  const n = D.avail.length;
  const T = {};
  if (!n) return T;
  const B = ctx.segments.reduce((s, seg, i) => s + D.dur[i] * ctx.positionsByBlock[i].length, 0);
  const fair = B / n;
  const opp = ctx.opposition;
  if (opp === "weaker" || opp === "even") { D.avail.forEach((p) => (T[p.id] = fair)); return T; }
  const cap = ctx.format.gameLength;
  const pow = opp === "hardest" ? 3 : 1;
  const w = {};
  D.avail.forEach((p) => (w[p.id] = Math.pow(Math.max(0.5, overallRating(p)), pow)));
  let extra = Math.max(0, B - n * D.floor);
  let open = D.avail.map((p) => p.id);
  D.avail.forEach((p) => (T[p.id] = D.floor));
  // Share the minutes above the floor by rating, capped at the whole game.
  for (let k = 0; k < n && extra > EPS && open.length; k++) {
    const sw = open.reduce((s, id) => s + w[id], 0);
    const nextOpen = [];
    let spill = 0;
    open.forEach((id) => {
      const want = T[id] + (extra * w[id]) / sw;
      if (want > cap) { spill += want - cap; T[id] = cap; } else { T[id] = want; nextOpen.push(id); }
    });
    extra = spill;
    open = nextOpen;
  }
  return T;
}

export function fillLineup(plan, ctx) {
  const D = derive(ctx);
  const { segments, periodOf, positionsByBlock, opposition } = ctx;
  const next = segments.map((_, i) => ({ ...((plan && plan[i]) || {}) }));
  const locked = new Set();
  next.forEach((seg, i) => Object.keys(seg).forEach((k) => locked.add(i + ":" + k)));
  const notes = [];
  if (!D.avail.length) {
    return { plan: next, notes, locked, receipts: ruleReceipts(next, { ...ctx, locked }), issues: planIssues(next, { ...ctx, locked }) };
  }

  const on = (id) => D.active.has(id);
  const mins = {}, gkMins = {};
  D.avail.forEach((p) => { mins[p.id] = 0; gkMins[p.id] = 0; });
  next.forEach((seg, i) => positionsByBlock[i].forEach((q) => {
    const id = seg[q.key];
    if (mins[id] == null) return;
    mins[id] += D.dur[i];
    if (q.gk) gkMins[id] += D.dur[i];
  }));
  const T = targetsFor(ctx, D);
  const ratingPolicy = opposition === "stronger" || opposition === "hardest";
  const remainingAfter = segments.map((_, i) => D.dur.slice(i + 1).reduce((s, d) => s + d, 0));
  let gkNoted = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = next[i];
    const pos = positionsByBlock[i];
    const d = D.dur[i];
    const onIds = new Set(Object.values(seg));
    const prevSeg = i > 0 ? next[i - 1] : null;
    const prevOn = new Set(prevSeg ? Object.values(prevSeg) : []);
    const add = (id, q) => {
      seg[q.key] = id;
      onIds.add(id);
      mins[id] += d;
      if (q.gk) gkMins[id] += d;
    };

    // ---- keeper ----
    const gkPos = pos.find((q) => q.gk);
    if (gkPos && !seg[gkPos.key]) {
      const prevKey = prevSeg && positionsByBlock[i - 1].find((q) => q.gk)?.key;
      const prevGK = prevKey ? prevSeg[prevKey] : null;
      const keeperOk = (p) => (on("bi-rating-zero") ? (ratingOf(p, "GK") ?? 0) >= 1 : true);
      let pick = null;
      if (on("bi-gk-break") && prevGK && periodOf[i] === periodOf[i - 1] && D.availIds.has(prevGK) && !onIds.has(prevGK) && keeperOk(D.byId[prevGK])) {
        pick = prevGK;
      } else {
        const pool = D.avail.filter((p) => !onIds.has(p.id) && keeperOk(p));
        pool.sort((a, b) => {
          const zero = (ratingOf(a, "GK") === 0) - (ratingOf(b, "GK") === 0);
          if (zero) return zero;
          const byMins = gkMins[a.id] - gkMins[b.id];
          const byRating = score(b, "GK") - score(a, "GK");
          const main = ratingPolicy ? byRating || byMins : byMins || byRating;
          return main || mins[a.id] - mins[b.id] || a.name.localeCompare(b.name);
        });
        pick = pool[0]?.id || null;
      }
      if (pick) add(pick, gkPos);
      else if (!gkNoted) {
        gkNoted = true;
        notes.push("Nobody available is rated 1 or more in goal, so the keeper spot is left for you to pick.");
      }
    }

    // ---- outfield: who ----
    const empty = pos.filter((q) => !q.gk && !seg[q.key]);
    if (!empty.length) continue;
    const cands = D.avail.filter((p) => !onIds.has(p.id));

    const P = periodOf[i];
    let periodMust = new Set();
    if (on("bi-period") && D.periodFeasible[P]) {
      const seen = new Set();
      D.periodBlocks[P].forEach((j) => Object.values(next[j]).forEach((id) => seen.add(id)));
      const needers = cands.filter((p) => !seen.has(p.id));
      const later = D.periodBlocks[P].filter((j) => j > i)
        .reduce((s, j) => s + D.outfieldOf(j).filter((q) => !next[j][q.key]).length, 0);
      if (needers.length > later) periodMust = new Set(needers.map((p) => p.id));
    }
    const floorMust = (p) => ratingPolicy && mins[p.id] + remainingAfter[i] < D.floor - EPS;
    const dbl = on("bi-no-double-bench") && D.benchGuard && !!prevSeg;
    const progress = (p) => (ratingPolicy ? mins[p.id] / (T[p.id] || 1) : mins[p.id]);
    // Benched last block: a rule, so it ranks above the minutes policy (with
    // fair minutes it rarely matters; against a stronger side it stops the
    // lowest-rated sitting out twice running).
    const benchedLast = (p) => dbl && !prevOn.has(p.id);
    cands.sort((a, b) =>
      (periodMust.has(b.id) - periodMust.has(a.id)) ||
      (floorMust(b) - floorMust(a)) ||
      (benchedLast(b) - benchedLast(a)) ||
      (Math.abs(progress(a) - progress(b)) > EPS ? progress(a) - progress(b) : 0) ||
      (overallRating(b) - overallRating(a)) ||
      (prevOn.has(b.id) - prevOn.has(a.id)) ||
      a.name.localeCompare(b.name)
    );
    const okAt = (p, q) => allowedAt(D, p, q.grp);
    const chosen = [];
    for (const p of cands) {
      if (chosen.length >= empty.length) break;
      if (matchable([...chosen, p], empty, okAt)) chosen.push(p);
    }
    if (!chosen.length) continue;

    // ---- outfield: where ----
    const lastPos = {}, played = {};
    for (let j = 0; j < i; j++) {
      positionsByBlock[j].forEach((q) => {
        const id = next[j][q.key];
        if (!id) return;
        lastPos[id] = q.key;
        if (!q.gk) (played[id] = played[id] || new Set()).add(q.grp);
      });
    }
    const W = W_RATING[opposition];
    const cost = chosen.map((p) => empty.map((q) => {
      const r = ratingOf(p, q.grp);
      let c = 0;
      if (r === 0) { if (on("bi-rating-zero")) return FORBID; c += 20; }
      c += W * (5 - (r ?? 2.5));
      if (on("bi-weak-wide") && !q.wide && (r === 1 || r === 2)) c += 6;
      if (on("bi-sticky-positions") && lastPos[p.id] === q.key) c -= 3;
      if (opposition === "weaker" && !played[p.id]?.has(q.grp)) c -= 1.5;
      return c;
    }));
    const cols = hungarian(cost);
    chosen.forEach((p, k) => {
      const col = cols[k];
      if (col < 0) return;
      if (cost[k][col] >= FORBID) {
        notes.push(`${empty[col].label} in block ${i + 1} is left empty: nobody free can play there.`);
        return;
      }
      add(p.id, empty[col]);
    });

    // ---- weak-wide clean-up: swap a weak player out of the middle ----
    if (on("bi-weak-wide")) {
      const free = (q) => !locked.has(i + ":" + q.key);
      for (let guard = 0; guard < pos.length * 2; guard++) {
        const c = pos.find((q) => !q.gk && !q.wide && seg[q.key] && free(q) && isWeak(D.byId[seg[q.key]], q.grp) && wideSwap(D, seg, pos, q, free));
        if (!c) break;
        const s = wideSwap(D, seg, pos, c, free);
        const t = seg[c.key]; seg[c.key] = seg[s.key]; seg[s.key] = t;
      }
    }
  }

  const rep = repairPeriodCoverage(next, ctx, locked);
  notes.push(...rep.notes);
  const out = { ...ctx, locked };
  return { plan: rep.plan, notes, locked, receipts: ruleReceipts(rep.plan, out), issues: planIssues(rep.plan, out) };
}

/* -------------------------------- repair --------------------------------- */

// Anyone available who misses a period goes on in place of someone who plays
// that period at least twice. Strict pass keeps weak players wide; the relaxed
// pass drops that preference. Never empties anyone's period, never places a
// 0, never touches the keeper or a locked slot.
export function repairPeriodCoverage(plan, ctx, lockedSet) {
  const D = derive(ctx);
  const notes = [];
  const out = plan.map((s) => ({ ...s }));
  if (!D.active.has("bi-period")) return { plan: out, notes };
  const isLocked = (i, k) => !!lockedSet && lockedSet.has(i + ":" + k);
  const wideOn = D.active.has("bi-weak-wide");
  for (let P = 0; P < D.periods; P++) {
    if (!D.periodFeasible[P]) continue;
    const blocks = D.periodBlocks[P];
    const count = () => {
      const c = {};
      blocks.forEach((j) => Object.values(out[j]).forEach((id) => (c[id] = (c[id] || 0) + 1)));
      return c;
    };
    for (const strict of [true, false]) {
      const missing = D.avail.filter((p) => !count()[p.id]);
      for (const m of missing) {
        const c = count();
        if (c[m.id]) continue;
        let best = null;
        for (const j of blocks) {
          if (Object.values(out[j]).includes(m.id)) continue;
          for (const q of ctx.positionsByBlock[j]) {
            const oid = out[j][q.key];
            if (q.gk || !oid || isLocked(j, q.key) || (c[oid] || 0) < 2) continue;
            if (ratingOf(m, q.grp) === 0) continue;
            if (strict && wideOn && !q.wide && isWeak(m, q.grp)) continue;
            const o = D.byId[oid];
            const rank = [c[oid], -(5 - score(m, q.grp))];
            if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { j, q, o, rank };
          }
        }
        if (!best) continue;
        out[best.j][best.q.key] = m.id;
        notes.push(`${first(m)} in for ${first(best.o)} at ${best.q.label} (block ${best.j + 1}) so everyone plays the ${periodName(P, D.periods)}`);
      }
    }
  }
  return { plan: out, notes };
}

/* -------------------------------- checks --------------------------------- */

// Everything the plan breaks: [{ tag, ruleId, msg, block?, pid?, locked? }].
// tag is floor | period | gk | zero | wide | bench.
export function planIssues(plan, ctx) {
  const D = derive(ctx);
  const { segments, positionsByBlock, periodOf } = ctx;
  const issues = [];
  const isLocked = (i, k) => !!ctx.locked && ctx.locked.has(i + ":" + k);
  const segAt = (i) => (plan && plan[i]) || {};

  // A 0 anywhere (the keeper included).
  if (D.active.has("bi-rating-zero")) {
    segments.forEach((_, i) => positionsByBlock[i].forEach((q) => {
      const p = D.byId[segAt(i)[q.key]];
      if (!p || ratingOf(p, grpOf(q)) !== 0) return;
      issues.push({ tag: "zero", ruleId: "bi-rating-zero", block: i, pid: p.id, locked: isLocked(i, q.key),
        msg: `${first(p)} is rated 0 ${GROUP_WORD[grpOf(q)]} yet placed at ${q.label} in block ${i + 1}` });
    }));
  }

  // Keeper changes in the middle of a period.
  if (D.active.has("bi-gk-break") && D.hasGK) {
    for (let i = 1; i < segments.length; i++) {
      if (periodOf[i] !== periodOf[i - 1]) continue;
      const a = positionsByBlock[i - 1].find((q) => q.gk), b = positionsByBlock[i].find((q) => q.gk);
      const ga = a && segAt(i - 1)[a.key], gb = b && segAt(i)[b.key];
      if (ga && gb && ga !== gb) {
        issues.push({ tag: "gk", ruleId: "bi-gk-break", block: i, pid: gb, locked: isLocked(i, b.key) || isLocked(i - 1, a.key),
          msg: `The keeper changes mid-${UNIT[D.periods] || "game"} at ${fmt(segments[i].start)}' (${first(D.byId[ga])} to ${first(D.byId[gb])})` });
      }
    }
  }

  // Someone available misses a whole period.
  if (D.active.has("bi-period")) {
    for (let P = 0; P < D.periods; P++) {
      if (!D.periodFeasible[P]) continue;
      const seen = new Set();
      D.periodBlocks[P].forEach((j) => Object.values(segAt(j)).forEach((id) => seen.add(id)));
      D.avail.forEach((p) => {
        if (seen.has(p.id)) return;
        issues.push({ tag: "period", ruleId: "bi-period", pid: p.id,
          msg: D.periods === 1 ? `${first(p)} doesn't get on` : `${first(p)} sits out the whole ${periodName(P, D.periods)}` });
      });
    }
  }

  // A weak player in the middle when a swap could have put them wide.
  if (D.active.has("bi-weak-wide")) {
    segments.forEach((_, i) => {
      const seg = segAt(i), pos = positionsByBlock[i];
      pos.forEach((c) => {
        if (c.gk || c.wide) return;
        const p = D.byId[seg[c.key]];
        if (!p || !isWeak(p, c.grp)) return;
        const free = (q) => !isLocked(i, q.key);
        const fixable = !isLocked(i, c.key) && wideSwap(D, seg, pos, c, free);
        const viaLocked = !fixable && wideSwap(D, seg, pos, c, () => true);
        if (!fixable && !viaLocked) return; // no feasible split: nothing to warn about
        issues.push({ tag: "wide", ruleId: "bi-weak-wide", block: i, pid: p.id, locked: !fixable,
          msg: `${first(p)} (rated ${ratingOf(p, c.grp)}) is central at ${c.label} in block ${i + 1}` });
      });
    });
  }

  // Two blocks in a row on the bench (only when the squad allows it).
  if (D.active.has("bi-no-double-bench") && D.benchGuard) {
    const full = (i) => Object.keys(segAt(i)).length >= positionsByBlock[i].length;
    for (let i = 1; i < segments.length; i++) {
      if (!full(i) || !full(i - 1)) continue;
      const a = new Set(Object.values(segAt(i - 1))), b = new Set(Object.values(segAt(i)));
      D.avail.forEach((p) => {
        if (a.has(p.id) || b.has(p.id)) return;
        issues.push({ tag: "bench", ruleId: "bi-no-double-bench", block: i, pid: p.id,
          msg: `${first(p)} is benched back-to-back in blocks ${i} and ${i + 1}` });
      });
    }
  }

  // Minutes floor when trading minutes for strength (GameDay allows half a
  // block of slack).
  if (hardMinutes(ctx)) {
    const m = {};
    D.avail.forEach((p) => (m[p.id] = 0));
    segments.forEach((_, i) => Object.values(segAt(i)).forEach((id) => { if (m[id] != null) m[id] += D.dur[i]; }));
    D.avail.forEach((p) => {
      if (m[p.id] < D.floor - (D.maxBlock * 0.5 + 0.01)) {
        issues.push({ tag: "floor", ruleId: "floor", pid: p.id, msg: `${first(p)} totals ${fmt(m[p.id])}' (minimum ${fmt(D.floor)}')` });
      }
    });
  }
  return issues;
}

const hardMinutes = (ctx) => ctx.opposition === "stronger" || ctx.opposition === "hardest";

// One row per active rule for the "Why this lineup" card, led (against a
// stronger side) by the minutes floor, as GameDay's ruleAudit does:
// { ruleId, label, state: "ok" | "warn" | "na" | "asked", note }.
export function ruleReceipts(plan, ctx) {
  const D = derive(ctx);
  const issues = planIssues(plan, ctx);
  const rated = D.avail.some(hasRatings);
  const slots = D.slots;
  const lead = hardMinutes(ctx) && D.avail.length
    ? [{ id: "floor", builtin: true, text: `Everyone reaches ${fmt(D.floor)}'` }] : [];
  return [...lead, ...ctx.rules.filter((r) => r && !r.off)].map((rule) => {
    const row = (state, note = "") => ({ ruleId: rule.id, label: ruleLabel(rule, ctx.format), state, note });
    if (!rule.builtin || rule.id === "bi-sticky-positions") return row("asked", "Not checked automatically yet");
    const mine = issues.filter((x) => x.ruleId === rule.id);
    if (mine.length) {
      let note = mine[0].msg;
      if (mine.length > 1) note += ` (and ${mine.length - 1} more)`;
      if (mine.every((x) => x.locked)) note += ". This comes from your locked picks.";
      return row("warn", note);
    }
    switch (rule.id) {
      case "bi-period": {
        const bad = D.periodFeasible.findIndex((f) => !f);
        if (bad >= 0) {
          const n = D.periodBlocks[bad].length;
          return row("na", `Not enough spots: ${D.avail.length} players, ${n} block${n === 1 ? "" : "s"} × ${slots} spots in the ${periodName(bad, D.periods)}`);
        }
        return row("ok");
      }
      case "floor":
        return row("ok");
      case "bi-gk-break":
        return D.hasGK ? row("ok") : row("na", "No keeper in this format");
      case "bi-rating-zero":
      case "bi-weak-wide":
        return rated ? row("ok") : row("na", "No ratings yet");
      case "bi-no-double-bench":
        if (D.avail.length <= D.slots) return row("na", "Nobody sits out");
        return D.benchGuard ? row("ok") : row("na", "Squad size makes some repeats unavoidable");
      default:
        return row("asked", "Not checked automatically yet");
    }
  });
}
