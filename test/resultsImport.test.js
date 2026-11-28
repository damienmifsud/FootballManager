import { describe, it, expect } from "vitest";
import { readResultLine, planResults, applyResults } from "@/lib/resultsImport";

// lib/resultsImport: a one-off import of a season's results, pasted one game
// per line, for a draw that keeps none. Every name here is made up.
const game = (round, opponent, over = {}) => ({ id: "f" + round, squadiId: 900000 + round, round, dateISO: `2026-03-${String(round).padStart(2, "0")}`, time: "09:00", opponent, homeAway: round % 2 ? "H" : "A", status: "played", us: null, them: null, ...over });
const data = (fixtures, over = {}) => ({ team: { name: "Us FC" }, players: [], fixtures, ...over });
const SEASON = [
  game(1, "Hilltop United U10 Boys"), game(2, "Lakeside Rovers U10 Boys"), game(3, "Valley Wanderers U10 Boys"),
  game(4, "Seaside FC U10 Boys"), game(5, "Ridge FC U10 Boys")
];

describe("readResultLine", () => {
  it("reads the round and the score, ours first, from a line in any of the usual forms", () => {
    expect(readResultLine("R1 Hilltop United 4-6")).toMatchObject({ round: 1, score: { us: 4, them: 6 }, rest: ["hilltop", "united"] });
    expect(readResultLine("Round 12 – 3 – 1")).toMatchObject({ round: 12, score: { us: 3, them: 1 }, rest: [] });
    expect(readResultLine("Rd 7, 10 May, at Lakeside Rovers, L 1-10")).toMatchObject({ round: 7, score: { us: 1, them: 10 }, said: "L", rest: ["lakeside", "rovers"] });
    expect(readResultLine("R19 Jun 28 vs Hilltop United W 3-2")).toMatchObject({ round: 19, score: { us: 3, them: 2 }, said: "W" });
    expect(readResultLine("R27 Valley Wanderers 1-4 loss")).toMatchObject({ round: 27, score: { us: 1, them: 4 }, said: "L" });
  });
  it("never takes a date for a score", () => {
    expect(readResultLine("R2 2026-05-10 Seaside FC 2-2")).toMatchObject({ score: { us: 2, them: 2 }, rest: ["seaside"] });
    expect(readResultLine("R2 10/05 Seaside FC 0-3")).toMatchObject({ score: { us: 0, them: 3 } });
    expect(readResultLine("R2 Sunday 10th May 1-1").score).toEqual({ us: 1, them: 1 });
    expect(readResultLine("R2 Sunshine Rovers 1-1").rest).toEqual(["sunshine", "rovers"]);
  });
  it("reads a game that was rained out, washed out, cancelled, abandoned or called off", () => {
    for (const t of ["R6 at Ridge FC Rained Out", "Round 6 washed out", "R6 cancelled", "R6 abandoned", "R6 called off", "R6 rain out"]) {
      expect(readResultLine(t)).toMatchObject({ round: 6, off: true });
    }
  });
  it("says what is missing from a line it cannot use", () => {
    expect(readResultLine("Hilltop United 4-6").error).toBe("No round number");
    expect(readResultLine("R4 Hilltop United").error).toBe("No score, and not marked rained out");
  });
});

describe("planResults", () => {
  it("matches each line to the season game of its round, and says what it will do", () => {
    const plan = planResults(data(SEASON), "R1 Hilltop United 4-6\nR2 Lakeside Rovers W 7-4\n\nR3 rained out\nR4 Seaside 5-5");
    expect(plan.map((p) => [p.line.round, p.game?.id, p.action, p.note])).toEqual([
      [1, "f1", "score", "Lost 4–6"], [2, "f2", "score", "Won 7–4"], [3, "f3", "off", "Rained out"], [4, "f4", "score", "Drew 5–5"]
    ]);
  });
  it("never changes a score a coach entered, or a cancelled game, and says so", () => {
    const season = [game(1, "Hilltop United U10 Boys", { us: 2, them: 1 }), game(2, "Lakeside Rovers U10 Boys", { status: "cancelled" }), game(3, "Valley Wanderers U10 Boys", { us: 0, them: 0 })];
    expect(planResults(data(season), "R1 3-3\nR2 1-0\nR3 rained out\nR1 2-1").map((p) => [p.action, p.note])).toEqual([
      ["skip", "Already has a score (2–1): left as it is"], ["skip", "Marked cancelled: left as it is"],
      ["skip", "Already has a score (0–0): left as it is"], ["skip", "Round 1 is given twice: only the first line is used"]
    ]);
    expect(planResults(data(season), "R1 2-1\nR2 rained out").map((p) => p.action)).toEqual(["same", "same"]);
  });
  it("leaves out a line that names another opponent, says a result its score does not, or has no game", () => {
    expect(planResults(data(SEASON), "R1 Lakeside Rovers 4-6\nR2 L 6-4\nR9 2-0\nnonsense").map((p) => p.note)).toEqual([
      "Round 1 is against Hilltop United U10 Boys", "Says a loss, but 6–4 is a win: put our score first", "No season game in round 9", "No round number"
    ]);
  });
  it("only ever matches season games: never another competition's or a carnival's", () => {
    const fixtures = [game(1, "Hilltop United U10 Boys", { comp: "c1", compName: "Winter Cup" }), game(1, "Ridge FC U10 Boys", { id: "carn", carnivalId: "k1" })];
    const plan = planResults(data(fixtures, { sessions: [{ id: "k1", kind: "carnival", title: "Gala day", dateISO: "2026-03-01" }] }), "R1 3-0");
    expect([plan[0].action, plan[0].note]).toEqual(["skip", "No season game in round 1"]);
  });
  it("asks for the side on a squad that plays two games a round, and takes the side named", () => {
    const two = [game(1, "Hilltop United U10 Boys", { id: "a", side: "Reds" }), game(1, "Lakeside Rovers U10 Boys", { id: "b", side: "Blues" })];
    const d = data(two, { team: { name: "Us FC", sides: ["Reds", "Blues"] } });
    expect(planResults(d, "R1 3-0")[0].note).toBe("Round 1 has 2 games: name the side");
    expect(planResults(d, "R1 Blues Lakeside Rovers 3-0\nR1 Reds 1-1").map((p) => [p.game?.id, p.action])).toEqual([["b", "score"], ["a", "score"]]);
  });
});

describe("applyResults", () => {
  it("puts each score on its game as played, marks a rained-out game cancelled, and touches nothing else", () => {
    const d = data([...SEASON, game(6, "Coastal FC U10 Boys", { us: 1, them: 0, notes: "Great game" })]);
    const next = applyResults(d, planResults(d, "R1 4-6\nR2 rained out\nR6 9-9"));
    expect(next.fixtures.map((f) => [f.id, f.status, f.us, f.them])).toEqual([
      ["f1", "played", 4, 6], ["f2", "cancelled", null, null], ["f3", "played", null, null], ["f4", "played", null, null], ["f5", "played", null, null], ["f6", "played", 1, 0]
    ]);
    expect(next.fixtures[5].notes).toBe("Great game");
    expect(next.fixtures[0]).toMatchObject({ opponent: "Hilltop United U10 Boys", round: 1, dateISO: "2026-03-01" });
    expect(applyResults(d, planResults(d, "nonsense"))).toBe(d);
  });
});
