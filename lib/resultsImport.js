// A one-off import of a season's results, for a draw that keeps none (Squadi
// shows every game of a MiniRoos-age season as an unconfirmed 0-0, so the
// sync never takes a season's scores). A coach pastes one game per line, the
// round and the score, ours first, or that the game was rained out:
//
//   R1 Hilltop United 2-5
//   Round 6 rained out
//   R9 W 3-2
//
// Each line is matched to the season game of that round (not another
// competition's, not a carnival's) and read back before anything is saved.
// Only a game with no score yet takes one, and only a game not played or
// scored is marked rained out: a score a coach already entered is never
// changed. Pure: no store, no network.
import { countsForSeason } from "@/lib/dashboardData";

export const MAX_LINES = 200;
const ROUND = /\b(?:r|rd|round)\s*\.?\s*(\d{1,3})\b/i;
const OFF = /\b(?:rain(?:ed)?\s*out|wash(?:ed)?\s*out|cancell?ed|abandoned|called\s*off)\b/i;
// Dates are taken out before a score is looked for, so 2026-05-10 or 10/05 is
// never read as a score.
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATES = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?\\b|\\b(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)(?:day)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b|\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi");
const SCORE = /(?<![\d-])(\d{1,2})\s*[-–—]\s*(\d{1,2})(?![\d-])/g;
const RESULT_WORD = /\b(w|won|win|l|lost|loss|d|drew|draw)\b(?=[^a-z]*$|\s+\d)/i;
const NOISE = /\b(?:vs?|at|v|home|away|fc|sc|the|and|club|game|match|round|rd|r|result|score|w|won|win|l|lost|loss|d|drew|draw)\b/gi;

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);

// One pasted line, read: { text, round, score?: { us, them }, off?: true,
// said?: "W"|"L"|"D", rest: [words], error? }. `rest` is what is left once the
// round, the score, dates and the usual words are taken out: the opponent, if
// the line names one, to check against the game's.
export function readResultLine(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const line = { text };
  const r = ROUND.exec(text);
  if (!r) return { ...line, error: "No round number" };
  line.round = Number(r[1]);
  let rest = text.replace(ROUND, " ").replace(DATES, " ");
  if (OFF.test(rest)) {
    line.off = true;
    rest = rest.replace(OFF, " ");
  } else {
    const scores = [...rest.matchAll(SCORE)];
    if (!scores.length) return { ...line, error: "No score, and not marked rained out" };
    const last = scores[scores.length - 1];
    line.score = { us: Number(last[1]), them: Number(last[2]) };
    rest = rest.slice(0, last.index) + " " + rest.slice(last.index + last[0].length);
    const w = RESULT_WORD.exec(rest);
    if (w) line.said = w[1][0].toUpperCase();
  }
  line.rest = words(rest.replace(NOISE, " "));
  return line;
}

const outcome = (s) => (s.us > s.them ? "W" : s.us < s.them ? "L" : "D");
const said = { W: "a win", L: "a loss", D: "a draw" };

// What each line would do to the team's season games:
//   [{ line, game?, action, note }]
// action is "score" or "off" (will be saved), "same" (already so), or "skip"
// with the reason in `note`.
export function planResults(data, text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES).map(readResultLine);
  const season = (data?.fixtures || []).filter((f) => f && countsForSeason(data, f) && f.round != null);
  const used = new Set();
  return lines.map((line) => {
    if (line.error) return { line, action: "skip", note: line.error };
    const inRound = season.filter((f) => f.round === line.round);
    if (!inRound.length) return { line, action: "skip", note: `No season game in round ${line.round}` };
    // A squad that plays as two teams has two games a round: the line names the side.
    const sides = inRound.filter((f) => f.side && line.rest.includes(String(f.side).toLowerCase()));
    const game = inRound.length === 1 ? inRound[0] : sides.length === 1 ? sides[0] : null;
    if (!game) return { line, action: "skip", note: `Round ${line.round} has ${inRound.length} games: name the side` };
    if (used.has(game.id)) return { line, game, action: "skip", note: `Round ${line.round} is given twice: only the first line is used` };
    used.add(game.id);
    // Any other name on the line must be the game's opponent's, word for word.
    const opp = new Set(words(game.opponent));
    const named = line.rest.filter((w) => !(game.side && w === String(game.side).toLowerCase()));
    if (named.length && !named.every((w) => opp.has(w))) return { line, game, action: "skip", note: `Round ${line.round} is against ${game.opponent}` };
    const scored = game.us != null || game.them != null;
    if (line.off) {
      if (game.status === "cancelled") return { line, game, action: "same", note: "Already rained out" };
      if (scored) return { line, game, action: "skip", note: `Already has a score (${game.us}–${game.them}): left as it is` };
      return { line, game, action: "off", note: "Rained out" };
    }
    const s = line.score;
    if (line.said && line.said !== outcome(s)) return { line, game, action: "skip", note: `Says ${said[line.said]}, but ${s.us}–${s.them} is ${said[outcome(s)]}: put our score first` };
    if (scored) {
      return game.us === s.us && game.them === s.them
        ? { line, game, action: "same", note: "Already has this score" }
        : { line, game, action: "skip", note: `Already has a score (${game.us}–${game.them}): left as it is` };
    }
    if (game.status === "cancelled") return { line, game, action: "skip", note: "Marked cancelled: left as it is" };
    return { line, game, action: "score", note: `${{ W: "Won", L: "Lost", D: "Drew" }[outcome(s)]} ${s.us}–${s.them}` };
  });
}

// The team's document with a plan's scores and rained-out games in it. A
// scored game is played; a rained-out one is cancelled, with no score.
export function applyResults(data, plan) {
  const by = new Map(plan.filter((p) => p.action === "score" || p.action === "off").map((p) => [p.game.id, p]));
  if (!by.size) return data;
  return {
    ...data,
    fixtures: (data.fixtures || []).map((f) => {
      const p = f && by.get(f.id);
      if (!p) return f;
      return p.action === "off"
        ? { ...f, status: "cancelled", us: null, them: null }
        : { ...f, status: "played", us: p.line.score.us, them: p.line.score.them };
    })
  };
}
