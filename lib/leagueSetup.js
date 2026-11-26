// The league page's setup: which Squadi draw a team's /league page embeds.
// It lives on the team document as data.squadi:
//   { mode: "builder" | "url", url, org, yearId, comp, divisionId, teamId }
// mode "url" embeds the pasted link; mode "builder" builds one from the
// organisation key, the year id, the competition's unique key and the division
// and team ids.
//
// Not the same thing as the wizard's sync ids on the team registry entry
// (team.squadi: competitionId, divisionId, teamId, used by /api/sync). The
// widget needs the competition's unique key (a UUID), which the registry does
// not hold, so one is never derived from the other here. The sync ids are
// read for one thing only: recognising the original team (isOriginalTeam).
//
// Pure: no store, no Next imports. /api/league calls these server-side.

const ID_MAX = 64;
const URL_MAX = 2000;

export const NOT_A_SQUADI_LINK = "That is not a Squadi link. It should start with https://registration.squadi.com/";

// The pre-multi-team default: the original team's 2026 draw. /league used to
// embed it for every team that had not saved a setup of its own, which put one
// team's fixtures on every other team's page. It now belongs to the original
// team alone (isOriginalTeam below), so that team's page keeps working whether
// or not anyone there ever pressed save, and no other team is shown it.
export const LEGACY_LEAGUE_SETUP = Object.freeze({
  mode: "builder",
  url: "",
  org: "b0e92958-980b-4da0-9ec9-a9c2597b06f0", // FQ Metro Region
  yearId: "8", // 2026
  comp: "58ec2bda-ceed-48f2-a33e-5b9d13cc30e8", // Metro | Coles MiniRoos & U12 (2026)
  divisionId: "10661", // Under 8 Kangaroos K1 Central Hub (2026)
  teamId: "110013" // Olympic FC U8 Kangaroos White (2026)
});

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A key or id as typed into the form: a trimmed, capped string. Numbers are
// accepted (a team id is one); anything else is dropped rather than stringified.
function idText(v) {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v.trim().slice(0, ID_MAX) : "";
}

// A pasted link is only kept when it is a plain https link on squadi.com or
// one of its subdomains: no credentials, no port. It becomes an iframe src and
// a link for every family on the team, so /api/league stores nothing else
// (and the whole-document save never writes the key: lib/protect.js). Returns
// the parsed, normalised form, which is what the length cap applies to. A
// setup saved before this check existed is served as it was stored.
const SQUADI_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*squadi\.com$/;
function squadiLink(raw) {
  if (raw.length > URL_MAX) return "";
  let u;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
  if (!SQUADI_HOST.test(u.hostname)) return "";
  return u.href.length <= URL_MAX ? u.href : "";
}

// Server-side guard for a setup sent by the league page. Returns
// { squadi } with exactly the seven known keys, or { error } when the input
// cannot be stored. A link that is not a Squadi link is refused in "url" mode
// (the coach is told why); in "builder" mode the url field is not in use, so a
// stray value there is dropped instead of blocking the save.
export function sanitizeLeagueSetup(input) {
  if (!isPlainObject(input)) return { error: "bad request" };
  const mode = input.mode === "url" ? "url" : "builder";
  const pasted = typeof input.url === "string" ? input.url.trim() : "";
  const url = pasted ? squadiLink(pasted) : "";
  if (mode === "url" && pasted && !url) return { error: NOT_A_SQUADI_LINK };
  return {
    squadi: {
      mode,
      url,
      org: idText(input.org),
      yearId: idText(input.yearId),
      comp: idText(input.comp),
      divisionId: idText(input.divisionId),
      teamId: idText(input.teamId)
    }
  };
}

// Is this the one team the old default belongs to? The legacy owner is (the
// team that predates the others: lib/store.js legacyOwnerSlug, passed in so
// this file stays free of the store). So is a team whose own Squadi sync ids
// on the registry entry name the original team's Squadi team: that is the same
// team under whatever slug, and it keeps a first-listed-team assumption from
// being the only thing the original team's page hangs on.
export function isOriginalTeam(team, legacySlug) {
  if (!team) return false;
  if (team.slug && team.slug === legacySlug) return true;
  return String(team.squadi?.teamId ?? "").trim() === LEGACY_LEAGUE_SETUP.teamId;
}

// The old page's form started from that default on every team and saved the
// whole form, so another team's stored setup can still carry the original
// team's ids: all three when a coach pressed save without changing them, or
// alongside a pasted link, where they sit unused until someone clears the link
// or switches to "Build from filters". A setup pinned to the original team's
// id is that team's draw, so on any other team the pin is dropped, and the
// competition and division with it when they are the default's too (left
// alone they would embed the original team's whole age group). Whatever else
// the coach entered is kept. Returns null when there was nothing to drop.
const isLegacy = (setup, key) => String(setup[key] ?? "").trim() === LEGACY_LEAGUE_SETUP[key];
function withoutLegacyIds(setup) {
  if (!isLegacy(setup, "teamId")) return null;
  const out = { ...setup, teamId: "" };
  if (isLegacy(setup, "comp") && isLegacy(setup, "divisionId")) {
    out.comp = "";
    out.divisionId = "";
  }
  return out;
}
const hasText = (v) => typeof v === "string" && v.trim() !== "";

// What a team's league page works from. `saved` says whether the team has a
// setup of its own on its document; `squadi` is that setup, or null when it
// has none. A team with none gets nothing to embed.
//
// The original team is the single exception: it gets LEGACY_LEAGUE_SETUP
// underneath whatever it has saved, exactly what the page did for every team
// before. On every other team the original team's ids are taken out of a
// stored setup as it is read (the next save through /api/league stores it
// clean), and a setup that held nothing but the old default counts as none.
export function leagueSetupFor(doc, { originalTeam = false } = {}) {
  const own = isPlainObject(doc?.squadi) ? doc.squadi : null;
  if (originalTeam) return { squadi: { ...LEGACY_LEAGUE_SETUP, ...(own || {}) }, saved: !!own };
  if (!own) return { squadi: null, saved: false };
  const cleaned = withoutLegacyIds(own);
  if (!cleaned) return { squadi: { ...own }, saved: true };
  if (!hasText(cleaned.url) && !hasText(cleaned.comp)) return { squadi: null, saved: false };
  return { squadi: cleaned, saved: true };
}
