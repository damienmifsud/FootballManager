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
// not hold, so one is never derived from the other here.
//
// Pure: no store, no Next imports. /api/league calls these server-side.

const ID_MAX = 64;
const URL_MAX = 2000;

export const NOT_A_SQUADI_LINK = "That is not a Squadi link. It should start with https://registration.squadi.com/";

// The pre-multi-team default. /league used to embed this draw for every team
// that had not saved a setup of its own, which put one team's fixtures on
// every other team's page. It now applies to the legacy owner alone (the one
// team that predates the others: lib/store.js legacyOwnerSlug), so that
// team's page keeps working whether or not anyone there ever pressed save.
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

// A pasted link is only kept when it is an https link on squadi.com or one of
// its subdomains. It becomes an iframe src and a link for every family on the
// team, so nothing else is ever stored. Returns the parsed, normalised form.
function squadiLink(raw) {
  if (raw.length > URL_MAX) return "";
  let u;
  try { u = new URL(raw); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password) return "";
  const host = u.hostname.toLowerCase();
  if (host !== "squadi.com" && !host.endsWith(".squadi.com")) return "";
  return u.href;
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

// What a team's league page works from. `saved` says whether the team has a
// setup of its own on its document; `squadi` is that setup, or null when it
// has none. A team with none gets nothing to embed. The single exception is
// the legacy owner, which gets LEGACY_LEAGUE_SETUP underneath whatever it has
// saved: exactly what the page did for every team before.
export function leagueSetupFor(doc, { legacyOwner = false } = {}) {
  const own = isPlainObject(doc?.squadi) ? doc.squadi : null;
  if (legacyOwner) return { squadi: { ...LEGACY_LEAGUE_SETUP, ...(own || {}) }, saved: !!own };
  return { squadi: own ? { ...own } : null, saved: !!own };
}
