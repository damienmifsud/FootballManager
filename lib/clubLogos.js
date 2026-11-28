// The club logo library's extension: logos found in the draws themselves, for
// opposition clubs the built-in registry has no artwork for (interstate and
// overseas clubs, independent academies and tournament-only teams). The
// built-in registry (lib/clubs.js CLUBS, public/crests) is left exactly as it
// is and always comes first: a team it knows keeps its crest, whatever a draw
// says.
//
// What is kept is where the provider shows a logo, never a copy of the image.
// Squadi's licence does not allow copying a copyrighted image through it
// without the owner's say-so, and Dribl's terms could not be read, so the
// library holds a reference and the families' phones load the image from
// Squadi's or Dribl's own image host (lib/clubs.js sourceLogo).
//
// Pure: no store, no network. lib/clubLogoStore.js keeps the one document for
// the whole club, since every team shares the same opposition:
//   {
//     clubs:  { [clubRef]: { names: [teamName, …], logo?, from, seen } },
//     teams:  { [teamRef]: { name, club?, logo?, from, seen } },
//     manual: { [teamRef or clubRef]: { hidden: true } },
//     named:  { [key]: { name, logo, site, at } }
//   }
//   clubRef  "squadi:org:<n>"  a Squadi organisation: the number is in the
//                              file name of the logo Squadi gives its teams.
//            "dribl:club:<id>" a club in Dribl's club list, or named on a game.
//   teamRef  "squadi:team:<id>", "dribl:team:<id>": the provider's own team.
//            "<provider>:name:<name>": a team its provider names without an
//            id. That exact name (letter case and spacing aside) on that
//            provider only: never a similar name, never across providers.
// A club is only ever one provider's own record. Two teams are the same club
// when the provider says so (the same organisation number, the same club id,
// or the same club logo image), never because their names look alike.
//
// Logos are of three kinds. A club logo (Squadi's organisation logo, a logo in
// Dribl's club list) is shown for every team of the club. A team's own logo
// (an academy's badge, say) is shown for that team only. A competition's logo,
// which Squadi gives every team of some tournaments, is no one's crest and is
// never kept.
//
// `manual` holds what the club's admin chose and is never touched by what a
// draw says: a logo hidden stays hidden however often it is found again.
//
// `named` holds the clubs the admin added from their own websites, for a club
// neither draw gives a logo for (see "Clubs the admin adds" below). An added
// club is held for the club, not a team: every team whose name has all of the
// club's words is shown its logo, as the built-in crests are matched, and the
// admin sees which teams that is before saving. That is the admin's choice,
// never a guess made here: two teams found on Squadi or Dribl are still only
// the same club when the provider says so.
import { crestFor, sourceLogo, squadiObject, LOGO_MAX } from "@/lib/clubs";

export const NAME_MAX = 80;
export const NAMED_MAX = 300;
export const SITE_MAX = 400;
const MAX_CLUBS = 2000;
const MAX_TEAMS = 5000;
const MAX_NAMES = 24;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
// A team's name as the provider writes it, for telling it apart from others:
// letter case and spacing only. "St George" and "St. George" stay two names.
export const sameName = (s) => text(s, NAME_MAX).toLowerCase();

const ID = "[A-Za-z0-9_-]{1,48}";
const REF = new RegExp(`^(squadi:(org|team):\\d{1,12}|dribl:(club|team):${ID}|(squadi|dribl):name:.{1,${NAME_MAX}})$`);
export const isRef = (v) => typeof v === "string" && REF.test(v);

// Which provider a game came from, by its id: Dribl's and Majestri's say so,
// Squadi's is a plain number.
export function providerOf(game) {
  const id = game?.squadiId;
  if (typeof id === "string" && id.startsWith("dribl:")) return "dribl";
  if (typeof id === "string" && id.startsWith("majestri:")) return "majestri";
  return (typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && /^\d{1,12}$/.test(id)) ? "squadi" : "";
}

// What a Squadi logo address is: a club's logo (with the organisation it
// belongs to), a competition's, or a team's own. Null for anything that is not
// a logo in Squadi's storage. The number Squadi files an organisation's logo
// under ("organisation/logo_org_<n>_<upload>") is the same for every team of
// that organisation, whichever competition it plays in.
export function squadiLogoKind(url) {
  const object = squadiObject(url);
  if (!object) return null;
  if (object.startsWith("competitions/")) return { kind: "competition" };
  const shown = sourceLogo(url);
  if (!shown) return null;
  const org = /^organisation\/logo_org_(\d{1,12})_/.exec(object);
  if (org) return { kind: "club", club: `squadi:org:${Number(org[1])}`, url: shown };
  return { kind: "team", url: shown };
}

