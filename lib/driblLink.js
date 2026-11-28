// A Dribl fixtures page link → the fixtures request the sync fetches.
//
// What someone can copy from their phone is the address of the competition's
// fixtures page, with their club and age group chosen on it:
//   https://winterleague.dribl.com/fixtures?date_range=all&season=…&competition=…&league=…&club=…&timezone=…
// What the sync fetches (lib/dribl.js) is the request that page makes:
//   https://mc-api.dribl.com/api/fixtures?date_range=all&season=…&competition=…&league=…&club=…&tenant=…&timezone=…
// The two carry the same filters. The request also names the match centre it
// belongs to (`tenant`), which the page link only shows as its host name. So
// that one identifier is asked of Dribl, the way the page itself asks when it
// opens: which match centre lives at this address?
//
// Like every request to Dribl this is made by the browser, never by our
// server (Dribl turns servers away): a plain GET with no cookies and one
// Accept header, to mc-api.dribl.com and nowhere else. What comes back is only
// ever used as one checked identifier in a request built here; no address
// Dribl sends is followed.
//
// Dribl publishes no description of this lookup. It is read strictly: an
// answer that does not name one match centre is an error that says what it
// was made of, and the request can still be pasted by hand (the wizard's
// Dribl fixtures request field), so a change on Dribl's side costs the
// shortcut and nothing else.
//
// Pure apart from `fetch`: no store, no Next imports.
import { parseFeedLink, DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";
import { DRIBL_API_HOST, UNREACHABLE, WHICH_TEAM, driblFixturesUrl, driblTimeZone, fetchDriblItems, fetchDriblClubs, normalizeDribl, driblDrawNames } from "@/lib/dribl";
import { sourceLogo } from "@/lib/clubs";

const HASH = /^[A-Za-z0-9]{4,24}$/; // Dribl's ids: short letter-and-digit strings
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");
// An address as Dribl may hold it ("https://Name.dribl.com/") down to its host.
const hostOf = (v) => str(v).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

export const NOT_A_DRIBL_LINK = "That is not a Dribl fixtures link. Open your team's fixtures page on Dribl, copy its address and paste it here.";
export const NO_MATCH_CENTRE = "Dribl did not say which match centre this link belongs to.";

// The questions to ask, in order, until one names the match centre: by its
// address and short name together, as the page asks, then by short name alone.
export function matchCentreLookups({ host, site }) {
  const base = `https://${DRIBL_API_HOST}/api/tenants`;
  return [`${base}?${new URLSearchParams({ mc_link: host, slug: site })}`, `${base}?${new URLSearchParams({ slug: site })}`];
}

// The match centre's id in Dribl's answer, or "" when the answer does not name
// one. An answer is { data: centre } or { data: [centre, …] }, a centre being
// { id, attributes: { slug, mc_link, … } }. The one that carries our address
// or short name is it; failing that, an answer of exactly one centre is, since
// one was asked for. Several with nothing to tell them apart is no answer.
export function matchCentreId(json, { host, site }) {
  const data = isPlainObject(json) ? json.data : null;
  const list = (Array.isArray(data) ? data : [data]).filter(isPlainObject);
  const named = list.filter((t) => {
    const a = isPlainObject(t.attributes) ? t.attributes : t;
    return hostOf(a.mc_link) === host || str(a.slug).toLowerCase() === site;
  });
  const centre = named.length === 1 ? named[0] : !named.length && list.length === 1 ? list[0] : null;
  if (!centre) return "";
  return [centre.id, centre.hash_id, centre.attributes?.hash_id].map(str).find((v) => HASH.test(v)) || "";
}

// What an answer was made of, for the error that says it could not be read:
// field names only, never what they held.
function madeOf(json) {
  if (!isPlainObject(json)) return json === null ? "nothing this app could read" : typeof json;
  const data = Array.isArray(json.data) ? json.data[0] : json.data;
  const top = Object.keys(json).slice(0, 8).join(", ");
  const inner = isPlainObject(data) ? Object.keys(data).slice(0, 10).join(", ") : "";
  return (inner ? `${top}; data: ${inner}` : top || "no fields").slice(0, 240);
}

// The fixtures request for a pasted page link: { link, url }. `link` is the
// page link as it is kept; `url` is the request in its stored form
// (driblFixturesUrl). Throws with a sentence when the text is not a Dribl
// fixtures link, when Dribl cannot be reached, or when it does not name the
// match centre.
export async function driblRequestFromLink(raw, fetchImpl = globalThis.fetch) {
  const parsed = parseFeedLink(raw);
  if (parsed.provider !== "dribl") throw new Error(parsed.error === DRIBL_NEEDS_COMPETITION ? parsed.error : NOT_A_DRIBL_LINK);
  let tenant = "", said = "";
  for (const lookup of matchCentreLookups(parsed)) {
    let res;
    // A request the browser could not make at all rejects in the browser's own
    // words; asking again another way would fail the same.
    try { res = await fetchImpl(lookup, { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" }); }
    catch { throw new Error(UNREACHABLE); }
    if (!res.ok) { said = `Dribl responded ${res.status} when asked which match centre this is.`; continue; }
    let json = null;
    try { json = await res.json(); } catch {} // a page rather than data
    tenant = matchCentreId(json, parsed);
    if (tenant) break;
    said = `${NO_MATCH_CENTRE} Its answer has: ${madeOf(json)}.`;
  }
  if (!tenant) throw new Error(said || NO_MATCH_CENTRE);
  const query = new URLSearchParams({ date_range: "all" });
  for (const key of ["season", "competition", "league", "club"]) if (parsed[key]) query.set(key, parsed[key]);
  query.set("tenant", tenant);
  if (parsed.timezone) query.set("timezone", parsed.timezone);
  const url = driblFixturesUrl(`https://${DRIBL_API_HOST}/api/fixtures?${query}`);
  if (!url) throw new Error(NO_MATCH_CENTRE);
  return { link: parsed.link, url };
}

// Read a stored request's draw once, to say what is in it before it is saved:
//   { draw, problem }
// `draw` is what the games say about themselves (lib/dribl.js driblDrawNames:
// how many, which teams, which is ours when that is settled, the draw's own
// names), or null when Dribl did not give a draw. `problem` is why the sync
// could not use it as it stands, as a sentence, or "" when it can, or when all
// that is missing is which team is ours (draw.ours is "" and the set-up asks).
// The same reading the sync does is done here, so a draw it could not apply
// is said now rather than found on a coach's next visit.
//
// Dribl's club list is asked for alongside (lib/dribl.js fetchDriblClubs), for
// the club logo library: `clubs` says how many clubs it lists, how many with a
// logo the app can show, the hosts and the fields it had, or why it could not
// be read ({ error }). It never changes what is said of the draw.
export async function readDriblDraw(source, fetchImpl = globalThis.fetch) {
  const [read, clubs] = await Promise.all([
    fetchDriblItems(source, fetchImpl).then((items) => ({ items }), (e) => ({ error: String(e?.message || e) })),
    driblClubsReadBack(source, fetchImpl)
  ]);
  if (read.error) return { draw: null, problem: read.error, clubs };
  const { items } = read;
  const draw = driblDrawNames(items, source?.team);
  let problem = draw.problem;
  if (!problem) {
    try { normalizeDribl(items, { team: source?.team, timeZone: driblTimeZone(source?.url) }); }
    catch (e) { if (e.message !== WHICH_TEAM) problem = String(e?.message || e); }
  }
  return { draw, problem, clubs };
}

// What Dribl's club list held, for the read-back: counts, hosts and field
// names only.
export async function driblClubsReadBack(source, fetchImpl = globalThis.fetch) {
  try {
    const { clubs, fields } = await fetchDriblClubs(source, fetchImpl);
    const hosts = {}, elsewhere = new Set();
    let withLogo = 0, shown = 0;
    for (const c of clubs) {
      if (!c.logo) continue;
      withLogo++;
      const ok = !!sourceLogo(c.logo);
      if (ok) shown++;
      try { const h = new URL(c.logo).hostname; hosts[h] = (hosts[h] || 0) + 1; if (!ok) elsewhere.add(h); } catch {}
    }
    return { count: clubs.length, withLogo, shown, hosts, elsewhere: [...elsewhere].slice(0, 5), fields: fields.slice(0, 40) };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// A pasted page link, all the way: { link, url, draw, problem }. Throws only
// when no request could be worked out (driblRequestFromLink); a request whose
// draw could not be read is still returned, with the reason.
export async function readDriblLink(raw, { team = "", fetchImpl = globalThis.fetch } = {}) {
  const { link, url } = await driblRequestFromLink(raw, fetchImpl);
  return { link, url, ...(await readDriblDraw({ url, team }, fetchImpl)) };
}
