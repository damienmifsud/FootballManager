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

// The crest beside a game's opponent. `crest` is the club logo library's
// choice for the game, as the server sent it (opponentCrest, lib/clubLogoStore.js):
// a logo the admin chose for the club, which stands even over our artwork (a
// club changes its logo), or one found for it, or null for none. Then our
// artwork for the club; then, when the server sent nothing, the game's own
// logo (`logo`) if sourceLogo allows it; else none, for an initials disc. A
// logo that isn't our artwork is `drawn`: fitted inside the circle on white
// rather than cropped to it, enlarged as the admin chose (crestFill).
export function oppCrestFor(name, logo, crest) {
  if (typeof crest === "string" && crest.replace(FILL_TAIL, "").length <= LOGO_MAX && /^https:\/\//.test(crest)) return { src: crest, drawn: true };
  const built = crestFor(name);
  if (built) return { src: built, drawn: false };
  if (crest !== undefined) return { src: null, drawn: false };
  const drawn = sourceLogo(logo);
  return drawn ? { src: drawn, drawn: true } : { src: null, drawn: false };
}

// How much a chosen logo is enlarged in its circle, so it fills the circle
// rather than sitting small in white: 1 (as it comes) to FILL_MAX. It rides
// on the logo's link as "#fill=1.25", which a browser never sends when it
// asks for the image, so every place that shows a crest gets it with the link.
export const FILL_MAX = 1.6;
const FILL_STEP = 0.05;
const FILL_TAIL = /#fill=(\d(?:\.\d{1,2})?)$/;
export const cleanFill = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 1) return 1;
  return Math.round(Math.min(FILL_MAX, Math.round(n / FILL_STEP) * FILL_STEP) * 100) / 100;
};
export const withFill = (url, fill) => (url && cleanFill(fill) > 1 ? `${url}#fill=${cleanFill(fill)}` : url || "");
// The style that enlarges a drawn logo inside its circle: scaled up, and the
// circle cut back to its own size so nothing spills past it. {} for 1.
export function crestFill(src) {
  const m = FILL_TAIL.exec(String(src || ""));
  const fill = m ? cleanFill(m[1]) : 1;
  return fill > 1 ? { transform: `scale(${fill})`, clipPath: `circle(${(50 / fill).toFixed(2)}% at 50% 50%)` } : {};
}

// The team's own logo has its size in the circle on the team (logoFill, 1 to
// FILL_MAX), chosen with its coach's Club logo card. It counts only for a logo
// the team chose: the bundled crest is made for the circle already.
export const ourLogoFill = (team) => (team && typeof team.logo === "string" && team.logo ? cleanFill(team.logoFill) : 1);
// The style that enlarges our logo in its circle: the picture is made bigger
// than its frame and centred on it, and the frame (the circle, with the
// team's ring around it) cuts it back. Nothing outside the picture changes,
// so the ring stays, which crestFill's clipping would cut away. null for 1.
export function ourCrestZoom(fill) {
  const f = cleanFill(fill);
  if (f <= 1) return null;
  const off = `${(-(f - 1) * 50).toFixed(1)}%`, size = `${(f * 100).toFixed(1)}%`;
  return { position: "absolute", left: off, top: off, width: size, height: size, maxWidth: "none" };
}
