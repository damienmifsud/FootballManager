// Squads for the lineup engine tests (test/lineup.test.js).
import { makePositions, parseFormation, computeAutoSubs, computeSegments } from "@/lib/planner";
import { buildLineupCtx } from "@/lib/lineup";
import { DEFAULT_RULES } from "@/lib/teamSetup";

const R = (GK, DEF, MID, FWD) => ({ GK, DEF, MID, FWD });
export const player = (id, name, ratings, extra = {}) => ({ id, name, number: "", available: true, ratings, ...extra });

// (a) GameDay's 7v7 squad: 10 players, 40' in two halves, subs every 10'.
// Spencer is the only keeper (GK 4); everyone else is GK 0.
export const SQUAD_7 = [
  player("sp", "Spencer Lee", R(4, 2, 2, 1)),
  player("he", "Henry Ash", R(0, 4, 3, 2)),
  player("se", "Seyjan Rao", R(0, 3, 2, 2)),
  player("ma", "Max Bell", R(0, 2, 4, 3)),
  player("ol", "Oli Grant", R(0, 1, 3, 4)),
  player("ja", "Jack Moss", R(0, 3, 3, 3)),
  player("le", "Leo Park", R(0, 2, 2, 5)),
  player("ru", "Rubi Hart", R(0, 0, 2, 3)),
  player("ai", "Aiden Cole", R(0, 3, 1, 0)),
  player("ni", "Nico Vale", R(0, 2, 3, 2))
];
export const FORMAT_7 = { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };

// (b) 9v9, 60' in three thirds, subs every 5', 13 available.
const names = ["Ava", "Ben", "Cal", "Dev", "Eli", "Finn", "Gus", "Hugo", "Isla", "Jai", "Kai", "Liam", "Mia"];
export const SQUAD_9 = names.map((n, i) => player("b" + i, n + " Smith",
  R(i === 0 ? 4 : i === 5 ? 3 : i % 4 === 0 ? 1 : 0, 1 + (i % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5))));
export const FORMAT_9 = { gameLength: 60, periods: 3, playersOnField: 9, hasGK: true, formation: "3-4-1", subInterval: 5 };

// (c) The 7v7 squad with four players never rated.
export const SQUAD_UNRATED = SQUAD_7.map((p, i) => (i >= 6 ? { ...p, ratings: null } : p));

export function setup(squad, format, { rules = DEFAULT_RULES, opposition = "even" } = {}) {
  const positions = makePositions(parseFormation(format.formation), format.hasGK);
  const segments = computeSegments(format.gameLength, format.periods, computeAutoSubs(format.gameLength, format.periods, format.subInterval));
  const ctx = buildLineupCtx({ segments, positions, roster: squad, rules, format, opposition });
  return { positions, segments, ctx, empty: segments.map(() => ({})) };
}
