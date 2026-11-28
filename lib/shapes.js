// Ported from GameDay v8's shapes.js: the call labels and one-move
// classifier (shapeCall), plus the notes, counters, zone maths and sideline
// instructions the planner's Shape card uses (slice 3, step 2).
//
// A "call" is what the coach shouts when the team changes shape mid-game.
// shapeCall(from, to) names the change when exactly one player moves one row
// (three-row shapes are def/mid/fwd, two-row shapes def/fwd); every other
// change (same shape, different squad size, a diagonal or two-row hop, four or
// more rows) has no call and returns null. All pure.
import { parseFormation, FORMATION_PRESETS } from "@/lib/planner";

export const SHAPE_CALLS = {
  DROP_IN: "Drop in",
  PUSH_UP: "Push up",
  STEP_UP: "Step up",
  SIT: "Sit",
  TUCK_IN: "Tuck in"
};

const sum = (rows) => rows.reduce((s, n) => s + n, 0);

// Index of the row that lost a player and the row that gained one, or null
// unless it is exactly one player moving between two rows.
function oneMove(from, to) {
  if (from.length !== to.length || sum(from) !== sum(to)) return null;
  let lost = -1, gained = -1;
  for (let i = 0; i < from.length; i++) {
    const d = to[i] - from[i];
    if (d === 0) continue;
    if (d === -1 && lost < 0) lost = i;
    else if (d === 1 && gained < 0) gained = i;
    else return null;
  }
  return lost < 0 || gained < 0 ? null : { lost, gained };
}

// The call for a one-player shape change, or null when there isn't one.
export function shapeCall(fromFormation, toFormation) {
  const from = parseFormation(fromFormation), to = parseFormation(toFormation);
  if (!from.length || !to.length) return null;
  const move = oneMove(from, to);
  if (!move) return null;
  const { lost, gained } = move;
  if (from.length === 2) {
    // [def, fwd]
    return gained > lost ? SHAPE_CALLS.PUSH_UP : SHAPE_CALLS.DROP_IN;
  }
  if (from.length === 3) {
    // [def, mid, fwd] — only moves through the middle row have a call.
    if (lost === 1 && gained === 0) return SHAPE_CALLS.DROP_IN;
    if (lost === 0 && gained === 1) return SHAPE_CALLS.STEP_UP;
    if (lost === 1 && gained === 2) return SHAPE_CALLS.PUSH_UP;
    if (lost === 2 && gained === 1) return SHAPE_CALLS.SIT;
  }
  return null;
}

