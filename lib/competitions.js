// A team's competitions beyond its season.
//
// A team plays its season, and often something else alongside it: a winter
// tournament with part of the squad, an invitational league on other days.
// The season's Squadi ids stay where they have always been on the team
// registry entry (team.squadi): one feed, or two labelled feeds for a squad
// that plays as two teams each round (squadiFeeds, below). Every other
// competition is an entry in team.competitions:
//   { id, name, squadi?: { competitionId, divisionId, teamId } }
// `id` is permanent and is what a game carries (fixture.comp); `name` is what
// people see and can be changed. An entry may have a name and no ids yet: the
// draw is often not published when a team is set up, so it is kept and simply
// not synced until the ids are added.
//
// Pure: no store, no Next imports. /api/teams sanitises with these, /api/sync
// reads its sources from them, and the wizard uses the same readiness rule.

export const MAX_COMPETITIONS = 8;
const NAME_MAX = 40;
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;

// Squadi's three ids for one competition, as the registry keeps them: two
// strings and a number. Null when nothing was entered at all.
export function sanitizeSquadiIds(input) {
  const s = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const competitionId = String(s.competitionId ?? "").trim();
  const divisionId = String(s.divisionId ?? "").trim();
  const teamId = Number(s.teamId) || 0;
  return competitionId || divisionId || teamId ? { competitionId, divisionId, teamId } : null;
}

// All three ids are there, so the draw can be fetched.
export const squadiReady = (ids) => !!(ids && ids.competitionId && ids.divisionId && ids.teamId);

// Server-side guard for team.competitions. Keeps order, caps the list and the
// names, drops rows nobody filled in, and makes sure every entry has an id of
// its own: one sent with the row is kept (so a rename or new ids never orphan
// the games already tagged with it), a missing, malformed or repeated one is
// replaced using makeId().
export function sanitizeCompetitions(input, makeId) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (out.length >= MAX_COMPETITIONS) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = String(raw.name ?? "").trim().slice(0, NAME_MAX);
    const squadi = sanitizeSquadiIds(raw.squadi);
    if (!name && !squadi) continue;
    let id = typeof raw.id === "string" && ID_RE.test(raw.id) && !seen.has(raw.id) ? raw.id : "";
    for (let tries = 0; !id && tries < 20; tries++) {
      const made = String(makeId());
      if (ID_RE.test(made) && !seen.has(made)) id = made;
    }
    if (!id) continue; // no usable id could be made: drop the row rather than store one without
    seen.add(id);
    out.push({ id, name: name || `Competition ${out.length + 1}`, ...(squadi ? { squadi } : {}) });
  }
  return out;
}

// The season's Squadi feeds: [] (none), one feed, or two labelled feeds.
// team.squadi is one feed (an object) or, for one squad that plays as two
// teams each round, an array of exactly two labelled feeds:
//   [{ label: "Reds", competitionId, divisionId, teamId }, { label: "Blues", ... }]
// A feed counts once any of its three ids is set. Only a pair carries labels:
// the label becomes each of its fixtures' `side`, and a single feed's fixtures
// have none. Every reader of the season's ids goes through here (the sync,
// /api/teams, the wizard); lib/teams.js re-exports it.
export function squadiFeeds(team) {
  const s = team?.squadi;
  const rows = (Array.isArray(s) ? s : [s])
    .filter((f) => f && typeof f === "object" && (f.competitionId || f.divisionId || f.teamId))
    .slice(0, 2);
  return rows.map((f) => ({
    ...(rows.length === 2 ? { label: String(f.label || "").trim() } : {}),
    competitionId: String(f.competitionId || "").trim(),
    divisionId: String(f.divisionId || "").trim(),
    teamId: Number(f.teamId) || 0
  }));
}

// What /api/sync pulls for a team, season first. Each source is
// { comp, side?, squadi }: comp is null for the season and { id, name } for
// anything else; side is the feed's label when the season is two feeds. The
// season is attempted as soon as it has a competition id, as it always was (a
// half-filled season is reported, not skipped); another competition is only a
// source once all three of its ids are in.
//
// One draw is one source. The same three ids entered twice (the season's
// copied into a competition row, say) would have two sources claiming the
// same games and retagging them on every run, so the first to list a draw
// keeps it and a repeat is not a source.
const drawKey = (ids) => `${String(ids.competitionId).trim()}|${String(ids.divisionId).trim()}|${Number(ids.teamId) || 0}`;
export function squadiSources(team) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(team?.squadi)) {
    // A two-team squad: each labelled feed is a season draw of its own.
    for (const feed of squadiFeeds(team)) {
      if (!feed.competitionId) continue;
      const key = drawKey(feed);
      if (seen.has(key)) continue; // the same draw entered for both sides
      seen.add(key);
      out.push({ comp: null, ...(feed.label ? { side: feed.label } : {}), squadi: feed });
    }
  } else if (team?.squadi?.competitionId) {
    out.push({ comp: null, squadi: team.squadi });
    seen.add(drawKey(team.squadi));
  }
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    if (!c || typeof c.id !== "string" || !c.id || !squadiReady(c.squadi)) continue;
    const key = drawKey(c.squadi);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ comp: { id: c.id, name: c.name || "Competition" }, squadi: c.squadi });
  }
  return out;
}

// ---- Squads ----------------------------------------------------------------
// A competition's squad is the coach's pick of who is going to it, kept on the
// team document as data.competitionSquads[competitionId] = [playerId, …] (the
// display side is in lib/dashboardData.js: competitionSquad, squadOf,
// playersFor). No entry means everyone, and so does a squad with none of the
// team's players in it.

// Every competition a team's document or registry entry knows about, for the
// squad picker: the registry's list first, then any that only survive on the
// team's games (one removed in the wizard still has its games, and its squad).
export function knownCompetitions(team, data) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    if (!c || typeof c.id !== "string" || !c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: c.name || "Competition" });
  }
  for (const f of Array.isArray(data?.fixtures) ? data.fixtures : []) {
    if (!f || typeof f.comp !== "string" || !f.comp || seen.has(f.comp)) continue;
    seen.add(f.comp);
    out.push({ id: f.comp, name: String(f.compName || "").trim() || "Competition" });
  }
  return out;
}

// Server-side guard for one squad. null (or undefined) means everyone, and is
// returned as null. A list is cut down to the ids of players actually on the
// team, each once, in the team's own order. A list that leaves nobody is
// everyone too (null): a competition is never for no one. Anything else is
// not a squad: undefined.
export function sanitizeSquad(input, players) {
  if (input == null) return null;
  if (!Array.isArray(input)) return undefined;
  const wanted = new Set(input.filter((id) => typeof id === "string"));
  const ids = (Array.isArray(players) ? players : []).filter((p) => p && typeof p.id === "string" && wanted.has(p.id)).map((p) => p.id);
  return ids.length ? ids : null;
}
