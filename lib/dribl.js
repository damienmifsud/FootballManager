// Dribl as the source of a competition's draw.
//
// Some competitions publish their draw on Dribl's match centre (a page such as
// <name>.dribl.com/fixtures) rather than on Squadi. Dribl's fixtures API is
// public and answers any browser (Access-Control-Allow-Origin: *), but it sits
// behind a security service that turns servers away. So the draw is fetched in
// a coach's browser, never on ours: the browser pulls it, turns it into the
// same plain records the Squadi sync works from, and posts them to /api/dribl,
// which applies them to the competition's games (lib/squadiSync applySync).
//
// A competition's Dribl source lives on its registry entry beside its name
// (lib/competitions.js):
//   dribl: { url, team? }
//   url   the fixtures request on mc-api.dribl.com, as the browser's Network
//         tab shows it for the competition's fixtures page
//   team  our team's name as Dribl shows it. Left empty, it is worked out
//         from the draw where the draw allows (see ourName below).
//
// Pure: no store, no Next imports, and nothing but `fetch` for the network, so
// the wizard, the browser sync and the routes all use the same rules.

export const DRIBL_API_HOST = "mc-api.dribl.com";
const FIXTURES_PATH = "/api/fixtures";
export const NOT_A_DRIBL_REQUEST = `That is not a Dribl fixtures request. It should start with https://${DRIBL_API_HOST}${FIXTURES_PATH}?`;
export const ONE_SOURCE = "A competition gets its draw from Squadi or from Dribl, not both.";

