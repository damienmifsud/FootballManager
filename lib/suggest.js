// Suggest: the AI lineup fill. Pure pieces only (no network): the prompt
// (ported from GameDay v8's buildAiPrompt), the reply schema, and merging the
// reply into the plan's EMPTY spots (mergeAiFills). The route in
// app/api/suggest calls the model, then lets the lineup engine (lib/lineup.js)
// finish anything missed, repair period coverage and check every rule, so the
// engine stays the safety net.
import { ruleLabel, periodName, planIssues } from "@/lib/lineup";
import { shapeNote, resolveTheirShape, theirLabel } from "@/lib/shapes";

const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
const first = (name) => String(name || "?").trim().split(/\s+/)[0];
const UNIT = { 2: "half", 3: "third", 4: "quarter" };

// The built-in rules as the model reads them: GameDay's fuller wording (the
// Settings labels are short on purpose).
const RULE_PROMPT = {
  "bi-period": (unit) => `Everyone available takes the pitch in every ${unit}: no one sits out a whole one.`,
  "bi-gk-break": () => "The goalkeeper only changes at a break between periods, never at a mid-period substitution.",
  "bi-rating-zero": () => "Never pick a player for a group they're rated 0 (won't play) in, and only players with a goalkeeper rating of 1 or more go in goal.",
  "bi-weak-wide": () => "Weaker players play out wide, never anchoring the middle: central defence, central midfield and central attack go to higher-rated players (a rating of 1-2 counts as weaker).",
  "bi-no-double-bench": () => "Avoid benching the same player two blocks in a row where possible.",
  "bi-sticky-positions": () => "Keep a player in the same position across consecutive blocks they play, and bring a player back on in the position they left."
};

// The reply shape, enforced by structured outputs. Block fills are an array
// (structured outputs needs fixed keys): one entry per block with empty spots,
// the player ids in the order of that block's empty list.
export const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    fills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          block: { type: "integer" },
          players: { type: "array", items: { type: "string" } }
        },
        required: ["block", "players"],
        additionalProperties: false
      }
    },
    why: { type: "string" }
  },
  required: ["fills", "why"],
  additionalProperties: false
};

// { blockIndex: [empty spot keys in order] } for blocks with an empty spot.
export function emptyByBlockOf(base, positionsByBlock) {
  const out = {};
  positionsByBlock.forEach((list, i) => {
    const seg = base[i] || {};
    const keys = list.filter((q) => !seg[q.key]).map((q) => q.key);
    if (keys.length) out[i] = keys;
  });
  return out;
}

