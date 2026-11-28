// What Ask is told about the team besides its documents: today's date, the
// team's kit, and every game, played and to come, with its competition and
// round, the ground, kick-off and when to arrive, the kit to wear, the result
// or that it was called off, and who is on each duty. Then training and the
// team's other dates, the season's record and the squad's size.
//
// Pure: the route passes the team's document and today's date in Brisbane.
// People are named as the app's duty cards name them ("Sam S."), and nothing
// else about anyone is given: no emails, phone numbers or birthdays.
import { roundLabel, competitionOf, computeStats, carnivalOf, isCarnival, sideOf } from "@/lib/dashboardData";
import { teamFeatures, gameKit, sanitizeStrip, KITS } from "@/lib/teamSetup";
import { shiftTime } from "@/lib/askCanned";
import { roundNameText } from "@/lib/rounds";
import { sanitizeCompFormat, formatWords } from "@/lib/competitions";

// Games beyond this many: the oldest are left out (coming games never are).
export const MAX_GAMES = 150;
const pad2 = (n) => String(n).padStart(2, "0");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

// Today's date in Brisbane, yyyy-mm-dd. The server keeps UTC; Brisbane is
// UTC+10 all year (no daylight saving).
export function brisbaneToday(now = Date.now()) {
  const d = new Date(now + 10 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Dates are written out here rather than by toLocaleDateString, whose short
// months vary ("Jun" or "June") with the server's locale data.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const at = (iso) => new Date(iso + "T00:00:00Z");
// "Saturday 28 November 2026"
const longDate = (iso) => { const d = at(iso); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// "Sun 8 Feb 2026"
const shortDate = (iso) => {
  if (!DATE.test(iso || "")) return "date to be confirmed";
  const d = at(iso);
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
};
const clean = (s, max = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// "Sam Smith" -> "Sam S.", as on the app's duty cards.
const shortName = (name) => {
  const parts = clean(name, 80).split(" ").filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] || "");
};

// The duties a team can switch on, worded as the app words them.
const DUTIES = [
  { key: "fruit", feat: "fruitDuty", label: "fruit duty", family: true },
  { key: "gk", feat: "gkDuty", label: "in goal", family: false },
  { key: "jersey", feat: "jerseyDuty", label: "washing the jerseys", family: true }
];

// Which competition and round: "Season, round 7", "Winterfest · Round 2",
// "Summer Fives · Semi Finals" (a finals round named by its draw), "Summer
// Fives" (a finals game with no name), "Carnival: Winter carnival".
function whatFor(data, f) {
  const carnival = carnivalOf(data, f);
  if (carnival) return `Carnival: ${clean(carnival.title, 60)}`;
  if (competitionOf(f)) return roundLabel(f);
  const named = roundNameText(f.roundName);
  return f.round ? `Season, round ${f.round}` : named ? `Season, ${named}` : "Season";
}

// played / called off / coming up, from the game's own record and the date.
function stateOf(f, today) {
  if (f.status === "cancelled") return "called off (cancelled), not played";
  if (Number.isInteger(f.us) && Number.isInteger(f.them)) {
    const word = f.us > f.them ? "won" : f.us < f.them ? "lost" : "drew";
    const pens = f.pens && Number.isInteger(f.pens.us) && Number.isInteger(f.pens.them)
      ? `, ${f.pens.us > f.pens.them ? "won" : "lost"} ${f.pens.us}–${f.pens.them} on penalties` : "";
    return `${word} ${f.us}–${f.them}${pens}`;
  }
  if (f.status === "played" || (DATE.test(f.dateISO || "") && f.dateISO < today)) return "played, score not recorded";
  return "coming up";
}

function dutiesOf(data, f, coming) {
  const feats = teamFeatures(data.team);
  const byId = new Map((data.players || []).filter((p) => p && p.id != null).map((p) => [p.id, p]));
  const out = [];
  for (const d of DUTIES) {
    if (!feats[d.feat]) continue;
    const p = f[d.key] ? byId.get(f[d.key]) : null;
    const who = p ? (d.family ? `${shortName(p.name)}'s family` : shortName(p.name)) : "";
    if (who) out.push(`${d.label}: ${who}`);
    else if (coming) out.push(`${d.label}: not assigned yet`);
  }
  return out;
}

function gameLine(data, f, today) {
  const state = stateOf(f, today);
  const coming = state === "coming up";
  const time = TIME.test(f.time || "") ? ` ${f.time}` : "";
  const side = sideOf(data, f);
  const where = f.homeAway === "A" ? "away at" : f.homeAway === "H" ? "home vs" : "vs";
  const parts = [
    `${shortDate(f.dateISO)}${time}`,
    whatFor(data, f) + (side ? ` (our ${clean(side, 20)} side)` : ""),
    `${where} ${clean(f.opponent, 80) || "opponent to be confirmed"}`,
    `ground: ${clean(f.venue) || "to be confirmed"}`,
    state
  ];
  if (coming && time) parts.push(`arrive by ${shiftTime(f.time, -30)}`);
  // A competition played in a format of its own (the club's set-up, sent with
  // the team's document as data.competitionFormats) says so on its games.
  const own = coming && typeof f.comp === "string" ? sanitizeCompFormat(data.competitionFormats?.[f.comp]) : null;
  if (own) parts.push(`format: ${formatWords(own)}`);
  if (coming) {
    const k = gameKit(data.team, f);
    if (k) parts.push(`kit: ${k.colour} (${k.name})${k.from === "game" && sanitizeStrip(data.team?.strip) && k.strip !== data.team.strip ? ", switched for this game" : ""}`);
  }
  parts.push(...dutiesOf(data, f, coming));
  if (teamFeatures(data.team).focus && clean(f.focusTitle, 80)) parts.push(`focus: ${clean(f.focusTitle, 80)}`);
  return "- " + parts.join(" | ");
}

const sessionTime = (s) => (TIME.test(s.time || "") ? ` ${s.time}${TIME.test(s.endTime || "") ? `–${s.endTime}` : ""}` : "");
function sessionLine(s) {
  const title = clean(s.title, 60) || (isCarnival(s) ? "Carnival" : "Training");
  const where = clean(s.location) ? ` at ${clean(s.location)}` : "";
  if (s.recur === "weekly") {
    const day = Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 ? `every ${DAYS[s.weekday]}` : "weekly";
    const from = DATE.test(s.startISO || "") ? ` from ${shortDate(s.startISO)}` : "";
    const until = DATE.test(s.untilISO || "") ? ` until ${shortDate(s.untilISO)}` : "";
    return `- ${title}: ${day}${sessionTime(s)}${where}${from}${until}`;
  }
  return `- ${isCarnival(s) ? "Carnival: " : ""}${title}: ${shortDate(s.dateISO)}${sessionTime(s)}${where}`;
}

// The LIVE TEAM DATA block of Ask's prompt.
export function askTeamData(data, today) {
  const team = data?.team || {};
  const games = (Array.isArray(data?.fixtures) ? data.fixtures : []).filter((f) => f && typeof f === "object" && !f.bye);
  const byWhen = (a, b) => String(a.dateISO || "9999").localeCompare(String(b.dateISO || "9999")) || String(a.time || "").localeCompare(String(b.time || ""));
  const sorted = [...games].sort(byWhen).slice(-MAX_GAMES);
  const lines = [];
  lines.push(`Today is ${DATE.test(today || "") ? longDate(today) : "unknown"} (Brisbane).`);
  const about = [clean(team.ageGroup, 20), clean(team.division, 80)].filter(Boolean).join(", ");
  lines.push(`Team: ${clean(team.name, 80) || "the team"}${about ? ` (${about})` : ""}.`);

  const usual = KITS.find((k) => k.strip === sanitizeStrip(team.strip));
  lines.push(`Kit: the club's home kit is red and its away kit is blue. ${usual
    ? `This team wears the ${usual.colour} ${usual.name}, unless a game below says it was switched.`
    : "This team's usual kit isn't set; a game below names its kit when the coach set one."}`);

  const next = sorted.find((f) => stateOf(f, today) === "coming up");
  if (next) lines.push(`Next game: ${shortDate(next.dateISO)}${TIME.test(next.time || "") ? ` ${next.time}` : ""}, ${whatFor(data, next)}, ${next.homeAway === "A" ? "away at" : "vs"} ${clean(next.opponent, 80)}.`);

  lines.push("", "GAMES (oldest first; scores are ours first):");
  if (sorted.length) lines.push(...sorted.map((f) => gameLine(data, f, today)));
  else lines.push("- none on the schedule yet");
  if (games.length > sorted.length) lines.push(`(${games.length - sorted.length} older games left out)`);

  const sessions = (Array.isArray(data?.sessions) ? data.sessions : []).filter((s) => s && typeof s === "object");
  if (sessions.length) lines.push("", "TRAINING AND OTHER DATES:", ...sessions.slice(0, 40).map(sessionLine));

  // The record is a summary, never a reason for Ask to fail: odd data just leaves it out.
  let stats = null;
  try { stats = Array.isArray(data?.fixtures) && Array.isArray(data?.players) ? computeStats(data) : null; } catch { stats = null; }
  if (stats && stats.played) {
    lines.push("", `Season record (season games only; other competitions and carnivals don't count): played ${stats.played}, won ${stats.w}, drawn ${stats.dr}, lost ${stats.l}; ${stats.gf} goals for, ${stats.ga} against.`);
  }
  lines.push(`Squad: ${(data?.players || []).length} players.`);
  return lines.join("\n");
}