const URL_MAX = 600;
const TEAM_MAX = 80;
// What a fixtures request is asked with. Anything else on a pasted URL (a page
// cursor, say) is dropped, so a stored request always asks for the whole draw.
const PARAMS = ["date_range", "season", "competition", "league", "club", "tenant", "timezone"];
const VALUE_RE = /^[A-Za-z0-9_.\-/ ]{1,64}$/;
const DEFAULT_TIMEZONE = "Australia/Brisbane";

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// The fixtures request in its stored form, or "" when the text is not one. A
// stored request is plain https on Dribl's API host (no credentials, no port),
// carries only the known filters, always asks for every date, and always names
// its tenant: the match centre it belongs to, without which Dribl has nothing
// to answer with.
export function driblFixturesUrl(raw) {
  const pasted = typeof raw === "string" ? raw.trim() : "";
  if (!pasted || pasted.length > URL_MAX) return "";
  let u;
  try { u = new URL(pasted); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
  if (u.hostname !== DRIBL_API_HOST || u.pathname !== FIXTURES_PATH) return "";
  const out = new URLSearchParams();
  for (const key of PARAMS) {
    const value = u.searchParams.get(key);
    if (value == null || value === "") continue;
    if (!VALUE_RE.test(value)) return "";
    out.set(key, value);
  }
  if (!out.get("tenant")) return "";
  out.set("date_range", "all");
  if (!out.get("timezone")) out.set("timezone", DEFAULT_TIMEZONE);
  // One order whatever order they were pasted in, so the same request is stored the same way.
  const ordered = new URLSearchParams();
  for (const key of PARAMS) if (out.has(key)) ordered.set(key, out.get(key));
  return `https://${DRIBL_API_HOST}${FIXTURES_PATH}?${ordered.toString()}`;
}

// Server-side guard for one competition's Dribl source. Returns null when
// nothing was entered, { error } when a link was entered that is not a Dribl
// fixtures request, and otherwise { url, team? } ready to store.
export function sanitizeDriblSource(input) {
  const src = isPlainObject(input) ? input : {};
  const pasted = typeof src.url === "string" ? src.url.trim() : "";
  if (!pasted) return null;
  const url = driblFixturesUrl(pasted);
  if (!url) return { error: NOT_A_DRIBL_REQUEST };
  const team = text(src.team, TEAM_MAX);
  return { url, ...(team ? { team } : {}) };
}

// A stored source the browser can fetch.
export const driblReady = (src) => !!(isPlainObject(src) && driblFixturesUrl(src.url));

// ---- Records ---------------------------------------------------------------
// One game of a draw, in the shape applySync works from (the Squadi sync's
// normalize() makes the same):
//   { squadiId, round, dateISO, time, opponent, opponentLogo, ourLogo, homeAway, venue }
// or { squadiId, round, bye: true } for a bye. `squadiId` is the draw's own id
// for the game, whichever service it came from; a Dribl game's starts "dribl:"
// so it can never be mistaken for a Squadi one.

export const MAX_RECORDS = 300;
const RECORD_ID_RE = /^dribl:[A-Za-z0-9_-]{1,48}$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPPONENT_MAX = 80;
const VENUE_MAX = 120;
const LOGO_MAX = 400;

const realDate = (iso) => {
  const m = ISO_DATE_RE.exec(typeof iso === "string" ? iso : "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
// A round is a small whole number, or nothing (finals and pool games often have none).
const roundNumber = (v) => (Number.isInteger(v) && v > 0 && v < 100 ? v : null);
// A crest is shown as an image: only a plain https address is kept.
function logoUrl(v) {
  if (typeof v !== "string" || !v || v.length > LOGO_MAX) return "";
  let u;
  try { u = new URL(v); } catch { return ""; }
  return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
}

// Server-side guard for the records a browser posts. They come from a coach's
// browser, not from Dribl direct, so nothing is taken on trust: every field is
// checked and cut to size, a record that is not a game is dropped, an id is
// kept once, and the list is capped. Returns null when what was sent is not a
// list at all.
export function sanitizeDrawRecords(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (out.length >= MAX_RECORDS) break;
    if (!isPlainObject(raw)) continue;
    const squadiId = typeof raw.squadiId === "string" && RECORD_ID_RE.test(raw.squadiId) ? raw.squadiId : "";
    if (!squadiId || seen.has(squadiId)) continue;
    const round = roundNumber(raw.round);
    if (raw.bye === true) { seen.add(squadiId); out.push({ squadiId, round, bye: true }); continue; }
    const opponent = text(raw.opponent, OPPONENT_MAX);
    if (!realDate(raw.dateISO) || !opponent) continue;
    seen.add(squadiId);
    out.push({
      squadiId, round,
      dateISO: raw.dateISO,
      time: typeof raw.time === "string" && TIME_RE.test(raw.time) ? raw.time : "",
      opponent,
      opponentLogo: logoUrl(raw.opponentLogo),
      ourLogo: logoUrl(raw.ourLogo),
      homeAway: raw.homeAway === "A" ? "A" : "H",
      venue: text(raw.venue, VENUE_MAX)
    });
  }
  return out;
}

// ---- Reading Dribl's answer -------------------------------------------------
// A fixtures answer is { data: [item, …], links, meta }: one item per game
// ({ hash_id, attributes: { date, round, full_round, home_team_name,
// away_team_name, home_logo, away_logo, ground_name, field_name, bye_flag } }),
// and a cursor to the next page when the draw is longer than one.
//
// Dribl publishes no description of this, so the reader is strict about what
// it does not recognise: an answer with games in it, none of which it can
// read, is an error that names the fields it found. It is never read as "no
// games", which would look like a draw that is simply up to date.

const MAX_PAGES = 20;
const pad2 = (n) => String(n).padStart(2, "0");
const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
// A team's name as one line of text, however Dribl spaced it.
const teamName = (v) => str(v).replace(/\s+/g, " ");
const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

// A game's kick-off in the draw's own timezone: { dateISO, time }, or null
// when Dribl gave nothing usable. Dribl sends an instant ("…T04:00:00.000000Z"),
// which is turned into the draw's local date and time. A time with no zone on
// it is taken as it stands: it is already the draw's own clock, and reading it
// as an instant would shift it by wherever the coach's phone happens to be.
function kickOff(value, timeZone) {
  const raw = str(value);
  const wall = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(raw);
  if (wall) {
    if (!realDate(wall[1]) || (wall[2] && !TIME_RE.test(wall[2]))) return null;
    return { dateISO: wall[1], time: wall[2] || "" };
  }
  // Microseconds are trimmed to what every browser parses.
  const instant = new Date(raw.replace(/(\.\d{3})\d+/, "$1"));
  if (!raw || Number.isNaN(instant.getTime())) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  } catch { return null; }
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { dateISO: `${get("year")}-${get("month")}-${get("day")}`, time: `${pad2(Number(get("hour")) % 24)}:${get("minute")}` };
}

// "Round 3", "R3" or 3 is round 3; a final or a pool game has no number.
function roundOf(a) {
  const m = /\d{1,2}/.exec(str(a.full_round) || str(a.round));
  const n = m ? Number(m[0]) : 0;
  return n > 0 && n < 100 ? n : null;
}

// Which of the names in the draw is us. The team's name as given in the
// set-up decides when there is one: the whole name, or part of it when that
// part can only mean one team. Otherwise it is the one name that is in every
// game: a draw asked for by club lists only that club's games, so with one
// team in it that name is ours. A draw does not say when no name is in every
// game (two of the club's teams share it), or when two are (a draw of a
// single game, or of the same two teams each time). Then the set-up has to.
export const WHICH_TEAM = "This Dribl draw does not show which team is yours. Add your team's name as Dribl shows it to the competition's set-up.";
function ourName(games, team) {
  const names = [...new Set(games.flatMap((g) => [g.home, g.away]))];
  const wanted = teamName(team);
  if (wanted) {
    const exact = names.find((n) => sameName(n, wanted));
    if (exact) return exact;
    const partial = names.filter((n) => n.toLowerCase().includes(wanted.toLowerCase()));
    if (partial.length === 1) return partial[0];
    throw new Error(partial.length
      ? `More than one team in this Dribl draw has "${wanted}" in its name. Use the whole name as Dribl shows it.`
      : `No team called "${wanted}" is in this Dribl draw.`);
  }
  const everywhere = names.filter((n) => games.every((g) => g.home === n || g.away === n));
  if (everywhere.length === 1) return everywhere[0];
  throw new Error(WHICH_TEAM);
}

// What an item Dribl sent is made of, for the error that says it could not be
// read: its own field names, and those under `attributes`.
function fieldsOf(item) {
  if (!isPlainObject(item)) return typeof item;
  const own = Object.keys(item).slice(0, 12).join(", ");
  const inner = isPlainObject(item.attributes) ? Object.keys(item.attributes).slice(0, 30).join(", ") : "";
  return (inner ? `${own}; attributes: ${inner}` : own).slice(0, 500);
}
export const NOT_READABLE = "Dribl's answer was not in the form this app reads.";

// The games among the items Dribl sent, each with its id, its two team names
// and whether it is a bye. An item this reader cannot make a game of is left
// out; normalizeDribl says so when that is all of them.
function gamesIn(items) {
  const games = [];
  for (const item of items) {
    if (!isPlainObject(item)) continue;
    const a = isPlainObject(item.attributes) ? item.attributes : item;
    const id = str(item.hash_id) || str(a.hash_id) || str(a.match_hash_id);
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) continue;
    const home = teamName(a.home_team_name), away = teamName(a.away_team_name);
    if (!home && !away) continue; // not a game this reader knows how to read
    games.push({ id, a, home, away, bye: a.bye_flag === true });
  }
  return games;
}