// The prompt. ctx is the lineup engine's (lib/lineup buildLineupCtx); extras:
// { shapes: [shape per period], theirShapes: {pd: val}, opponent, notes: {id: coach note} }.
export function buildSuggestPrompt(ctx, base, empty, extras = {}) {
  const { segments, periodOf, positionsByBlock, roster, rules, format, opposition } = ctx;
  const periods = format.periods;
  const unit = UNIT[periods] || "period";
  const outfield = (positionsByBlock[0] || []).filter((q) => !q.gk).length;
  const avail = roster.filter((p) => p.available);
  const slots = (positionsByBlock[0] || []).length;
  const maxBlock = segments.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  const floor = avail.length ? round1(Math.min(format.gameLength / 2, (format.gameLength * slots) / avail.length)) : 0;

  const lockedMin = {};
  avail.forEach((p) => (lockedMin[p.id] = 0));
  const locked = [];
  base.forEach((seg, i) => {
    const d = segments[i].end - segments[i].start;
    Object.entries(seg || {}).forEach(([k, id]) => {
      locked.push({ b: i, p: k, id });
      if (lockedMin[id] != null) lockedMin[id] = round1(lockedMin[id] + d);
    });
  });

  // One position list per period (each block reads its period's list).
  const perPeriod = Array.from({ length: Math.max(1, periods) }, (_, pd) => {
    const i = periodOf.indexOf(pd);
    return (positionsByBlock[i >= 0 ? i : 0] || []).map((q) => ({ p: q.key, label: q.label, g: q.gk ? "GK" : q.grp || "MID", ...(q.wide ? { w: 1 } : {}) }));
  });
  const shapes = extras.shapes || perPeriod.map(() => "");
  const notes = extras.notes || {};
  const data = {
    blocks: segments.map((s, i) => ({ i, from: s.start, to: s.end, min: round1(s.end - s.start) })),
    periodOf,
    shapes,
    positions: perPeriod,
    players: avail.map((p) => ({ id: p.id, name: first(p.name), r: p.ratings || null, ...(notes[p.id] ? { note: String(notes[p.id]).slice(0, 200) } : {}) })),
    locked,
    lockedMin,
    empty
  };

  const active = rules.filter((r) => r && !r.off);
  const on = (id) => active.some((r) => r.id === id);

  // Players with very few legal spots go first (GameDay's schedule-first list).
  const union = [];
  positionsByBlock.forEach((list) => list.forEach((q) => { if (!union.some((u) => u.label === q.label)) union.push(q); }));
  const tight = avail.map((p) => {
    const ok = union.filter((q) => {
      const g = q.gk ? "GK" : q.grp || "MID";
      const r = p.ratings ? p.ratings[g] : null;
      if (on("bi-rating-zero") && (q.gk ? !(typeof r === "number" && r >= 1) : r === 0)) return false;
      if (on("bi-weak-wide") && !q.gk && !q.wide && (r === 1 || r === 2)) return false;
      return true;
    });
    return { name: first(p.name), labels: ok.map((q) => q.label) };
  }).filter((x) => x.labels.length > 0 && x.labels.length <= 3);

  const policy = {
    weaker: `Aim for equal minutes: every player's final total within ${fmt(maxBlock)}' of each other. Rotate players through different groups they can play (rating 2+ or unrated), and deliberately give players a run in spots they don't usually get.`,
    even: `Keep final totals within ${fmt(maxBlock)}' of each other, with players mostly in their strongest groups. Small experiments are fine.`,
    stronger: `Every player's final total must reach at least ${fmt(floor)}'. Minutes above that floor go to the highest-rated players in their strongest groups. Keep the keeper and central defence stable.`,
    hardest: `Every player's final total must reach at least ${fmt(floor)}', which is non-negotiable. Beyond that, maximise strength: the top-rated players in their best positions for as many minutes as possible, rotation concentrated in the least critical spots, and the strongest lineup on the pitch for the final block.`
  }[opposition];
  const oppLabel = { weaker: "WEAKER", even: "ABOUT EVEN", stronger: "STRONGER", hardest: "MUCH STRONGER" }[opposition];

  const shapeLines = shapes.map((sh, pd) => {
    const n = shapeNote(sh, outfield);
    const theirs = extras.theirShapes ? latestTheirs(extras.theirShapes, pd) : null;
    const tShape = theirs ? resolveTheirShape(theirs, outfield) : "";
    return (periods > 1 ? periodName(pd, periods) : "Whole game") + ": " + sh
      + (n ? ` (${n.style}${n.key ? "; " + n.key : ""})` : "")
      + (tShape ? ` vs their ${tShape}${theirLabel(theirs, outfield) !== tShape ? " (" + theirLabel(theirs, outfield) + ")" : ""}` : "");
  });

  const feasible = Array.from({ length: periods }, (_, pd) => periodOf.filter((x) => x === pd).length * slots >= avail.length).every(Boolean);

  const ruleLines = active.map((r, i) => {
    const text = r.builtin && RULE_PROMPT[r.id] ? RULE_PROMPT[r.id](unit) : ruleLabel(r, format);
    return `${i + 1}. ${text}`;
  });

  return "You are the assistant coach of a youth football (soccer) team, completing the substitution plan. Assigning a player to a position for a block means they play that whole block.\n\n"
    + "DATA:\n" + JSON.stringify(data) + "\n\n"
    + "Ratings r per position group: 5 = excellent, 1 = weak, 0 = will NOT play that group (hard rule), null = unrated (treat as roughly average). "
    + `Positions with "w":1 are wide (touchline) spots; the rest are central. periodOf maps each block, by index, to its ${unit} (0-based). `
    + `positions is an array by ${unit}: positions[periodOf[b]] lists the slots for block b, in the shape named in shapes[periodOf[b]] (a slot key can mean a different spot in a different shape, so always read the list for that ${unit}).\n\n`
    + (tight.length ? `SCHEDULE-FIRST: under the rules these players have very few legal spots, so give them their appearances in every ${unit} BEFORE placing anyone else: ` + tight.map((x) => `${x.name} (only ${x.labels.join(", ")})`).join("; ") + ".\n\n" : "")
    + `OPPOSITION THIS WEEK: ${oppLabel}${extras.opponent ? " (vs " + extras.opponent + ")" : ""}. ${policy}\n\n`
    + `SHAPES BY ${unit.toUpperCase()} (each block uses the slots of its ${unit}; put the best-suited players in the key spots named here, within the rules):\n` + shapeLines.join("\n") + "\n\n"
    + "RULES:\n"
    + "1. Fill EVERY slot listed in empty, using only the listed players. One position per player per block: players in locked already occupy a slot for those blocks.\n"
    + "2. A player's final total = lockedMin + minutes from your fills. Apply the minutes policy to final totals."
    + (feasible ? "" : ` (Where a ${unit} has fewer blocks than the squad needs for everyone to appear, get as close as possible.)`) + "\n\n"
    + (ruleLines.length
      ? "COACH'S RULES, every one must be followed (listed in priority order):\n" + ruleLines.join("\n")
        + `\nRe-check every fill against every rule before replying. A rule beats the minutes policy, and an earlier rule beats a later one. If two genuinely cannot both hold, satisfy the earlier one and say what you gave up in "why". Most commonly broken: every available player appearing in every ${unit}. Verify that player by player before replying.\n\n`
      : "")
    + 'Reply with JSON: "fills" lists every block in empty as {"block": <index>, "players": [<player id for each slot of that block, in the exact order given in empty>]}; "why" is at most 45 words for the coach: the shape of the plan and any calls worth knowing, using first names.';
}