// The team a game is against, as the library keys it.
export function teamRefOf(game, provider = providerOf(game)) {
  if (provider !== "squadi" && provider !== "dribl") return "";
  const ref = game?.opponentRef;
  if (isRef(ref) && ref.startsWith(`${provider}:team:`)) return ref;
  const name = sameName(game?.opponent);
  return name ? `${provider}:name:${name}` : "";
}
const nameRefOf = (game, provider) => {
  const name = sameName(game?.opponent);
  return name && (provider === "squadi" || provider === "dribl") ? `${provider}:name:${name}` : "";
};

// ---- Clubs the admin adds -------------------------------------------------
// A club neither draw gives a logo for can be added by the admin: its name and
// a logo picked from its own website (lib/clubSite.js). It is held for the
// club: every team whose name has every word of the club's (letter case and
// punctuation aside) is shown its logo, the teams still to come included, the
// way the built-in crests are matched. Every word counts, "FC" too: "Seaside
// FC" is not "Seaside Rovers". A name made only of words every club has
// ("FC", "Football Club") is no club's.
//   named: { [key]: { name, logo, site, at } }   key: the club's words, "seaside-fc"
const GENERIC = new Set(["fc", "sc", "afc", "jfc", "club", "football", "soccer", "inc", "the", "and", "of", "united", "city"]);
const wordsOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
export const clubWords = (name) => {
  const words = [...new Set(wordsOf(name))].slice(0, 8);
  return words.some((w) => !GENERIC.has(w) && w.length >= 2) ? words : [];
};
export const namedKey = (name) => clubWords(name).join("-");
// Whether a team's name has every one of the club's words, as whole words.
export function namedCovers(words, teamName) {
  if (!Array.isArray(words) || !words.length) return false;
  const have = new Set(wordsOf(teamName));
  return words.every((w) => have.has(w));
}
// The club a team's name starts with, as a first guess for the admin: the
// words before its age group or division ("Valley Wanderers FC Academy U12
// Maroon" is "Valley Wanderers FC").
const SUFFIX = /^(u\d{1,2}[a-z]?|under|o\d{2}|fqa\d*|fqpl\d*|npl\d*|div\d*|division|d\d|k\d|boys|girls|mixed|womens?|mens?|reserves|res|academy|youth|juniors?|seniors?|\d+)$/i;
export function guessClubName(teamName) {
  const words = text(teamName, NAME_MAX).split(" ").filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && SUFFIX.test(w.replace(/[^a-z0-9]/gi, "")));
  return (cut > 0 ? words.slice(0, cut) : words).join(" ");
}
// The added club a team belongs to: of those whose words are all in its name,
// the one with the most words (so "Seaside Reds" beats "Seaside" for that
// team), or null.
export function namedClubFor(library, teamName) {
  const named = library?.named;
  if (!isObj(named)) return null;
  let best = null, bestScore = 0;
  for (const [key, c] of Object.entries(named)) {
    const words = key.split("-").filter(Boolean);
    if (!namedCovers(words, teamName)) continue;
    const score = words.length * 100 + key.length;
    if (score > bestScore) { best = { key, ...c }; bestScore = score; }
  }
  return best;
}
// A link the admin chose: https, no name, password or port, short enough to keep.
function httpsLink(v, max) {
  if (typeof v !== "string" || !v || v.length > max) return "";
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password && !u.port ? u.href : ""; } catch { return ""; }
}
// The admin adds a club, or changes one added before (the same words are the
// same club): { lib, key }, or { error } saying what is missing.
export function setNamedClub(library, { name, logo, site, today = "" } = {}) {
  const lib = cleanLibrary(library);
  const clean = text(name, NAME_MAX);
  const key = namedKey(clean);
  const pic = httpsLink(logo, LOGO_MAX);
  if (!key) return { error: "Give the club's name." };
  if (!pic) return { error: "Pick a logo first." };
  if (!(key in lib.named) && Object.keys(lib.named).length >= NAMED_MAX) return { error: "The library holds as many added clubs as it can." };
  lib.named[key] = { name: clean, logo: pic, site: httpsLink(site, SITE_MAX), at: text(today, 10) };
  return { lib, key };
}
export function dropNamedClub(library, key) {
  const lib = cleanLibrary(library);
  delete lib.named[key];
  return lib;
}