// Dribl's items → the records applySync works from. `team` is our team's name
// from the set-up (may be empty); `timeZone` is the draw's.
export function normalizeDribl(items, { team = "", timeZone = DEFAULT_TIMEZONE } = {}) {
  if (!Array.isArray(items)) throw new Error("Unexpected Dribl response shape");
  const games = gamesIn(items);
  // Games were sent and not one could be read: Dribl's format is not the one
  // this was written for. Say so, with what a game there is made of.
  if (items.length && !games.length) throw new Error(`${NOT_READABLE} A game there has: ${fieldsOf(items[0])}.`);
  const played = games.filter((g) => g.home && g.away && !g.bye);
  if (!played.length) return games.filter((g) => g.bye).map((g) => ({ squadiId: `dribl:${g.id}`, round: roundOf(g.a), bye: true }));
  const us = ourName(played, team);
  const out = [];
  for (const g of games) {
    const round = roundOf(g.a);
    if (g.bye || !g.home || !g.away) {
      // A bye is ours only if we are the side named in it.
      if (g.home === us || g.away === us) out.push({ squadiId: `dribl:${g.id}`, round, bye: true });
      continue;
    }
    if (g.home !== us && g.away !== us) continue; // another of the club's teams
    const home = g.home === us;
    const when = kickOff(g.a.date, timeZone);
    // One of our games with no kick-off this reader can make sense of: the
    // same kind of mismatch, and better said than left out of the draw.
    if (!when) throw new Error(`${NOT_READABLE} A game's date reads: ${JSON.stringify(g.a.date ?? null).slice(0, 80)}.`);
    const ground = str(g.a.ground_name), field = str(g.a.field_name);
    out.push({
      squadiId: `dribl:${g.id}`, round,
      dateISO: when.dateISO, time: when.time,
      opponent: home ? g.away : g.home,
      opponentLogo: str(home ? g.a.away_logo : g.a.home_logo),
      ourLogo: str(home ? g.a.home_logo : g.a.away_logo),
      homeAway: home ? "H" : "A",
      venue: field && ground ? `${ground} – ${field}` : ground || field
    });
  }
  return out;
}