function latestTheirs(theirShapes, pd) {
  for (let k = pd; k >= 0; k--) if (theirShapes[k]) return theirShapes[k];
  return null;
}

// Merge the reply into the EMPTY spots only: a known, available player, not
// already on in that block. Anything else is dropped (the engine fills it).
export function mergeFills(base, fills, empty, availIds) {
  const next = base.map((s) => ({ ...s }));
  const byBlock = {};
  (Array.isArray(fills) ? fills : []).forEach((f) => {
    if (f && Number.isInteger(f.block) && Array.isArray(f.players)) byBlock[f.block] = f.players;
  });
  Object.entries(empty).forEach(([bi, keys]) => {
    const i = Number(bi);
    const arr = byBlock[i] || [];
    const seg = { ...(next[i] || {}) };
    const used = new Set(Object.values(seg));
    keys.forEach((k, j) => {
      const id = arr[j];
      if (typeof id === "string" && availIds.has(id) && !used.has(id) && !seg[k]) {
        seg[k] = id;
        used.add(id);
      }
    });
    next[i] = seg;
  });
  return next;
}

// What the model's plan breaks that the coach's own picks don't explain:
// the message list for the one rebalance round.
export function rebalanceIssues(plan, ctx, coachLocked) {
  return planIssues(plan, { ...ctx, locked: coachLocked }).filter((x) => !x.locked).map((x) => x.msg);
}
