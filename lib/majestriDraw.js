// A competition whose draw is on Majestri.
//
// Some competitions are run on a club's own Majestri site. A competition's
// page there,
//   https://<club>.majestri.com.au/comp-summary?compID=1234
// carries its ladder and every round's games: the date, the time, the field,
// both teams and, once played, the score. A team's own page,
//   https://<club>.majestri.com.au/team-summary?teamID=5678&compID=1234
// names one team in the same competition. Majestri answers servers, so the site
// reads the competition's page itself, the way it reads Squadi (/api/sync).
//
// A competition's Majestri source lives on its registry entry beside its name:
//   majestri: { url, team, teamId? }
//   url     the competition's page, in its stored form (majestriCompUrl)
//   team    our team's name as Majestri shows it
//   teamId  Majestri's number for our team, when it is known (a team's own
//           page was pasted). It decides over the name, which a rename changes.
//
// Majestri publishes no description of its pages. The page is read strictly:
// one this reader does not recognise is an error, never "no games", which
// would look like a draw that is simply up to date.
//
// Pure: no store, no Next imports, and nothing but `fetch` for the network.

const URL_MAX = 1000;
const PAGE_MAX = 3_000_000;
const TEAM_MAX = 80;
const ID_RE = /^\d{1,9}$/;
export const MAJESTRI_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.majestri\.com\.au$/;

export const NOT_A_MAJESTRI_LINK = "That is not a Majestri link. Open the competition on Majestri, copy the page's address and paste it here.";
export const MAJESTRI_NEEDS_COMPETITION = "That Majestri link does not name a competition. Open the competition's page (its address has compID in it) and copy the address again.";
export const MAJESTRI_WHICH_TEAM = "Choose your team from the names on the Majestri page.";
export const MAJESTRI_NOT_READABLE = "Majestri's page was not in the form this app reads.";
export const MAJESTRI_UNREACHABLE = "Majestri could not be reached.";

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// ---- Links -------------------------------------------------------------------