// A stored document, checked: anything that is not in the shape above is
// dropped, so a hand-edited or older document can never break a read.
export function cleanLibrary(raw) {
  const lib = { clubs: {}, teams: {}, manual: {}, named: {} };
  if (!isObj(raw)) return lib;
  // A competition's logo is no one's crest, whatever an older document holds.
  const logo = (v) => (typeof v === "string" && v.length <= 400 && /^https:\/\//.test(v) && squadiLogoKind(v)?.kind !== "competition" ? v : "");
  for (const [ref, c] of Object.entries(isObj(raw.clubs) ? raw.clubs : {}).slice(0, MAX_CLUBS)) {
    if (!isRef(ref) || !isObj(c) || !/^(squadi:org|dribl:club):/.test(ref)) continue;
    const names = [...new Set((Array.isArray(c.names) ? c.names : []).map((n) => text(n, NAME_MAX)).filter(Boolean))].slice(0, MAX_NAMES);
    lib.clubs[ref] = { names, ...(logo(c.logo) ? { logo: logo(c.logo) } : {}), from: text(c.from, 20), seen: text(c.seen, 10) };
  }
  for (const [ref, t] of Object.entries(isObj(raw.teams) ? raw.teams : {}).slice(0, MAX_TEAMS)) {
    if (!isRef(ref) || !isObj(t) || /^(squadi:org|dribl:club):/.test(ref)) continue;
    lib.teams[ref] = {
      name: text(t.name, NAME_MAX),
      ...(isRef(t.club) && /^(squadi:org|dribl:club):/.test(t.club) ? { club: t.club } : {}),
      ...(logo(t.logo) ? { logo: logo(t.logo) } : {}),
      from: text(t.from, 20), seen: text(t.seen, 10)
    };
  }
  for (const [ref, m] of Object.entries(isObj(raw.manual) ? raw.manual : {})) {
    if (isRef(ref) && isObj(m) && m.hidden === true) lib.manual[ref] = { hidden: true };
  }
  for (const [key, c] of Object.entries(isObj(raw.named) ? raw.named : {}).slice(0, NAMED_MAX)) {
    const name = isObj(c) ? text(c.name, NAME_MAX) : "";
    const logo = isObj(c) ? httpsLink(c.logo, LOGO_MAX) : "";
    if (!name || !logo || namedKey(name) !== key) continue;
    lib.named[key] = { name, logo, site: httpsLink(c.site, SITE_MAX), at: text(c.at, 10) };
  }
  return lib;
}

// The logos `games` from one provider show for their opponents, added to the
// library. Returns { lib, changed }. `allowed(url)` says whether a logo may be
// shown (lib/clubs.js sourceLogo, plus any host the site adds); a logo that
// may not is not kept. A team the built-in registry has artwork for is still
// noted (so its other names are known), but nothing found for it is ever used
// while the built-in crest is there. `manual` is never changed here.
export function learnFromGames(library, games, provider, { allowed = sourceLogo, today = "" } = {}) {
  const lib = cleanLibrary(library);
  const before = JSON.stringify(lib);
  if (provider !== "squadi" && provider !== "dribl") return { lib, changed: false };
  const from = provider === "squadi" ? "Squadi" : "Dribl";
  for (const g of Array.isArray(games) ? games : []) {
    if (!isObj(g) || g.bye || !text(g.opponent, NAME_MAX)) continue;
    const ref = teamRefOf(g, provider);
    if (!ref) continue;
    if (!lib.teams[ref] && Object.keys(lib.teams).length >= MAX_TEAMS) continue;
    const team = { ...(lib.teams[ref] || {}), name: text(g.opponent, NAME_MAX), from, seen: lib.teams[ref]?.seen || today };
    if (provider === "squadi") {
      const k = squadiLogoKind(g.opponentLogo);
      if (k?.kind === "club" && allowed(k.url)) {
        team.club = k.club;
        delete team.logo; // the club's logo, kept once on the club
        addClub(lib, k.club, { name: team.name, logo: k.url, from, today });
      } else if (k?.kind === "team" && allowed(k.url)) {
        team.logo = k.url;
      }
    } else {
      const clubRef = isRef(g.opponentClubRef) && g.opponentClubRef.startsWith("dribl:club:") ? g.opponentClubRef : "";
      const url = typeof g.opponentLogo === "string" && allowed(g.opponentLogo) ? g.opponentLogo : "";
      if (clubRef) { team.club = clubRef; addClub(lib, clubRef, { name: team.name, from, today }); }
      const club = team.club ? lib.clubs[team.club] : null;
      // The club's own logo on a game is the club's; any other is the team's.
      if (url && !(club?.logo && club.logo === url)) team.logo = url;
      if (url && club?.logo === url) delete team.logo;
    }
    lib.teams[ref] = team;
    // A team first met without its id (an older game) and now with it: the
    // same team, by the same exact name on the same provider.
    const byName = nameRefOf(g, provider);
    if (byName && byName !== ref && lib.teams[byName]) delete lib.teams[byName];
  }
  return { lib, changed: JSON.stringify(lib) !== before };
}

function addClub(lib, ref, { name, logo = "", from, today }) {
  if (!lib.clubs[ref] && Object.keys(lib.clubs).length >= MAX_CLUBS) return;
  const c = lib.clubs[ref] || { names: [], from, seen: today };
  const names = name && !c.names.some((n) => sameName(n) === sameName(name)) ? [...c.names, name].slice(0, MAX_NAMES) : c.names;
  lib.clubs[ref] = { ...c, names, ...(logo ? { logo } : {}), from: c.from || from, seen: c.seen || today };
}

// Dribl's club list ([{ id, name, logo }], read in a coach's browser and
// checked by the server), added to the library. A Dribl team whose own logo is
// exactly a listed club's logo is that club's team: the same image, not a
// similar name. Returns { lib, changed }.
export function learnDriblClubs(library, clubs, { allowed = sourceLogo, today = "" } = {}) {
  const lib = cleanLibrary(library);
  const before = JSON.stringify(lib);
  const byLogo = new Map();
  for (const c of Array.isArray(clubs) ? clubs : []) {
    if (!isObj(c) || !new RegExp(`^${ID}$`).test(String(c.id || "")) || !text(c.name, NAME_MAX)) continue;
    const ref = `dribl:club:${c.id}`;
    const logo = typeof c.logo === "string" && allowed(c.logo) ? c.logo : "";
    addClub(lib, ref, { name: text(c.name, NAME_MAX), logo, from: "Dribl", today });
    if (logo) byLogo.set(logo, byLogo.has(logo) ? null : ref); // one image, one club: shared images settle nothing
  }
  for (const [ref, t] of Object.entries(lib.teams)) {
    if (!ref.startsWith("dribl:") || !t.logo || !byLogo.get(t.logo)) continue;
    const club = byLogo.get(t.logo);
    if (t.club && t.club !== club) continue; // a game named its club: that stands
    lib.teams[ref] = { ...t, club };
    delete lib.teams[ref].logo;
    addClub(lib, club, { name: t.name, from: "Dribl", today });
  }
  return { lib, changed: JSON.stringify(lib) !== before };
}

// What the library shows beside a game's opponent:
//   undefined  the built-in registry has the club's crest (that is shown);
//   a URL      the team's own logo, else its club's, else the game's own;
//   null       nothing to show (or the admin hid it): the initials disc.
export function crestFromLibrary(library, game, { allowed = sourceLogo } = {}) {
  if (!isObj(game) || crestFor(game.opponent)) return undefined;
  const lib = library && library.clubs && library.teams && library.manual ? library : cleanLibrary(library);
  // A club the admin added is their choice, so it comes before anything found.
  const added = namedClubFor(lib, game.opponent);
  if (added) return added.logo;
  const provider = providerOf(game);
  const ref = teamRefOf(game, provider);
  const team = (ref && lib.teams[ref]) || lib.teams[nameRefOf(game, provider)] || null;
  const own = provider === "squadi" ? squadiLogoKind(game.opponentLogo) : null;
  const club = team?.club || (own?.kind === "club" ? own.club : "") ||
    (isRef(game.opponentClubRef) && game.opponentClubRef.startsWith("dribl:club:") ? game.opponentClubRef : "");
  if ((ref && lib.manual[ref]?.hidden) || (club && lib.manual[club]?.hidden)) return null;
  const pick = (url) => (typeof url === "string" && url && allowed(url) ? url : "");
  return pick(team?.logo) || pick(club && lib.clubs[club]?.logo) || pick(game.opponentLogo) || null;
}

// Every opponent the club's teams have met or will meet, with what is shown
// for it, for the admin's card and the report:
//   { opponents: [{ ref, name, provider, shown: "built-in"|"added"|"found"|"hidden"|"missing", from?, kind?, named? }],
//     counts: { opponents, builtIn, added, found, missing, hidden, newClubs, newLogos, duplicatesAvoided },
//     named: [{ key, name, logo, site, teams }] }   the clubs the admin added, with how many teams each covers
// `games` is every game of every team (byes and Majestri's internal games
// left out). newClubs counts the library's clubs none of whose teams has
// built-in artwork; newLogos, those of them (and teams of their own) with a
// logo; duplicatesAvoided, the extra team names folded into one club, built-in
// or found, rather than becoming a club each.
export function logoSummary(library, games, { allowed = sourceLogo } = {}) {
  const lib = cleanLibrary(library);
  const seen = new Map();
  for (const g of Array.isArray(games) ? games : []) {
    if (!isObj(g) || g.bye || !text(g.opponent, NAME_MAX)) continue;
    const provider = providerOf(g);
    if (provider !== "squadi" && provider !== "dribl") continue;
    const ref = teamRefOf(g, provider);
    if (!ref || seen.has(ref)) continue;
    const name = text(g.opponent, NAME_MAX);
    const built = crestFor(name);
    let row;
    // A built-in club is known by its crest: the registry's aliases share one.
    const added = built ? null : namedClubFor(lib, name);
    if (built) row = { ref, name, provider, shown: "built-in", club: `built-in:${built}` };
    else if (added) row = { ref, name, provider, shown: "added", named: added.key, logo: added.logo };
    else {
      const crest = crestFromLibrary(lib, g, { allowed });
      const team = lib.teams[ref] || lib.teams[nameRefOf(g, provider)];
      const own = provider === "squadi" ? squadiLogoKind(g.opponentLogo) : null;
      const club = team?.club || (own?.kind === "club" ? own.club : "");
      const hidden = lib.manual[ref]?.hidden || (club && lib.manual[club]?.hidden);
      row = { ref, name, provider, shown: hidden ? "hidden" : crest ? "found" : "missing", ...(club ? { club } : {}),
        ...(crest ? { kind: team?.logo === crest ? "team" : club && lib.clubs[club]?.logo === crest ? "club" : "game", from: provider === "squadi" ? "Squadi" : "Dribl", logo: crest } : {}) };
    }
    seen.set(ref, row);
  }
  const opponents = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  const count = (s) => opponents.filter((o) => o.shown === s).length;
  // Team names per club, built-in or found: each beyond the first is a
  // duplicate club record that was not made.
  const perClub = new Map();
  for (const o of opponents) if (o.club) perClub.set(o.club, (perClub.get(o.club) || 0) + 1);
  const duplicatesAvoided = [...perClub.values()].reduce((n, k) => n + k - 1, 0);
  const newClubRefs = new Set(opponents.filter((o) => o.shown !== "built-in" && o.club).map((o) => o.club));
  const newLogos = new Set(opponents.filter((o) => o.shown === "found").map((o) => o.logo)).size;
  const named = Object.entries(lib.named)
    .map(([key, c]) => ({ key, name: c.name, logo: c.logo, site: c.site, teams: opponents.filter((o) => o.named === key).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    opponents,
    counts: { opponents: opponents.length, builtIn: count("built-in"), added: count("added"), found: count("found"), missing: count("missing"), hidden: count("hidden"), newClubs: newClubRefs.size, newLogos, duplicatesAvoided },
    named
  };
}

// An admin's choice for a team or club: hidden (the initials are shown), or
// shown again (`hidden: false`, the choice is cleared).
export function setManual(library, ref, { hidden }) {
  const lib = cleanLibrary(library);
  if (!isRef(ref)) return lib;
  if (hidden) lib.manual[ref] = { hidden: true };
  else delete lib.manual[ref];
  return lib;
}
