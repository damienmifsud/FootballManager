// Ported from GameDay v8's shapes.js calls — only the labels and the one-move
// classifier for now; nothing else from that file yet.
//
// A "call" is what the coach shouts when the team changes shape mid-game.
// shapeCall(from, to) names the change when exactly one player moves one row
// (three-row shapes are def/mid/fwd, two-row shapes def/fwd); every other
// change (same shape, different squad size, a diagonal or two-row hop, four or
// more rows) has no call and returns null. All pure.
import { parseFormation } from "@/lib/planner";

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