/* ------------------- shapes: notes, counters and calls -------------------- */
// Keyed by outfield count (6 = 7v7, 8 = 9v9). Anything else falls back to the
// zone maths alone, so a typed shape still gets a card and a counter.
export const HOME_SHAPE = {
  6: "2-3-1",
  8: "3-2-3"
};
export const COUNTER_POOL = {
  6: ["2-3-1", "3-2-1", "2-2-2", "3-1-2", "2-1-2-1", "2-1-3", "4-1-1"],
  8: ["3-2-3", "3-3-2", "3-4-1", "2-3-3", "2-4-2", "3-1-3-1", "2-1-4-1", "4-2-2", "4-3-1", "3-2-2-1"]
};
export const STYLE_COLOUR = {
  Balanced: "#1F8F52",
  Solid: "#2E7D8A",
  Defensive: "#2857C4",
  "Midfield control": "#2857C4",
  Attacking: "#D63A3A",
  "Counter-attacking": "#E07B1F",
  Flexible: "#7C4DC4",
  Lockdown: "#23282C",
  Custom: "#6C7A70"
};
export const SHAPE_NOTES = {
  6: {
    "2-3-1": {
      style: "Balanced",
      tag: "home shape",
      sum: "The shape most 7v7 curricula are built on; it grows into 4-3-3. Three in the middle outnumber most shapes.",
      use: "Your default. Attack with it against 3-2-1 (wingers high), 2-2-2 and 3-1-2, and against a diamond by going around it.",
      avoid: "When your slowest kids are at the back and they play two strikers: go 3-2-1.",
      key: "The centre mid is the engine; the wide mids must track back."
    },
    "3-2-1": {
      style: "Defensive",
      tag: "",
      sum: "A spare defender at all times, two mids screening, lone striker.",
      use: "Protecting a lead, a stronger opponent, or one fast or big striker. Defends against almost anything.",
      avoid: "A team sitting deep when you're the better side: one striker on three backs won't score.",
      key: "The two mids cover a lot of ground; the striker must hold the ball up."
    },
    "2-2-2": {
      style: "Attacking",
      tag: "",
      sum: "Three pairs, the easiest shape for kids to grasp. Two strikers take away their spare.",
      use: "Weaker opponents, chasing a game, or the simple direct option against a 2-3-1.",
      avoid: "A stronger side with three mids (2-3-1, 2-1-2-1): you'll chase the ball all game.",
      key: "The two mids must stay connected; there is no natural width."
    },
    "3-1-2": {
      style: "Counter-attacking",
      tag: "",
      sum: "Spare at the back, two strikers to break with. Stay compact, hit them on the break.",
      use: "Against a sweeper (1-3-2), three forwards (2-1-3), or a 2-2-2 you'd rather counter than contain.",
      avoid: "A stronger 2-3-1 or diamond: three mids on your one and you get run through the middle.",
      key: "The single midfielder is the linchpin: your best all-rounder goes there."
    },
    "2-1-2-1": {
      style: "Flexible",
      tag: "the diamond",
      sum: "A 2-3-1 with the middle staggered: defends as a three, attacks as a three.",
      use: "Attacking against 2-3-1 or 3-1-2; your strongest squad, once the 2-3-1 roles are automatic.",
      avoid: "A young or weak holder, heavy rotation, or real wingers on their side.",
      key: "Everything runs through the holding mid; the attacking pair must track back."
    },
    "2-1-3": {
      style: "Attacking",
      tag: "chasing shape",
      sum: "Three on their back line takes away every spare. Width and numbers in the final third.",
      use: "Chasing a game late, or breaking down a parked bus when they play one striker.",
      avoid: "As a starting shape, or against two strikers unless you're much stronger.",
      key: "Needs quick backs and a keeper who sweeps behind them."
    },
    "4-1-1": {
      style: "Lockdown",
      tag: "",
      sum: "Four at the back is a spare even against three forwards. Very hard to score against.",
      use: "The last five minutes with a narrow lead, especially against three forwards.",
      avoid: "As a starting shape or for a whole third; it teaches kids to sit back.",
      key: "The lone midfielder links play; the striker holds the ball up."
    }
  },
  8: {
    "3-2-3": {
      style: "Balanced",
      tag: "home shape",
      sum: "Grows into 4-3-3, and your 2-3-1 wingers just move up a line. Three forwards give width and an outlet.",
      use: "Your default. Attack with it against 2-3-3, 3-3-2, 3-1-3-1 and narrow teams.",
      avoid: "When your two centre mids are the weakest kids that week, or against a strong 3-4-1.",
      key: "The two centre mids are the engine; the wide forwards must track back."
    },
    "3-3-2": {
      style: "Solid",
      tag: "",
      sum: "One wide forward dropped in: the 2-3-1 midfield trio intact plus a second striker. Even numbers everywhere.",
      use: "When you don't know what they'll play, or as the simple attacking answer to 3-2-3.",
      avoid: "Against 3-4-1: you're 3v4 in the middle.",
      key: "The wide mids carry the running load and supply the width."
    },
    "3-4-1": {
      style: "Midfield control",
      tag: "",
      sum: "Both wide forwards dropped. Wins the middle against almost anything.",
      use: "Defending against 3-3-2, 2-4-2, 3-1-3-1 and narrow teams; protecting a lead; a stronger opponent.",
      avoid: "When chasing, or against a parked bus.",
      key: "The lone striker needs runners from midfield."
    },
    "2-3-3": {
      style: "Attacking",
      tag: "",
      sum: "A back stepped up. Three on their back line takes away their spare.",
      use: "Chasing a game, or against a parked bus with one striker (4-3-1, 4-2-2).",
      avoid: "Against three forwards (3-2-3, 2-3-3) unless you're much stronger.",
      key: "Backs must be quick and brave 1v1; the wide forwards defend too."
    },
    "2-4-2": {
      style: "Attacking",
      tag: "owns the middle",
      sum: "Four in the middle wins the ball, two strikers, and a spare at the back against a lone striker.",
      use: "Attacking against 3-4-1 or 4-3-1: their lone striker frees a back to step up.",
      avoid: "Against two strikers or three forwards.",
      key: "Clear rules on which midfielders go and which stay."
    },
    "3-1-3-1": {
      style: "Flexible",
      tag: "the 9v9 diamond",
      sum: "A holder plus three runners: 4v3 at the back when defending, four arriving in attack.",
      use: "Attacking against 3-2-3 or 2-4-2, with a strong calm holder, once the 3-2-3 roles are automatic.",
      avoid: "Heavy-rotation weeks, or when your best kids are wingers.",
      key: "Everything runs through the holder; the runners sprint both ways."
    },
    "2-1-4-1": {
      style: "Attacking",
      tag: "possession",
      sum: "The diamond with a back stepped into the line of four: five in the middle, real width, a holder screening two backs.",
      use: "One-striker teams you want to dominate the ball against: 3-4-1, 3-2-2-1, 4-3-1.",
      avoid: "Two strikers unless the holder is disciplined; never three forwards.",
      key: "The most complex shape here: the line of four needs drilled roles and the wingers must track back."
    },
    "4-2-2": {
      style: "Counter-attacking",
      tag: "",
      sum: "Spare at the back against three forwards; two strikers stay high, so every break is 2v2.",
      use: "Defending against 2-3-3 or any team that pushes both backs up; a stronger side you plan to counter.",
      avoid: "Against a team that sits deep: nothing to counter.",
      key: "Quick strikers and a keeper who releases the ball fast."
    },
    "4-3-1": {
      style: "Lockdown",
      tag: "",
      sum: "Spare at the back and still three in the middle against 3-2-3. Very hard to score against.",
      use: "Protecting a narrow lead late; badly outmatched; defending against 3-2-3.",
      avoid: "As a starting shape or for more than one third.",
      key: "Use it sparingly; the lone striker is stranded."
    },
    "3-2-2-1": {
      style: "Midfield control",
      tag: "narrow tree",
      sum: "Two centre mids and two attacking mids behind the striker: a central overload with no width.",
      use: "Against teams that play through the middle, or when your wingers are your weakest kids.",
      avoid: "Against a 3-2-3 with real width: your wide backs are alone.",
      key: "The attacking pair must arrive beyond the striker."
    }
  }
};
// Curated answers to a known opponent shape: [shape, why]. Anything not listed
// is worked out from the zone maths in counterFor().
export const SHAPE_COUNTERS = {
  6: {
    "2-3-1": {
      attack: ["2-1-2-1", "Three through the middle against their one. Simple version: 2-2-2, but it concedes the middle."],
      defend: ["3-2-1", "Spare at the back, and the wide backs take their wingers."]
    },
    "3-2-1": {
      attack: ["2-3-1", "Wingers high: win the middle 3v2, go 3v3 on their back line and keep a spare against the lone striker."],
      defend: ["2-3-1", "No change needed: one striker doesn't justify a third defender. Mirror 3-2-1 only if they're much stronger."]
    },
    "2-2-2": {
      attack: ["2-3-1", "Win the middle 3v2 and the wingers make it 3v2 on their backs. Your backs are 2v2, so they must be reliable 1v1."],
      defend: ["3-2-1", "Spare at the back. Use 3-1-2 instead if you'd rather hit them on the break."]
    },
    "3-1-2": {
      attack: ["2-1-2-1", "Swamp their single midfielder 3v1 while the holder drops to make 3v2 on their strikers."],
      defend: ["3-2-1", "Spare at the back and you still win the middle 2v1."]
    },
    "2-1-2-1": {
      attack: ["2-3-1", "Wingers wide: a diamond has no width, so go around it, not through it."],
      defend: ["3-2-1", "Five bodies on their four central runners; give up the flanks they don't use."]
    },
    "1-3-2": {
      attack: ["3-1-2", "Go direct: two strikers on one sweeper is 2v1 every time."],
      defend: ["3-2-1", "Spare at the back, and your striker still isolates their sweeper 1v1."]
    },
    "2-1-3": {
      attack: ["3-1-2", "Every zone is even, and their commitment forward makes counters lethal."],
      defend: ["3-2-1", "3v3 at the back but you own the middle 2v1, which starves their forwards. 4-1-1 only for the last five minutes with a lead."]
    },
    "4-1-1": {
      attack: ["2-1-3", "Width and shots from the edge. 1-2-3 if you trust a lone back."],
      defend: ["2-3-1", "Nothing to defend against: stay home."]
    }
  },
  8: {
    "3-2-3": {
      attack: ["3-1-3-1", "The holder covers your back three, three runners beat their two mids, and four arrive on their back line. Simple version: 3-3-2."],
      defend: ["4-3-1", "Spare at the back and you still win the middle 3v2. Only the lone striker is a concession."]
    },
    "3-3-2": {
      attack: ["3-2-3", "Wide forwards high on their backs, spare kept at yours, concede the middle 2v3. 2-3-3 only if you're clearly stronger."],
      defend: ["3-4-1", "Spare at the back and win the middle 4v3."]
    },
    "2-3-3": {
      attack: ["3-2-3", "Three on their two backs. Your back line is 3v3, so the backs must win their 1v1s."],
      defend: ["4-2-2", "Spare at the back, strikers still 2v2 on their backs for the break."]
    },
    "3-4-1": {
      attack: ["2-4-2", "Their lone striker frees a back into midfield: 4v4 there, spare kept, wide mids arrive to make it 4v3 up top. To keep the ball instead, 2-1-4-1."],
      defend: ["3-4-1", "Mirror them. Three on one striker is already a fortress; just don't get outnumbered in the middle."]
    },
    "2-4-2": {
      attack: ["3-1-3-1", "Even middle, spare at the back, four arriving on two backs. Simple version: 3-2-3, +1 at both ends, go direct over their middle."],
      defend: ["3-4-1", "Spare at the back, even middle."]
    },
    "3-1-3-1": {
      attack: ["3-2-3", "Both centre mids on their lone holder, wide forwards pin their wide backs. The risk is their three runners at your back three, so the centre mids must track."],
      defend: ["3-4-1", "Four on their holder and runners, back three on the lone striker."]
    },
    "3-2-2-1": {
      attack: ["3-2-3", "Real width: nobody on their side plays wide, so go around them, not through. If you're stronger, 2-1-4-1."],
      defend: ["3-4-1", "Match their four in the middle."]
    },
    "2-1-4-1": {
      attack: ["3-2-3", "Go direct: their two backs and holder face three forwards, so play behind their line of four rather than through it."],
      defend: ["3-4-1", "Compact: four on their five, back three on the lone striker; make them come through you."]
    },
    "4-3-1": {
      attack: ["2-3-3", "One striker means two backs suffice. Even middle, three on four up top, so use width and shots from the edge."],
      defend: ["3-2-3", "Nothing to defend against: stay home."]
    },
    "4-2-2": {
      attack: ["2-3-3", "Two strikers is still only 2v2 for your backs. Even middle, three on four up top, so use width and shots from the edge."],
      defend: ["3-2-3", "Nothing to defend against: stay home."]
    }
  }
};
// Named calls from GameDay's home shape (HOME_SHAPE): what to say at the
// break. GameDay calls this SHAPE_CALLS; here that name is the five call
// names above, so this is HOME_CALLS.
export const HOME_CALLS = {
  6: {
    "3-2-1": "Drop in: centre mid between the backs",
    "2-2-2": "Push up: one winger joins the striker",
    "3-1-2": "Drop in and push up: centre mid drops, one winger goes up",
    "2-1-3": "Both up: both wingers join the striker",
    "2-1-2-1": "Tuck in: centre mid sits, wingers narrow and high",
    "4-1-1": "Everyone back: both wingers into the back line"
  },
  8: {
    "3-3-2": "Drop in: a wide forward into midfield",
    "3-4-1": "Both drop: both wide forwards into midfield",
    "2-3-3": "Step up: a back into midfield",
    "2-4-2": "Step up and drop in: a back into midfield, a wide forward drops",
    "4-2-2": "Sit and drop in: a centre mid between the backs, a wide forward into midfield",
    "4-3-1": "Sit and both drop: a centre mid between the backs, both wide forwards into midfield",
    "3-1-3-1": "Tuck in: wide forwards narrow behind the striker, one centre mid holds",
    "2-1-4-1": "Step up from the diamond: a back into the line of four",
    "3-2-2-1": "Tuck in: wide forwards narrow behind the striker, both centre mids stay"
  }
};
// "What you saw" options for the opposition, mapped to a representative shape.
export const THEIR_TRAITS = [{
  id: "3fwd",
  label: "Three forwards",
  shape: {
    6: "2-1-3",
    8: "2-3-3"
  }
}, {
  id: "2st",
  label: "Two strikers",
  shape: {
    6: "2-2-2",
    8: "3-3-2"
  }
}, {
  id: "1st",
  label: "One striker",
  shape: {
    6: "3-2-1",
    8: "3-4-1"
  }
}, {
  id: "bus",
  label: "Parked bus",
  shape: {
    6: "4-1-1",
    8: "4-3-1"
  }
}, {
  id: "sweep",
  label: "Sweeper, pressing",
  shape: {
    6: "1-3-2",
    8: "1-3-3-1"
  }
}];
export function shapeSum(str) {
  return parseFormation(str).reduce((a, b) => a + b, 0);
}
export function shapeZones(str) {
  const r = parseFormation(str);
  if (!r.length) return null;
  if (r.length === 1) return {
    D: 0,
    M: r[0],
    F: 0
  };
  if (r.length === 2) return {
    D: r[0],
    M: 0,
    F: r[1]
  };
  return {
    D: r[0],
    M: r.slice(1, -1).reduce((a, b) => a + b, 0),
    F: r[r.length - 1]
  };
}
// Compare our shape with theirs zone by zone: back = our backs v their
// forwards, middle v middle, front = our forwards v their backs.
export function zoneMatch(ours, theirs) {
  const a = shapeZones(ours),
    b = shapeZones(theirs);
  if (!a || !b) return null;
  const mk = (us, them, kind) => {
    const d = us - them;
    const state = kind === "front" ? d >= 0 ? "ok" : d === -1 ? "even" : "warn" : d > 0 ? "ok" : d === 0 ? "even" : "warn";
    return {
      txt: us + "v" + them,
      d,
      state
    };
  };
  return {
    back: mk(a.D, b.F, "back"),
    middle: mk(a.M, b.M, "middle"),
    front: mk(a.F, b.D, "front")
  };
}
export function zoneWhy(z) {
  if (!z) return "";
  const bits = [z.back.d > 0 ? "spare at the back" : z.back.d === 0 ? "even at the back" : "outnumbered at the back", z.middle.d > 0 ? "win the middle" : z.middle.d === 0 ? "even in the middle" : "concede the middle", z.front.d > 0 ? "overload up top" : z.front.d === 0 ? "their spare is gone" : "they keep a spare at the back"];
  const s = bits.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
export function rankCounters(theirShape, outfield, mode) {
  const pool = (COUNTER_POOL[outfield] || FORMATION_PRESETS[outfield] || []).filter(s => shapeSum(s) === outfield);
  const home = HOME_SHAPE[outfield] || pool[0] || "";
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return pool.map(s => {
    const z = zoneMatch(s, theirShape);
    if (!z) return null;
    let score = mode === "defend" ? cl(z.back.d, -3, 1) * 3 + cl(z.middle.d, -2, 2) * 1.5 + cl(z.front.d, -3, 0) * 0.5 : cl(z.front.d, -2, 1) * 3 + cl(z.middle.d, -2, 2) * 1.5 + (z.back.d < 0 ? -4 : z.back.d >= 1 ? 0.75 : 0);
    if (s === home) score += 0.25;
    return {
      shape: s,
      score,
      z
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
export function counterFor(theirShape, outfield) {
  if (!theirShape || shapeSum(theirShape) <= 0) return null;
  const cur = (SHAPE_COUNTERS[outfield] || {})[theirShape];
  const mk = mode => {
    if (cur && cur[mode]) return {
      shape: cur[mode][0],
      why: cur[mode][1],
      z: zoneMatch(cur[mode][0], theirShape),
      curated: true
    };
    const r = rankCounters(theirShape, outfield, mode)[0];
    return r ? {
      shape: r.shape,
      why: zoneWhy(r.z),
      z: r.z,
      curated: false
    } : null;
  };
  const attack = mk("attack"),
    defend = mk("defend");
  return attack || defend ? {
    attack,
    defend
  } : null;
}
export function shapeNote(shape, outfield) {
  const n = (SHAPE_NOTES[outfield] || {})[shape];
  if (n) return n;
  const z = shapeZones(shape);
  if (!z) return null;
  return {
    style: "Custom",
    tag: "",
    sum: z.D + " at the back, " + z.M + " in the middle, " + z.F + " up top.",
    use: "",
    avoid: "",
    key: ""
  };
}
// How to get from one shape to another, as a sideline instruction. `home` is
// the team's own home shape (Settings); GameDay's curated calls are written
// from its HOME_SHAPE, so they're used only when moving off that shape. Any
// other move gets the one-move call name (shapeCall) in front when it has one.
export function describeChange(from, to, outfield, home = HOME_SHAPE[outfield] || "") {
  if (!from || !to) return "";
  if (from === to) return "No change";
  const curated = (HOME_CALLS[outfield] || {})[to];
  if (curated && from === (HOME_SHAPE[outfield] || "")) return curated;
  if (to === home) return "Back to the home shape " + to;
  const a = shapeZones(from),
    b = shapeZones(to);
  if (!a || !b) return "";
  let dD = b.D - a.D,
    dM = b.M - a.M,
    dF = b.F - a.F;
  const parts = [];
  for (let guard = 0; guard < 6 && (dD || dM || dF); guard++) {
    if (dD > 0 && dM < 0) { parts.push("a midfielder drops into defence"); dD--; dM++; }
    else if (dD > 0 && dF < 0) { parts.push("a forward drops all the way back"); dD--; dF++; }
    else if (dD < 0 && dM > 0) { parts.push("a back steps into midfield"); dD++; dM--; }
    else if (dD < 0 && dF > 0) { parts.push("a back pushes up front"); dD++; dF--; }
    else if (dM < 0 && dF > 0) { parts.push("a midfielder joins the attack"); dM++; dF--; }
    else if (dM > 0 && dF < 0) { parts.push("a forward drops into midfield"); dM--; dF++; }
    else break;
  }
  if (!parts.length) return "Same lines, different spacing";
  const s = parts.join(", ");
  const name = shapeCall(from, to);
  return name ? name + ": " + s : s.charAt(0).toUpperCase() + s.slice(1);
}
export function resolveTheirShape(val, outfield) {
  if (!val) return "";
  if (String(val).slice(0, 2) === "t:") {
    const t = THEIR_TRAITS.find(x => x.id === String(val).slice(2));
    return t && t.shape[outfield] || "";
  }
  return String(val);
}
export function theirLabel(val, outfield) {
  if (!val) return "";
  if (String(val).slice(0, 2) === "t:") {
    const t = THEIR_TRAITS.find(x => x.id === String(val).slice(2));
    return t ? t.label.toLowerCase() : "";
  }
  return String(val);
}