function httpsUrl(raw) {
  const pasted = typeof raw === "string" ? raw.trim() : "";
  if (!pasted || pasted.length > URL_MAX) return null;
  let u;
  try { u = new URL(pasted); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return u;
}
// A query value by name, whatever its case (Majestri writes compID and teamID).
const query = (u, name) => {
  for (const [k, v] of u.searchParams) if (k.toLowerCase() === name) return v.trim();
  return "";
};

// Is this a page on a Majestri site?
export const isMajestriLink = (raw) => { const u = httpsUrl(raw); return !!u && MAJESTRI_HOST.test(u.hostname); };

// Read a pasted link: { provider: "majestri", link, host, compId, teamId } or
// { error }. `teamId` is "" unless the link is a team's own page. Makes no request.
export function parseMajestriLink(raw) {
  const u = httpsUrl(raw);
  if (!u || !MAJESTRI_HOST.test(u.hostname)) return { error: NOT_A_MAJESTRI_LINK };
  const compId = query(u, "compid");
  if (!ID_RE.test(compId)) return { error: MAJESTRI_NEEDS_COMPETITION };
  const teamId = query(u, "teamid");
  return { provider: "majestri", link: u.href, host: u.hostname, compId, teamId: ID_RE.test(teamId) ? teamId : "" };
}

// The competition's page in its one stored form.
export const majestriCompUrl = (host, compId) => `https://${host}/comp-summary?compID=${compId}`;

// Server-side guard for one competition's Majestri source. Null when nothing
// was entered, { error } when what was entered is not a Majestri competition
// link or names no team, otherwise { url, team?, teamId? } ready to store.
export function sanitizeMajestriSource(input) {
  const src = isPlainObject(input) ? input : {};
  const pasted = typeof src.url === "string" ? src.url.trim() : "";
  if (!pasted) return null;
  const parsed = parseMajestriLink(pasted);
  if (parsed.error) return { error: parsed.error };
  const team = text(src.team, TEAM_MAX);
  const given = String(src.teamId ?? "").trim();
  const teamId = ID_RE.test(given) ? given : parsed.teamId;
  if (!team && !teamId) return { error: MAJESTRI_WHICH_TEAM };
  return { url: majestriCompUrl(parsed.host, parsed.compId), ...(team ? { team } : {}), ...(teamId ? { teamId } : {}) };
}

// A stored source the server can read.
export const majestriReady = (src) => {
  const s = sanitizeMajestriSource(src);
  return !!s && !s.error;
};

// ---- Reading a competition's page ----------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, "0");

function decode(s) {
  return String(s)
    .replace(/&#(\d{1,7});/g, (m, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => (parseInt(n, 16) < 0x110000 ? String.fromCodePoint(parseInt(n, 16)) : m))
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
// The text of a piece of markup: tags out, entities read, spaces tidied.
const plain = (s) => decode(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// "Thursday, 15 Oct 2026" -> "2026-10-15", or "".
export function majestriDate(raw) {
  const m = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(plain(raw));
  if (!m) return "";
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  const day = Number(m[1]), year = Number(m[3]);
  if (!month) return "";
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? `${year}-${pad2(month)}-${pad2(day)}` : "";
}

// "4:30 pm" -> "16:30", "16:30" stays; anything else is "".
export function majestriTime(raw) {
  const t = plain(raw).toLowerCase().replace(/\./g, "");
  let m = /^(\d{1,2}):(\d{2})\s*([ap])m$/.exec(t);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 1 || h > 12 || min > 59) return "";
    return `${pad2((h % 12) + (m[3] === "p" ? 12 : 0))}:${pad2(min)}`;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad2(Number(m[1]))}:${m[2]}` : "";
}

// "Round 3" is 3; a semi final or a final has no number.
const roundNumber = (name) => { const m = /\bround\s+(\d{1,2})\b/i.exec(name); const n = m ? Number(m[1]) : 0; return n > 0 && n < 100 ? n : null; };
const score = (raw) => { const t = plain(raw); return /^\d{1,3}$/.test(t) ? Number(t) : null; };
const TBA = /^(tba|tbc|tbd)$/i;

function side(body, which) {
  const m = new RegExp(`<span class="team ${which}\\b[^"]*">\\s*<span class="name">([^<]*)(?:<span class="score">([^<]*)</span>)?\\s*</span>`).exec(body);
  return m ? { name: plain(m[1]), score: m[2] === undefined ? null : score(m[2]) } : null;
}

// A competition's page as plain data:
//   { competition, division, season, teams: [{ id, name }], games: [game] }
// where a game is { roundId, roundName, round, dateISO, time, title, home, away,
// homeScore, awayScore, field, tba }. Throws, saying what the page was made
// of, when it is not a competition's page.
export function readMajestriPage(html) {
  const page = typeof html === "string" ? html : "";
  if (!page || page.length > PAGE_MAX) throw new Error(MAJESTRI_NOT_READABLE);
  const body = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");

  const crumbs = /<div id="breadcrumbs">([\s\S]*?)<\/div>/.exec(body);
  const crumbNames = crumbs ? [...crumbs[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => plain(m[1])).filter(Boolean) : [];
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(body);
  const season = h1 ? plain((/<span class="byLine">([\s\S]*?)<\/span>/.exec(h1[1]) || [])[1]) : "";
  const division = h1 ? plain(h1[1].replace(/<span class="byLine">[\s\S]*?<\/span>/, "")) : "";

  const teams = [];
  for (const m of body.matchAll(/<a\b[^>]*href="team-summary\?teamID=(\d{1,9})&amp;compID=\d{1,9}"[^>]*>([\s\S]*?)<\/a>/g)) {
    const name = plain(m[2]);
    if (name && !teams.some((t) => t.id === m[1])) teams.push({ id: m[1], name });
  }

  const games = [];
  let roundId = "", roundName = "", dateISO = "", rounds = 0;
  const TOKEN = /<h2\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/h2>|<h3\b[^>]*>([\s\S]*?)<\/h3>|<li\b([^>]*\bdata-field="[^"]*"[^>]*)>([\s\S]*?)<\/li>/g;
  for (const m of body.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      roundId = /^[A-Za-z0-9_-]{1,40}$/.test(m[1]) ? m[1] : `r${rounds}`;
      roundName = plain(m[2]);
      dateISO = "";
      rounds++;
    } else if (m[3] !== undefined) {
      dateISO = majestriDate(m[3]);
    } else {
      const home = side(m[5], "home"), away = side(m[5], "away");
      if (!home || !away) continue;
      const tba = /\bclass="[^"]*\btba\b/.test(m[4]) || TBA.test(home.name) || TBA.test(away.name);
      games.push({
        roundId, roundName, round: roundNumber(roundName), dateISO,
        time: majestriTime((/<span class="time">([^<]*)<\/span>/.exec(m[5]) || [])[1]),
        title: plain((/<span class="title"[^>]*>([^<]*)<\/span>/.exec(m[5]) || [])[1]),
        home: home.name, away: away.name, homeScore: home.score, awayScore: away.score,
        field: plain((/<span class="locn">([^<]*)<\/span>/.exec(m[5]) || [])[1]),
        tba
      });
    }
  }
  // Rounds, games and a ladder are what a competition's page is made of. With
  // none of them it is some other page (a sign-in page, an error page).
  if (!rounds && !games.length && !teams.length) throw new Error(`${MAJESTRI_NOT_READABLE} It has no rounds, games or ladder.`);
  return { competition: crumbNames.at(-1) || "", division, season, teams, games };
}

// ---- Our games ---------------------------------------------------------------

const same = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

