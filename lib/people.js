// Pure helpers for the people page in club admin: how one person's roles
// read as pills, what a search matches, and team names short enough to sit in
// a pill. Client-safe (no store, no Next imports); the data comes from
// lib/directory.js clubPeople() by way of /api/people.
import { hatLabel } from "@/lib/hats";

// What an override reads as, in the pills and in the role menu.
export const OVERRIDE_LABELS = { coach: "Coach", parent: "Parent only", viewer: "View only", blocked: "No access" };

const words = (name) => String(name || "").trim().split(/\s+/).filter(Boolean);

// Team names without the club's own name in front, for use where space is
// tight: "Riverside FC U9 Reds" reads as "U9 Reds" when most of the club's
// teams start with "Riverside FC". The prefix is the longest run of leading
// words that more than half the teams share (and at least two of them). A
// name keeps its full form when it does not start that way, or when dropping
// the prefix would leave a single word ("Riverside FC Seniors" stays whole).
// Returns a function from a full name to its short form.
export function shortTeamNames(names) {
  const list = [...new Set((names || []).map((n) => String(n || "").trim()).filter(Boolean))];
  const split = list.map(words);
  const longest = Math.max(0, ...split.map((w) => w.length - 1));
  let prefix = null;
  for (let k = longest; k >= 1 && !prefix; k--) {
    const counts = new Map();
    for (const w of split) {
      if (w.length <= k) continue;
      const key = w.slice(0, k).join(" ").toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const [key, n] of counts) if (n >= 2 && n > list.length / 2) { prefix = key; break; }
  }
  const short = new Map();
  for (const name of list) {
    const w = words(name);
    const k = prefix ? prefix.split(" ").length : 0;
    const cut = prefix && w.length - k >= 2 && w.slice(0, k).join(" ").toLowerCase() === prefix;
    short.set(name, cut ? w.slice(k).join(" ") : name);
  }
  return (name) => short.get(String(name || "").trim()) || String(name || "");
}

// The roles a person holds on one team that are their own (not the club-level
// access of a super admin or club admin), strongest first.
export const ownRoles = (team) => (team?.hats || []).filter((h) => !h.club);

// One person's pills, in reading order: what they are at club level (once),
// then each role of their own with its team, then any team they are shut out
// of. Each is { text, tone } where tone is "club" | "staff" | "family" |
// "plain" | "blocked". `teams` is the club's [{ slug, name }], for naming a
// team the person has no role on; `short` shortens a team name.
export function personPills(person, teams = [], short = (n) => n) {
  const pills = [];
  if (person.superAdmin) pills.push({ text: "Super admin", tone: "club" });
  if (person.clubAdmin) pills.push({ text: "Club admin", tone: "club" });
  for (const team of person.teams || []) {
    for (const hat of ownRoles(team)) {
      pills.push({ text: `${hatLabel(hat)} · ${short(team.teamName)}`, tone: hat.role === "coach" ? "staff" : hat.role === "parent" ? "family" : "plain" });
    }
  }
  for (const [slug, role] of Object.entries(person.overrides || {})) {
    if (role === "blocked") pills.push({ text: `No access · ${short(teams.find((t) => t.slug === slug)?.name || slug)}`, tone: "blocked" });
  }
  return pills;
}

// Everything a search box should match a person by: name, email, what they
// are at club level, and the teams they are on themselves with their roles
// there. A team a super admin or club admin can merely open is left out, so
// searching a team's name finds the people on it, not everyone who runs the
// club. Lower case.
export function personSearchText(person) {
  return [
    person.name, person.email,
    person.superAdmin ? "super admin" : "", person.clubAdmin ? "club admin" : "",
    ...(person.teams || []).filter((t) => t.mine).flatMap((t) => [t.teamName, ...ownRoles(t).map(hatLabel)])
  ].filter(Boolean).join(" ").toLowerCase();
}

// Two letters for the disc: from the name when there is one, else the email.
export function personInitials(person) {
  const w = words(person.name);
  if (w.length) return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
  return String(person.email || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
}

// The people a search leaves: every word typed must appear somewhere.
export function filterPeople(people, query) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return people || [];
  return (people || []).filter((p) => { const hay = personSearchText(p); return terms.every((t) => hay.includes(t)); });
}
