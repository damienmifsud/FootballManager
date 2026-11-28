// A team's competitions beyond its season.
//
// A team plays its season, and often something else alongside it: a winter
// tournament with part of the squad, an invitational league on other days.
// The season's Squadi ids stay where they have always been on the team
// registry entry (team.squadi): one feed, or two labelled feeds for a squad
// that plays as two teams each round (squadiFeeds, below). Every other
// competition is an entry in team.competitions:
//   { id, name, squadi?: { competitionId, divisionId, teamId }, dribl?: { url, team? },
//     majestri?: { url, team?, teamId? }, scores?: true, link?, ground?, format? }
// `scores: true` is the set-up's choice to take the competition's scores from
// its draw, on Squadi, Dribl or Majestri (lib/squadiSync.js applySync);
// without it a competition's scores, like the season's, are entered by hand.
// `id` is permanent and is what a game carries (fixture.comp); `name` is what
// people see and can be changed. Its draw comes from Squadi (three ids) or
// from Dribl (a fixtures request: lib/dribl.js), never both. An entry may have
// a name and no source yet: the draw is often not published when a team is
// set up, so it is kept and simply not synced until one is added.
//
// Any draw, the season's or another competition's, can also carry `link`: the
// address of its page on the web (websiteLink, below).
//
// `ground` is where a competition is played, for a draw that names only the
// field ("Field 1"): its games then say the ground too, so Directions finds it
// (lib/squadiSync.js applySync). `format` is how its games are played when
// that is not the team's own format (sanitizeCompFormat, below): the season
// always plays the team's.
//
// Pure: no store, no Next imports. /api/teams sanitises with these, /api/sync
// and /api/dribl read their sources from them, and the wizard uses the same
// readiness rule.
import { sanitizeDriblSource, driblReady, ONE_SOURCE } from "@/lib/dribl";
import { sanitizeMajestriSource, majestriReady } from "@/lib/majestriDraw";
import { feedProvider } from "@/lib/feedLinks";

export const MAX_COMPETITIONS = 8;
const NAME_MAX = 40;
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/;

// ---- Website links ---------------------------------------------------------
// A draw's page on the web: the FQ or Squadi fixtures page the ids were taken
// from, or a tournament's own site. It is a copy for people, kept beside the
// ids that the sync uses, and nothing is ever fetched from it. It is shown as
// a link, so it is only ever a plain https address.
export const LINK_MAX = 1000;
export const NOT_A_WEBSITE_LINK = "A website link should be a full address starting with https://";
export const LINK_TOO_LONG = `A website link can be at most ${LINK_MAX} characters`;

// What is wrong with a pasted link, as a sentence, or "" when it is empty or fine.
export function websiteLinkProblem(raw) {
  const pasted = typeof raw === "string" ? raw.trim() : "";
  if (!pasted) return "";
  if (pasted.length > LINK_MAX) return LINK_TOO_LONG;
  let u;
  try { u = new URL(pasted); } catch { return NOT_A_WEBSITE_LINK; }
  // A web address has a dot in its host: "https://fixtures" is a slip, not a site.
  return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? "" : NOT_A_WEBSITE_LINK;
}

// The link in its stored form, or "" when there is none or it is not one.
export function websiteLink(raw) {
  const pasted = typeof raw === "string" ? raw.trim() : "";
  return pasted && !websiteLinkProblem(pasted) ? new URL(pasted).href : "";
}

// Why a team's website links cannot be saved as sent, as a sentence for the
// person saving it, or null when they can. /api/teams asks before it
// sanitises: a link that is not one is refused, naming its row, rather than
// quietly dropped. `squadi` and `competitions` are the two lists as posted.
export function websiteLinksError({ squadi, competitions } = {}) {
  for (const feed of Array.isArray(squadi) ? squadi : [squadi]) {
    if (!feed || typeof feed !== "object") continue;
    const problem = websiteLinkProblem(feed.link);
    if (problem) return `${String(feed.label || "").trim() || "Season"}: ${problem}`;
  }
  for (const c of Array.isArray(competitions) ? competitions : []) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const problem = websiteLinkProblem(c.link);
    if (problem) return `${String(c.name ?? "").trim().slice(0, NAME_MAX) || "Competition"}: ${problem}`;
  }
  return null;
}

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
// ---- Where and how a competition is played ---------------------------------
// The ground, as people know it ("Riverside Park"): plain text, kept short.
export const GROUND_MAX = 80;
export const sanitizeGround = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, GROUND_MAX) : "");

