// Hats: the roles one login holds on one team, and the pure helpers the
// picker, the dashboard header and every API route share to reason about
// them. Client-safe (no store, no Next imports) — components import this
// directly; lib/directory.js and lib/viewer.js build on it server-side.
//
// A membership (from lib/directory.js) is one row per (team, role, child).
// A HAT collapses those rows into what a person can act as on a team:
//   { role: "coach",  playerIds: [], playerNames: [], staffRole?, admin? }
//   { role: "parent", playerIds: [...children], playerNames: [...] }
//   { role: "viewer", playerIds: [], playerNames: [], clubAdmin? }
// Strongest first: coach > parent > viewer. A coach who is also a parent on
// the same team therefore has two hats there and can act as either; the
// chosen hat lives in the act_as cookie and is validated server-side so it
// can only ever narrow what the email is entitled to, never widen it.

export const HAT_ORDER = ["coach", "parent", "viewer"];

// Every hat this membership list gives on one team, strongest first.
export function hatsFor(memberships, slug) {
  const mine = (memberships || []).filter((m) => m && m.teamSlug === slug);
  const hats = [];
  const coach = mine.find((m) => m.role === "coach");
  if (coach) {
    hats.push({
      role: "coach", playerIds: [], playerNames: [],
      ...(coach.staffRole ? { staffRole: coach.staffRole } : {}),
      ...(coach.admin ? { admin: true } : {})
    });
  }
  const kids = mine.filter((m) => m.role === "parent" && m.playerId);
  if (kids.length) {
    hats.push({ role: "parent", playerIds: kids.map((k) => k.playerId), playerNames: kids.map((k) => k.playerName || "") });
  }
  const viewer = mine.find((m) => m.role === "viewer");
  if (viewer) {
    hats.push({ role: "viewer", playerIds: [], playerNames: [], ...(viewer.clubAdmin ? { clubAdmin: true } : {}) });
  }
  return hats;
}

// The hat to act as: the wanted one if this email really holds it on this
// team, else the strongest one. Never invents a hat — an unknown or forged
// act_as value just falls back, so the cookie can only narrow.
export function pickHat(memberships, slug, wantedRole) {
  const hats = hatsFor(memberships, slug);
  if (!hats.length) return null;
  return hats.find((h) => h.role === wantedRole) || hats[0];
}

// Distinct teams in a membership list, in membership order, each with the
// hats held there — the shape the picker and the header switcher render.
export function teamsFor(memberships) {
  const out = [];
  for (const m of memberships || []) {
    if (!m || out.some((t) => t.teamSlug === m.teamSlug)) continue;
    out.push({ teamSlug: m.teamSlug, teamName: m.teamName, hats: hatsFor(memberships, m.teamSlug) });
  }
  return out;
}

// "Sam", "Sam & Alex", "Sam, Alex & Leo" — first names only, kids' names.
export function joinNames(names) {
  const list = (names || []).map((n) => String(n || "").trim().split(/\s+/)[0]).filter(Boolean);
  if (list.length <= 1) return list[0] || "";
  return list.slice(0, -1).join(", ") + " & " + list[list.length - 1];
}

// What the chip / picker row says for a hat.
export function hatLabel(hat) {
  if (!hat) return "";
  if (hat.role === "coach") return hat.admin ? "Super admin" : (hat.staffRole || "Coach");
  if (hat.role === "parent") {
    const names = joinNames(hat.playerNames);
    return names ? "Parent of " + names : "Parent";
  }
  return hat.clubAdmin ? "Club admin (view only)" : "View only";
}

// True when this person has any real choice to make: more than one team, or
// more than one hat on any team.
export function hasChoice(memberships) {
  const teams = teamsFor(memberships);
  return teams.length > 1 || teams.some((t) => t.hats.length > 1);
}
