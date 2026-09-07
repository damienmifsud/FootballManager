// Club crest registry. Every crest is a local 512x512 PNG in public/crests,
// built so it is safe for `object-fit: cover; border-radius: 50%` (round badges
// fill the circle; square or shield artwork is padded on its own background so
// the circular crop clips nothing). No hotlinks anywhere: Squadi's logoUrl on a
// fixture is data we keep but never render. A club without artwork falls back
// to an initials disc (see <Crest> in components/Dashboard.jsx).
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
