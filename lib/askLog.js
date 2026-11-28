// The questions asked on a team's Ask tab, kept with who asked them, for the
// super admin's Questions section in Club admin. One entry per question:
//
//   { at, q, a?, how, who: { email?, label, as? } }
//
// at:   when it was asked (ISO time, from the server's clock)
// q:    the question as typed (or the quick question tapped), trimmed
// a:    the assistant's answer, trimmed; a quick answer worked out on the
//       phone is not kept, as it is only the team's own schedule read back
// how:  "assistant" (answered by the assistant), "quick" (a quick answer on
//       the phone) or "failed" (the assistant couldn't be reached or erred)
// who:  the sign-in that asked (`email`) and what they were on the team at
//       the time (`label`, as the Viewing-as chip says it: "Parent of Sam",
//       "Head coach", "Player"). A super admin viewing as someone is kept as
//       themselves, with `as` the person they were viewing as; the label is
//       that person's. In team-code mode nobody is signed in, so there is no
//       email: "Someone with the team code".
//
// Each team keeps its newest ASK_LOG_MAX questions (lib/store.js addAskLog),
// and a team's questions go when the team is removed.
import { hatLabel } from "@/lib/hats";

export const ASK_LOG_MAX = 500;
export const QUESTION_MAX = 1000;
export const ANSWER_MAX = 1500;
export const ASK_HOWS = ["assistant", "quick", "failed"];
export const CODE_ASKER = "Someone with the team code";

const line = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// An answer keeps its line breaks (a list reads as one), with no run of
// blank lines and no spaces at the ends of lines.
const prose = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const emailOf = (v) => { const e = line(v, 200).toLowerCase(); return e.includes("@") ? e : ""; };

// Who asked, from lib/viewer.js's resolve (or { mode: "code" } in team-code mode).
export function whoAsked(viewer) {
  if (!viewer || viewer.mode !== "account") return { label: CODE_ASKER };
  const email = emailOf(viewer.realEmail || viewer.email);
  const as = viewer.impersonating ? emailOf(viewer.impersonating) : "";
  return { ...(email ? { email } : {}), label: line(hatLabel(viewer.hat), 120) || "Signed in", ...(as && as !== email ? { as } : {}) };
}

// One question as it is kept, or null when there is no question.
export function askLogEntry({ question, answer = "", how = "assistant", viewer, at = new Date().toISOString() } = {}) {
  const q = line(question, QUESTION_MAX);
  if (!q) return null;
  const kind = ASK_HOWS.includes(how) ? how : "assistant";
  const a = kind === "assistant" ? prose(answer, ANSWER_MAX) : "";
  return { at: String(at), q, ...(a ? { a } : {}), how: kind, who: whoAsked(viewer) };
}

// A kept entry, checked on the way out: anything not in the shape above is
// dropped, so a hand-edited or older list can never break the page.
export function cleanAskEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const q = line(raw.q, QUESTION_MAX);
  const at = typeof raw.at === "string" && !Number.isNaN(Date.parse(raw.at)) ? raw.at : "";
  if (!q || !at) return null;
  const who = raw.who && typeof raw.who === "object" ? raw.who : {};
  const email = emailOf(who.email), as = emailOf(who.as);
  const how = ASK_HOWS.includes(raw.how) ? raw.how : "assistant";
  const a = how === "assistant" ? prose(raw.a, ANSWER_MAX) : "";
  return { at, q, ...(a ? { a } : {}), how, who: { ...(email ? { email } : {}), label: line(who.label, 120) || (email ? "Signed in" : CODE_ASKER), ...(as ? { as } : {}) } };
}

// Every team's questions as one list, newest first: [{ ...entry, team, teamName }].
// `lists` is [{ slug, name, entries }]; at most `limit` come back.
export function mergeAskLogs(lists, limit = ASK_LOG_MAX) {
  const all = [];
  for (const { slug, name, entries } of lists || []) {
    for (const e of Array.isArray(entries) ? entries : []) {
      const clean = cleanAskEntry(e);
      if (clean) all.push({ ...clean, team: slug, teamName: name || slug });
    }
  }
  return all.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limit);
}

// How a question was answered, in words for the Questions section.
export const HOW_WORDS = {
  assistant: "Answered by the assistant",
  quick: "Quick answer on the phone",
  failed: "The assistant couldn't answer"
};

// Who asked, in words: { line: "Jane Smith · Parent of Sam", email }. A
// super admin viewing as someone reads "Kim Lee, viewing as
// jane@example.com (Parent of Sam)". `name` is the club's own name for the
// email (lib/directory.js clubPeople), "" when it has none.
export function askerWords(who, name = "") {
  const w = who && typeof who === "object" ? who : {};
  if (!w.email) return { line: w.label || CODE_ASKER, email: "" };
  const n = line(name, 80);
  if (w.as) return { line: `${n ? `${n}, viewing` : "Viewing"} as ${w.as} (${w.label})`, email: w.email };
  return { line: [n, w.label].filter(Boolean).join(" · "), email: w.email };
}
