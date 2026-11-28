// Canned answers for the Ask tab's question chips (S9, Direction C).
//
// Every answer here is computed from the team's live data — the schedule, the
// coach's season focuses and the match format set in Team settings — so it is
// true for this team, and each carries a source line. A question with no sourced
// answer returns null and the tab sends it to /api/ask like free text.
import { nextFixture, fmtDate, roundLabel } from "@/lib/dashboardData";
import { teamFeatures, gameKit } from "@/lib/teamSetup";

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
// "Passing, Receiving and Dribbling"
const joinAnd = (items) => items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
// Chip questions and typed questions are compared apostrophe- and case-insensitively.
const norm = (s) => String(s || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const pad2 = (n) => String(n).padStart(2, "0");
// "08:00" − 30 → "07:30" (wraps within the day, like the Dashboard's addMin).
export function shiftTime(time, mins) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  let total = (h * 60 + m + mins) % 1440; if (total < 0) total += 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

// Head coach's first name, tolerant of the older flat team fields; null when
// the team has no head coach recorded.
export function headCoachFirst(team) {
  const staff = Array.isArray(team?.staff) ? team.staff : null;
  const name = staff
    ? (staff.find((s) => /head coach/i.test(s?.role || "") && s?.name)?.name || "")
    : (team?.headCoach || "");
  return firstName(name) || null;
}

// The team's age group as written in settings ("U8"), or "" when unset.
export const ageGroupOf = (team) => String(team?.ageGroup || "").trim();

export const FALLBACK_LEAD = "That isn't covered by the team's documents or schedule, so I won't guess. Try fixtures, training, duties or the team's documents";
// README §11 fallback, verbatim, naming the head coach when there is one.
export function askFallback(team) {
  const coach = headCoachFirst(team);
  return `${FALLBACK_LEAD} — or message ${coach ? `Coach ${coach}` : "the coach"}.`;
}

// The four chips, in order.
export function cannedQuestions(data) {
  const ag = ageGroupOf(data?.team);
  return [
    "When and where is our next game?",
    "What are this season's match focuses?",
    ag ? `How long are the halves at ${ag}?` : "How long are the halves?",
    "What's the wet weather policy?"
  ];
}

function nextGameAnswer(data) {
  const f = nextFixture(data);
  if (!f) return { text: "There's no upcoming game on the schedule yet.", src: "Team schedule" };
  const head = `${roundLabel(f) || "Next game"} vs ${f.opponent || "an opponent to be confirmed"}`;
  const when = f.dateISO ? fmtDate(f.dateISO) : "date to be confirmed";
  const kick = f.time ? `kick-off ${f.time}` : "kick-off time to be confirmed";
  const where = f.venue ? ` at ${f.venue}` : ", venue to be confirmed";
  const side = f.homeAway === "H" ? "We're the home side." : f.homeAway === "A" ? "We're away." : "";
  // The game's kit: its own when the coach switched it, else the team's. Being
  // home or away doesn't decide it: a team can wear either kit as a rule.
  const k = gameKit(data.team, f);
  const kit = k ? `Wear the ${k.colour} ${k.name}.` : "";
  const arrive = f.time ? `Aim to be there by ${shiftTime(f.time, -30)} for warm-up.` : "";
  const text = [`${head} — ${when}, ${kick}${where}.`, side, kit, arrive].filter(Boolean).join(" ");
  return { text, src: "Team schedule" };
}

function focusesAnswer(data) {
  if (!teamFeatures(data?.team).focus) return null;
  const titles = [];
  for (const f of data?.fixtures || []) {
    const t = String(f?.focusTitle || "").trim();
    if (t && !titles.includes(t)) titles.push(t);
  }
  if (!titles.length) return null;
  const coach = headCoachFirst(data.team);
  const current = String(nextFixture(data)?.focusTitle || "").trim();
  const lead = titles.length === 1 ? `This season's focus: ${titles[0]}.` : `This season's focuses: ${joinAnd(titles)}.`;
  const weekly = !current ? ""
    : coach ? ` Coach ${coach} highlights one each week — this week it's ${current}.`
    : ` One is highlighted each week — this week it's ${current}.`;
  return { text: lead + weekly, src: "Coach notes · Season focuses" };
}

// The team's halves, from the match format the coach set in Team settings:
// the only one we can vouch for (an age group's usual format would be a guess,
// and a program's rules are in its documents, which the API answers from).
function halvesAnswer(data) {
  const ag = ageGroupOf(data?.team);
  if (!ag) return null;
  const mf = data?.team?.matchFormat;
  if (mf && mf.periods === 2 && mf.gameLength) {
    const side = mf.playersOnField ? ` It's ${mf.playersOnField}-a-side${mf.hasGK ? " including a goalkeeper" : ""}.` : "";
    return { text: `${ag} plays two ${Math.round(mf.gameLength / 2)}-minute halves.${side}`, src: "Team settings · Match format" };
  }
  return null;
}

function wetWeatherAnswer(data) {
  const policy = String(data?.team?.wetWeather || "").trim();
  return policy ? { text: policy, src: "Team info · Wet weather" } : null;
}

// { text, src } for a canned question, or null when the question isn't one of
// the four or the data can't answer it truthfully (the tab then asks the API).
export function cannedAnswer(data, question) {
  const q = norm(question);
  if (!q) return null;
  const [game, focuses, halves, wet] = cannedQuestions(data).map(norm);
  if (q === game) return nextGameAnswer(data);
  if (q === focuses) return focusesAnswer(data);
  if (q === halves) return halvesAnswer(data);
  if (q === wet) return wetWeatherAnswer(data);
  return null;
}