// What a draw's games say about themselves, for the set-up to read back
// before anything is saved:
//   { games, ourGames, teams, ours, problem, competition, league }
// `games` counts the games two teams play (byes aside). `teams` is every team
// named in them, the one in the most games first, which puts the club the draw
// was asked for at the top. `ours` is our team's name when the draw, or the
// name given, settles it (ourName, above), and `ourGames` how many of the
// games are that team's. When the name given is not in the draw, `problem` is
// the sentence that says so; with neither, the set-up has to say which team is
// ours. `competition` and `league` are the draw's own names for itself, when
// its games carry them.
const DRAW_NAME_MAX = 60;
export function driblDrawNames(items, team = "") {
  if (!Array.isArray(items)) throw new Error("Unexpected Dribl response shape");
  const played = gamesIn(items).filter((g) => g.home && g.away && !g.bye);
  const count = new Map();
  for (const g of played) for (const n of [g.home, g.away]) count.set(n, (count.get(n) || 0) + 1);
  const teams = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || a.localeCompare(b));
  let ours = "", problem = "";
  if (played.length) {
    try { ours = ourName(played, team); }
    catch (e) { if (e.message !== WHICH_TEAM) problem = e.message; }
  }
  const first = played[0]?.a || {};
  return {
    games: played.length, ourGames: ours ? count.get(ours) || 0 : 0, teams, ours, problem,
    competition: text(first.competition_name, DRAW_NAME_MAX), league: text(first.league_name, DRAW_NAME_MAX)
  };
}

// The request for the page after this one, or "" on the last page. A cursor is
// only ever added to the stored request: a link that points anywhere else is
// not followed.
export function nextDriblPage(json, request) {
  const cursor = str(json?.meta?.next_cursor) || (() => {
    try { return new URL(str(json?.links?.next)).searchParams.get("cursor") || ""; } catch { return ""; }
  })();
  if (!cursor || !/^[A-Za-z0-9_\-=+/%.]{1,400}$/.test(cursor)) return "";
  const u = new URL(request);
  u.searchParams.set("cursor", cursor);
  return u.toString();
}

// Fetch a competition's whole draw from Dribl: every game it lists, as Dribl
// sent them, page after page. Meant for a browser: a plain GET with no cookies
// and nothing but an Accept header, which Dribl answers for any site. Throws
// with a sentence when Dribl does not answer, or answers with something that
// is not a draw.
export const UNREACHABLE = "Dribl could not be reached from this browser.";
export async function fetchDriblItems(source, fetchImpl = globalThis.fetch) {
  const request = driblFixturesUrl(source?.url);
  if (!request) throw new Error("Not a Dribl fixtures request");
  const items = [];
  let url = request;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let res;
    // A request the browser could not make at all (offline, or blocked on the
    // way) rejects with the browser's own words, "Failed to fetch" and the like.
    try { res = await fetchImpl(url, { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" }); }
    catch { throw new Error(UNREACHABLE); }
    if (!res.ok) throw new Error(`Dribl responded ${res.status}`);
    let json = null;
    try { json = await res.json(); } catch {} // a page rather than data: not a draw
    if (!isPlainObject(json) || !Array.isArray(json.data)) throw new Error("Unexpected Dribl response shape");
    items.push(...json.data);
    url = nextDriblPage(json, request);
  }
  return items;
}

// The timezone a stored request asks in, which is the draw's own.
export const driblTimeZone = (url) => {
  const request = driblFixturesUrl(url);
  return (request && new URL(request).searchParams.get("timezone")) || DEFAULT_TIMEZONE;
};

// The same draw as the records the sync applies (normalizeDribl).
export async function fetchDribl(source, fetchImpl = globalThis.fetch) {
  const items = await fetchDriblItems(source, fetchImpl);
  return normalizeDribl(items, { team: source?.team, timeZone: driblTimeZone(source?.url) });
}
