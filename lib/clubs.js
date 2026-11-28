// Club crest registry. Every crest is a local 512x512 PNG in public/crests,
// built so it is safe for `object-fit: cover; border-radius: 50%` (round badges
// fill the circle; square or shield artwork is padded on its own background so
// the circular crop clips nothing). A club without artwork here is shown with
// the logo its draw gives it instead (sourceLogo, below: Squadi's or Dribl's
// own, from their own image hosts only), and with neither it falls back to an
// initials disc (see <Crest> in components/Crest.jsx).
//
// Source: design/handoff-2026-09-direction-c (crests-512.zip, clubs-registry.js).

const local = (k) => "/crests/" + k + ".png";

export const OUR_CREST = local("olympic-fc");

// `match` lists lower-case stems that must ALL appear in a Squadi team name for
// the key to apply; the most specific (most stems) wins, so "Lions FC U8 Orange
// Kangaroos" resolves to lions-orange, not lions-fc. Aliases share a file.
export const CLUBS = [
  { key: "olympic-fc",             name: "Olympic FC",                crest: local("olympic-fc"),             match: [["olympic"]] },
  { key: "olympic-red",            name: "Olympic FC Red",            crest: local("olympic-fc"),             match: [["olympic", "red"]] },
  { key: "oxley-united",           name: "Oxley United FC",           crest: local("oxley-united"),           match: [["oxley"]] },
  { key: "springfield-united",     name: "Springfield United FC",     crest: local("springfield-united"),     match: [["springfield"]] },
  { key: "springfield-strikers",   name: "Springfield Strikers",      crest: local("springfield-united"),     match: [["springfield", "strikers"]] },
  { key: "mfc-kangaroos",          name: "Moggill FC (MFC Kangaroos)", crest: local("mfc-kangaroos"),         match: [["mfc"], ["moggill"]] },
  { key: "lions-fc",               name: "Lions FC",                  crest: local("lions-fc"),               match: [["lions"]] },
  { key: "lions-orange",           name: "Lions FC Orange",           crest: local("lions-fc"),               match: [["lions", "orange"]] },
  { key: "lions-blue",             name: "Lions FC Blue",             crest: local("lions-fc"),               match: [["lions", "blue"]] },
  { key: "ripley-valley",          name: "Ripley Valley FC",          crest: local("ripley-valley"),          match: [["ripley"]] },
  { key: "st-george",              name: "St George Willawong FC",    crest: local("st-george"),              match: [["st george"], ["willawong"], ["st. george"]] },
  { key: "eastern-suburbs",        name: "Eastern Suburbs FC",        crest: local("eastern-suburbs"),        match: [["eastern suburbs"], ["easts"]] },
  { key: "moreton-city-excelsior", name: "Moreton City Excelsior FC", crest: local("moreton-city-excelsior"), match: [["moreton"]] },
  { key: "gold-coast-united",      name: "Gold Coast United FC",      crest: local("gold-coast-united"),      match: [["gold coast united"]] },
  { key: "gold-coast-knights",     name: "Gold Coast Knights FC",     crest: local("gold-coast-knights"),     match: [["knights"]] },
  { key: "rochedale-rovers",       name: "Rochedale Rovers FC",       crest: local("rochedale-rovers"),       match: [["rochedale"]] },
  { key: "logan-lightning",        name: "Logan Lightning FC",        crest: local("logan-lightning"),        match: [["logan"]] },
  { key: "brisbane-city",          name: "Brisbane City FC",          crest: local("brisbane-city"),          match: [["brisbane city"]] },
  { key: "wynnum-wolves",          name: "Wynnum Wolves FC",          crest: local("wynnum-wolves"),          match: [["wynnum"]] }
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Registry key for a team name as Squadi (or a coach) writes it, e.g.
// "Springfield United U8 Snipers K1" -> "springfield-united". Null if no club
// in the registry matches, so callers can fall back to an initials disc.
export function clubKeyFor(teamName) {
  const n = " " + norm(teamName) + " ";
  if (!n.trim()) return null;
  let best = null, bestScore = 0;
  for (const c of CLUBS) {
    for (const stems of c.match) {
      if (stems.every((s) => n.includes(" " + s + " ") || n.includes(" " + s) || n.includes(s + " "))) {
        // Specificity: more stems, then longer stems, beat a generic hit.
        const score = stems.length * 100 + stems.join("").length;
        if (score > bestScore) { best = c.key; bestScore = score; }
      }
    }
  }
  return best;
}

export function clubByKey(key) {
  return CLUBS.find((c) => c.key === key) || null;
}

// Local crest path for a team name, or null when we have no artwork.
export function crestFor(teamName) {
  const c = clubByKey(clubKeyFor(teamName));
  return c ? c.crest : null;
}

// The logo a draw gives a team, kept on each of its games (opponentLogo) and
// shown for a club with no artwork here. Only two kinds are shown:
//   Squadi: a club's logo in Squadi's own storage. A tournament's teams can
//     all carry the competition's logo instead of their club's; that is not a
//     crest, so it is left out.
//   Dribl: an image on Dribl's own site.
// Anything else (another host, plain http, a name, password or port in the
// address) is not shown. A Dribl draw is read in a coach's browser and posted
// from there, so what a game holds is not taken on trust: families' phones
// are only ever sent to these two for an image.
export const LOGO_MAX = 400;
const SQUADI_LOGOS = /^\/download\/storage\/v1\/b\/squadi-prod\.appspot\.com\/o\/([^/]+)$/;
const isDriblHost = (host) => host === "dribl.com" || host.endsWith(".dribl.com");
// The name of the file a Squadi logo address points at in Squadi's own
// storage ("organisation/logo_org_…", "competitions/logo_comp_…"), or null for
// any other address. Squadi writes some with a slash in front
// (".../o/%2Fcompetitions%2F…"), which is not part of what the file is.
export function squadiObject(url) {
  if (typeof url !== "string" || !url || url.length > LOGO_MAX) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.hostname !== "storage.googleapis.com") return null;
  const m = SQUADI_LOGOS.exec(u.pathname);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/^\/+/, ""); } catch { return null; }
}
export function sourceLogo(url) {
  if (typeof url !== "string" || !url || url.length > LOGO_MAX) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (u.hostname === "storage.googleapis.com") {
    const object = squadiObject(url);
    return object && !object.startsWith("competitions/") ? u.href : null;
  }
  return isDriblHost(u.hostname) ? u.href : null;
}

// The crest beside a game's opponent: our artwork for the club, else the logo
// found for it (`drawn`, so it is fitted inside the circle on white rather
// than cropped to it), else none, for an initials disc. `crest` is the club
// logo library's choice for the game, as the server sent it (opponentCrest:
// a logo, or null for none, lib/clubLogoStore.js), and stands when it is
// there. Without it, the game's own logo (`logo`) if sourceLogo allows it.
export function oppCrestFor(name, logo, crest) {
  const built = crestFor(name);
  if (built) return { src: built, drawn: false };
  if (crest !== undefined) {
    const ok = typeof crest === "string" && crest.length <= LOGO_MAX && /^https:\/\//.test(crest);
    return ok ? { src: crest, drawn: true } : { src: null, drawn: false };
  }
  const drawn = sourceLogo(logo);
  return drawn ? { src: drawn, drawn: true } : { src: null, drawn: false };
}
