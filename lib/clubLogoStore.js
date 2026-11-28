// The club logo library on the server: reading it, adding what a sync found
// (lib/clubLogos.js), and putting each game's crest on the team's document as
// it is sent to a browser.
//
// Finding logos never holds up a sync or changes what it reports: it runs
// after the games are applied, under its own short lock, and anything that
// goes wrong (a busy lock, the store failing) is reported back and otherwise
// ignored. The next sync tries again.
import { getClubLogos, setClubLogos, takeLock, dropLock } from "@/lib/store";
import { cleanLibrary, learnFromGames, learnDriblClubs, crestFromLibrary } from "@/lib/clubLogos";
import { sourceLogo } from "@/lib/clubs";

// Image hosts the site allows for logos besides Squadi's and Dribl's own
// (lib/clubs.js sourceLogo): LOGO_HOSTS, exact host names separated by commas.
// For a provider that keeps its logos somewhere else, once the set-up's
// read-back has named the host. Never a wildcard.
export function extraLogoHosts(env = process.env) {
  return String(env.LOGO_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
}
export function logoAllowed(url, env = process.env) {
  if (sourceLogo(url)) return true;
  if (typeof url !== "string" || !url || url.length > 400) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === "https:" && !u.username && !u.password && !u.port && extraLogoHosts(env).includes(u.hostname);
}

// A copy kept for half a minute: every team page read asks for it.
let cached = null, cachedAt = 0;
const FRESH_MS = 30_000;
export async function readLibrary() {
  if (cached && Date.now() - cachedAt < FRESH_MS) return cached;
  cached = cleanLibrary(await getClubLogos());
  cachedAt = Date.now();
  return cached;
}
export function forgetLibrary() { cached = null; cachedAt = 0; }

const LOCK = ["_club", "logos"];
async function takeLibraryLock() {
  for (let i = 0; i < 3; i++) {
    if (await takeLock(...LOCK, 20)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// Changes the library under its lock: `change(lib)` returns { lib, changed }.
export async function changeLibrary(change) {
  try {
    if (!(await takeLibraryLock())) return { ok: false, error: "the logo library is busy" };
    try {
      const { lib, changed } = change(cleanLibrary(await getClubLogos()));
      if (changed) { await setClubLogos(lib); cached = lib; cachedAt = Date.now(); }
      return { ok: true, changed: !!changed, lib };
    } finally { await dropLock(...LOCK); }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// What a sync's draws showed of their opponents' logos, added to the library.
// `draws` are [{ provider: "squadi" | "dribl", records }]; `clubs` is Dribl's
// club list as the server checked it. Never throws.
export async function learnLogos({ draws = [], clubs = [] } = {}) {
  const useful = (Array.isArray(draws) ? draws : []).filter((d) => d && (d.provider === "squadi" || d.provider === "dribl") && Array.isArray(d.records) && d.records.length);
  if (!useful.length && !(Array.isArray(clubs) && clubs.length)) return { ok: true, changed: false };
  const r = await changeLibrary((start) => {
    let lib = start, changed = false;
    for (const d of useful) {
      const out = learnFromGames(lib, d.records, d.provider, { allowed: (u) => logoAllowed(u), today: today() });
      lib = out.lib; changed = changed || out.changed;
    }
    if (Array.isArray(clubs) && clubs.length) {
      const out = learnDriblClubs(lib, clubs, { allowed: (u) => logoAllowed(u), today: today() });
      lib = out.lib; changed = changed || out.changed;
    }
    return { lib, changed };
  });
  const { lib, ...report } = r;
  return report;
}

// The team's document as a browser gets it, with each game's crest from the
// library: `opponentCrest` is the logo to show (a URL) or null for the
// initials, and is left off a game whose club the built-in registry has
// artwork for. It is worked out on every read and never stored: the POST that
// saves a coach's document takes it off again (withoutCrests).
export function withCrests(doc, lib) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.fixtures)) return doc;
  let any = false;
  const fixtures = doc.fixtures.map((f) => {
    const crest = crestFromLibrary(lib, f, { allowed: (u) => logoAllowed(u) });
    if (crest === undefined) return f;
    any = true;
    return { ...f, opponentCrest: crest };
  });
  return any ? { ...doc, fixtures } : doc;
}
export function withoutCrests(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.fixtures)) return doc;
  if (!doc.fixtures.some((f) => f && typeof f === "object" && "opponentCrest" in f)) return doc;
  return { ...doc, fixtures: doc.fixtures.map((f) => { if (!f || typeof f !== "object" || !("opponentCrest" in f)) return f; const { opponentCrest, ...rest } = f; return rest; }) };
}
// withCrests for a read that must never fail on the library's account: a
// library that cannot be read just means no found logos this time.
export async function withCrestsSafely(doc) {
  try { return withCrests(doc, await readLibrary()); } catch { return doc; }
}