// How a competition's games are played, set for it when it is added: players
// a side (3 to 11, with or without a keeper), the periods the game is split
// into (1 to 4: straight through, halves, thirds or quarters) and the whole
// game's length in minutes (10 to 120). Anything else, or any of the three
// missing, is no format: the team's own is used (lib/planner.js baseFormat).
export const PERIOD_NAMES = { 1: "straight through", 2: "halves", 3: "thirds", 4: "quarters" };
export function sanitizeCompFormat(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const whole = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const playersOnField = whole(input.playersOnField, 3, 11);
  const periods = whole(input.periods, 1, 4);
  const gameLength = whole(input.gameLength, 10, 120);
  if (playersOnField == null || periods == null || gameLength == null) return null;
  return { playersOnField, hasGK: input.hasGK === true, periods, gameLength };
}
// A format in words: "7 a side with a keeper, 2 halves of 20 minutes".
export function formatWords(f) {
  if (!f) return "";
  const side = `${f.playersOnField} a side${f.hasGK ? " with a keeper" : ", no keeper"}`;
  const each = f.gameLength / f.periods;
  const mins = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} minutes`;
  const split = f.periods === 1 ? `${mins(f.gameLength)} straight through` : `${f.periods} ${PERIOD_NAMES[f.periods]} of ${mins(each)}`;
  return `${side}, ${split}`;
}

// The formats a team's competitions are played in, for its games:
// { [competitionId]: format }, or null when none has one. /api/data sends it
// with the team's document (withCompetitionFormats) and takes it off again on
// a save (withoutCompetitionFormats): the club's set-up is where it lives.
export function competitionFormats(team) {
  const out = {};
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    const f = c && typeof c.id === "string" ? sanitizeCompFormat(c.format) : null;
    if (f) out[c.id] = f;
  }
  return Object.keys(out).length ? out : null;
}
export function withCompetitionFormats(doc, team) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return doc;
  const { competitionFormats: _old, ...rest } = doc;
  const formats = competitionFormats(team);
  return formats ? { ...rest, competitionFormats: formats } : rest;
}
export function withoutCompetitionFormats(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !("competitionFormats" in doc)) return doc;
  const { competitionFormats: _gone, ...rest } = doc;
  return rest;
}

export function sanitizeCompetitions(input, makeId) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (out.length >= MAX_COMPETITIONS) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = String(raw.name ?? "").trim().slice(0, NAME_MAX);
    const squadi = sanitizeSquadiIds(raw.squadi);
    // One source per competition (competitionsError has already refused a row
    // with both, or with a request that is not a Dribl one): Squadi's ids win
    // here, and a request that is not one is simply not stored.
    const source = squadi ? null : sanitizeDriblSource(raw.dribl);
    const dribl = source && !source.error ? source : null;
    // A draw on Majestri (lib/majestriDraw.js) when neither of the others is given.
    const fromMajestri = squadi || dribl ? null : sanitizeMajestriSource(raw.majestri);
    const majestri = fromMajestri && !fromMajestri.error ? fromMajestri : null;
    const link = websiteLink(raw.link);
    // The set-up's choice to take this competition's scores from its draw,
    // wherever that is (Squadi, Dribl or Majestri).
    const scores = raw.scores === true && !!(squadi || dribl || majestri);
    if (!name && !squadi && !dribl && !majestri && !link) continue;
    const ground = sanitizeGround(raw.ground);
    const format = sanitizeCompFormat(raw.format);
    let id = typeof raw.id === "string" && ID_RE.test(raw.id) && !seen.has(raw.id) ? raw.id : "";
    for (let tries = 0; !id && tries < 20; tries++) {
      const made = String(makeId());
      if (ID_RE.test(made) && !seen.has(made)) id = made;
    }
    if (!id) continue; // no usable id could be made: drop the row rather than store one without
    seen.add(id);
    out.push({ id, name: name || `Competition ${out.length + 1}`, ...(squadi ? { squadi } : {}), ...(dribl ? { dribl } : {}), ...(majestri ? { majestri } : {}), ...(scores ? { scores: true } : {}), ...(link ? { link } : {}), ...(ground ? { ground } : {}), ...(format ? { format } : {}) });
  }
  return out;
}

// Why a list of competitions cannot be saved as sent, as a sentence for the
// person saving it, or null when it can. /api/teams asks before it sanitises:
// a link that is not a Dribl fixtures request, or a row given both sources,
// is refused rather than quietly dropped.
export function competitionsError(input) {
  if (!Array.isArray(input)) return null;
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const dribl = sanitizeDriblSource(raw.dribl);
    const majestri = sanitizeMajestriSource(raw.majestri);
    if (!dribl && !majestri) continue;
    const name = String(raw.name ?? "").trim().slice(0, NAME_MAX);
    const say = (sentence) => (name ? `${name}: ${sentence}` : sentence);
    if (dribl?.error) return say(dribl.error);
    if (majestri?.error) return say(majestri.error);
    if ([sanitizeSquadiIds(raw.squadi), dribl, majestri].filter(Boolean).length > 1) return say(ONE_SOURCE);
  }
  return null;
}

// The competitions whose draw is on Majestri, for the server to read with
// Squadi's (/api/sync): [{ comp: { id, name }, majestri: { url, team?, teamId? }, scores? }].
// A competition as its draw is applied: its id and name, and its ground when
// it has one (applySync puts it with a field the draw names alone).
const compOf = (c) => {
  const ground = sanitizeGround(c.ground);
  return { id: c.id, name: c.name || "Competition", ...(ground ? { ground } : {}) };
};

export function majestriSources(team) {
  const out = [];
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    if (!c || typeof c.id !== "string" || !c.id || squadiReady(c.squadi) || driblReady(c.dribl) || !majestriReady(c.majestri)) continue;
    out.push({ comp: compOf(c), majestri: sanitizeMajestriSource(c.majestri), ...(c.scores === true ? { scores: true } : {}) });
  }
  return out;
}

// The competitions whose draw is on Dribl, for the browser to fetch:
// [{ comp: { id, name }, dribl: { url, team? } }]. Squadi's draws are
// squadiSources below; a competition is in one list or the other.
export function driblSources(team) {
  const out = [];
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    if (!c || typeof c.id !== "string" || !c.id || squadiReady(c.squadi) || !driblReady(c.dribl)) continue;
    out.push({ comp: compOf(c), dribl: { url: c.dribl.url, ...(c.dribl.team ? { team: c.dribl.team } : {}) }, ...(c.scores === true ? { scores: true } : {}) });
  }
  return out;
}

// The season's Squadi feeds: [] (none), one feed, or two labelled feeds.
// team.squadi is one feed (an object) or, for one squad that plays as two
// teams each round, an array of exactly two labelled feeds:
//   [{ label: "Reds", competitionId, divisionId, teamId }, { label: "Blues", ... }]
// A feed counts once any of its three ids is set, or its website link (a
// draw's page is often known before its ids are). Only a pair carries labels:
// the label becomes each of its fixtures' `side`, and a single feed's fixtures
// have none. Every reader of the season's ids goes through here (the sync,
// /api/teams, the wizard); lib/teams.js re-exports it.
export function squadiFeeds(team) {
  const s = team?.squadi;
  const rows = (Array.isArray(s) ? s : [s])
    .filter((f) => f && typeof f === "object" && (f.competitionId || f.divisionId || f.teamId || websiteLink(f.link)))
    .slice(0, 2);
  return rows.map((f) => {
    const link = websiteLink(f.link);
    return {
      ...(rows.length === 2 ? { label: String(f.label || "").trim() } : {}),
      competitionId: String(f.competitionId || "").trim(),
      divisionId: String(f.divisionId || "").trim(),
      teamId: Number(f.teamId) || 0,
      ...(link ? { link } : {})
    };
  });
}

// The season's own name, as the club calls it ("FQ Season"), or "Season" when
// it has none. Kept on the team's entry beside its competitions (seasonName).
export const SEASON_NAME_MAX = 40;
export const sanitizeSeasonName = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, SEASON_NAME_MAX) : "");
export const seasonNameOf = (team) => sanitizeSeasonName(team?.seasonName) || "Season";

// Every draw a team has a website link for, in the order people know them: the
// season (each side of a two-team squad by its label), then each other
// competition by name. [{ name, provider, link, season?, side? }]
// `provider` says where the link leads: "squadi", "dribl" or "majestri" when it
// is a page on one of them (lib/feedLinks.js), "" for any other site. `season` marks the
// season's own draw, the one the league page shows in place when the team has
// no set-up of its own. For the league page, where a family opens a draw;
// nothing here is an id.
export function drawLinks(team) {
  const out = [];
  const season = seasonNameOf(team);
  for (const f of squadiFeeds(team)) {
    if (f.link) out.push({ name: f.label ? `${season} · ${f.label}` : season, provider: feedProvider(f.link), link: f.link, season: true, ...(f.label ? { side: f.label } : {}) });
  }
  for (const c of Array.isArray(team?.competitions) ? team.competitions : []) {
    if (!c || typeof c !== "object") continue;
    const link = websiteLink(c.link);
    if (link) out.push({ name: String(c.name || "").trim() || "Competition", provider: feedProvider(link), link });
  }
  return out;
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
    out.push({ comp: compOf(c), squadi: c.squadi, ...(c.scores === true ? { scores: true } : {}) });
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