// Which team is ours: Majestri's number for it when that is on the page, else
// its name, whole or a part that fits one team only.
export function ourMajestriTeam(page, { team = "", teamId = "" } = {}) {
  if (teamId) {
    const t = page.teams.find((x) => x.id === String(teamId));
    if (t) return t.name;
  }
  const wanted = text(team, TEAM_MAX);
  if (!wanted) throw new Error(teamId ? "Your team is no longer in this Majestri competition. Choose it again from the names on the page." : MAJESTRI_WHICH_TEAM);
  const names = [...new Set([...page.teams.map((t) => t.name), ...page.games.filter((g) => !g.tba).flatMap((g) => [g.home, g.away])])];
  const exact = names.find((n) => same(n, wanted));
  if (exact) return exact;
  const partial = names.filter((n) => n.toLowerCase().includes(wanted.toLowerCase()));
  if (partial.length === 1) return partial[0];
  throw new Error(partial.length
    ? `More than one team in this Majestri competition has "${wanted}" in its name. Use the whole name as Majestri shows it.`
    : `No team called "${wanted}" is in this Majestri competition.`);
}

// Our games as the records the sync applies (lib/squadiSync.js applySync):
//   { squadiId, round, dateISO, time, opponent, opponentLogo, ourLogo, homeAway, venue }
//   or { squadiId, round, bye: true }
// A game's id is the competition, the round and which of our games in that
// round it is, so a game moved to another time or field, or given its
// opponent late, is the same game. Games whose teams are not known yet are
// left out until they are.
export function majestriRecords(page, { team = "", teamId = "", compId = "" } = {}) {
  const us = ourMajestriTeam(page, { team, teamId });
  const seen = new Map();
  const out = [];
  for (const g of page.games) {
    if (g.tba) continue;
    const home = same(g.home, us), away = same(g.away, us);
    if (!home && !away) continue;
    const n = seen.get(g.roundId) || 0;
    seen.set(g.roundId, n + 1);
    const squadiId = `majestri:${compId}:${g.roundId}:${n}`;
    const opponent = home ? g.away : g.home;
    if (/^bye$/i.test(opponent)) { out.push({ squadiId, round: g.round, bye: true }); continue; }
    if (!g.dateISO) throw new Error(`${MAJESTRI_NOT_READABLE} A game's date could not be read.`);
    out.push({ squadiId, round: g.round, dateISO: g.dateISO, time: g.time, opponent, opponentLogo: "", ourLogo: "", homeAway: home ? "H" : "A", venue: g.field });
  }
  return out;
}

// ---- Fetching ------------------------------------------------------------------

// A competition's page, fetched and read. For the server: a plain GET of the
// stored address, built from checked pieces, never the pasted text, with no
// redirect followed (a competition's page answers where it is).
export async function fetchMajestriPage(url, fetchImpl = globalThis.fetch) {
  const parsed = parseMajestriLink(url);
  if (parsed.error) throw new Error(parsed.error);
  let res;
  try { res = await fetchImpl(majestriCompUrl(parsed.host, parsed.compId), { headers: { Accept: "text/html" }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error(MAJESTRI_UNREACHABLE); }
  if (res.status !== 200) throw new Error(`Majestri responded ${res.status}`);
  return readMajestriPage(await res.text());
}

// A competition's games for a stored source: what the sync applies.
export async function fetchMajestri(source, fetchImpl = globalThis.fetch) {
  const s = sanitizeMajestriSource(source);
  if (!s || s.error) throw new Error(s?.error || NOT_A_MAJESTRI_LINK);
  const page = await fetchMajestriPage(s.url, fetchImpl);
  return majestriRecords(page, { team: s.team, teamId: s.teamId, compId: parseMajestriLink(s.url).compId });
}

// What a pasted link says once its page is read, for the set-up to read back
// before anything is saved:
//   { provider: "majestri", link, majestri: { url, team?, teamId? },
//     found: { competition, division, season, teams: [names], games, ours, ourGames } }
// or { error }. `ours` is our team's name when the link names it (a team's
// own page) or the `team` given is one of the page's teams; the set-up
// chooses it otherwise. `majestri.teamId` is Majestri's number for it, kept
// so a team renamed on Majestri is still found.
export async function lookupMajestriLink(raw, fetchImpl = globalThis.fetch, { team = "" } = {}) {
  const parsed = parseMajestriLink(raw);
  if (parsed.error) return { error: parsed.error };
  let page;
  try { page = await fetchMajestriPage(parsed.link, fetchImpl); }
  catch (e) { return { error: String(e?.message || e) }; }
  // Our team: the one the link is the page of, else the name the wizard
  // already has for it. A name that fits no team, or more than one, is no
  // team, and the wizard asks for it again.
  let ours = "";
  if (parsed.teamId || team) {
    try { ours = ourMajestriTeam(page, { team, teamId: parsed.teamId }); } catch { ours = ""; }
  }
  const ourId = ours ? page.teams.find((t) => same(t.name, ours))?.id || "" : "";
  const known = page.games.filter((g) => !g.tba);
  const ourGames = ours ? known.filter((g) => (same(g.home, ours) || same(g.away, ours)) && !/^bye$/i.test(same(g.home, ours) ? g.away : g.home)).length : 0;
  return {
    provider: "majestri", link: parsed.link,
    majestri: { url: majestriCompUrl(parsed.host, parsed.compId), ...(ours ? { team: ours } : {}), ...(ourId ? { teamId: ourId } : {}) },
    found: { competition: page.competition, division: page.division, season: page.season, teams: page.teams.map((t) => t.name), games: known.length, ours, ourGames }
  };
}
