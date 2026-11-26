// A team's fixtures link: the address of its draw on the competition's own
// site, pasted into the team wizard instead of hunting for ids. Two sites are
// known:
//
//   Squadi  https://registration.squadi.com/liveScoreSeasonFixture
//             ?organisationKey=…&yearId=8&competitionUniqueKey=…&divisionId=20001&teamId=300001
//   Dribl   https://winterleague.dribl.com/fixtures
//             ?date_range=all&season=…&competition=…&league=…&club=…&timezone=Australia%2FBrisbane
//
// parseFeedLink reads what a link says and nothing more: which site it is and
// the identifiers in its query. It makes no request. A Squadi link carries the
// division and team ids the sync uses, and the competition's key, which the
// server turns into the competition's number (lib/squadiLookup.js). A Dribl
// link is kept with its identifiers; Dribl does not let other sites read its
// fixtures, so nothing is fetched from it.
//
// What is returned is only ever built from checked pieces: an https link on
// squadi.com or dribl.com with no credentials or port, keys that look like
// keys and ids that are digits. The server calls Squadi with those pieces,
// never with the pasted address itself.
//
// Pure: no store, no Next imports, safe in the browser (the wizard reads a
// link as it is pasted) and on the server.

const URL_MAX = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,12}$/;
const HASH = /^[A-Za-z0-9]{4,24}$/; // Dribl's ids: short letter-and-digit strings
const SQUADI_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*squadi\.com$/;
const DRIBL_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+dribl\.com$/; // always a competition's own subdomain

export const NOT_A_FEED_LINK = "That is not a Squadi or Dribl link. Open your team's fixtures page there, copy its address and paste it here.";
export const SQUADI_NEEDS_TEAM = "That Squadi link does not name one team. On the Squadi fixtures page choose the competition, the division and your team, then copy the address again.";
export const DRIBL_NEEDS_COMPETITION = "That Dribl link does not name a competition. On the Dribl fixtures page choose the season, competition, league and club, then copy the address again.";
// Said wherever a Dribl link is read, so nobody waits for a sync.
export const DRIBL_NOT_SYNCED = "Dribl does not let other sites read its fixtures, so these games cannot be synced. The link is kept with the competition, so its draw is one tap away on the league page.";

// An https link with no credentials or port, or null.
function httpsUrl(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > URL_MAX) return null;
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return u.href.length <= URL_MAX ? u : null;
}
const param = (u, name, shape) => { const v = (u.searchParams.get(name) || "").trim(); return shape.test(v) ? v : ""; };

// Which site a link belongs to: "squadi", "dribl" or "" (neither, or not a
// link we would keep).
export function feedProvider(raw) {
  const u = httpsUrl(raw);
  if (!u) return "";
  return SQUADI_HOST.test(u.hostname) ? "squadi" : DRIBL_HOST.test(u.hostname) ? "dribl" : "";
}

// A link as it is stored: the parsed, normalised address when it is one of
// `provider`'s, else "". The server guard for a link that arrives in a save.
export function storedFeedLink(raw, provider) {
  const u = httpsUrl(raw);
  return u && feedProvider(u.href) === provider ? u.href : "";
}

// Read a pasted link. Returns one of:
//   { provider: "squadi", link, competitionKey, divisionId, teamId, organisationKey, yearId }
//   { provider: "dribl", link, site, season, competition, league, club }
//   { error }  a sentence the wizard shows as it is
// Missing optional pieces are "". A Squadi link must name the competition, the
// division and one team, because that is what a sync needs; a Dribl link must
// name at least a competition, a league or a club.
export function parseFeedLink(raw) {
  const u = httpsUrl(raw);
  const provider = u ? feedProvider(u.href) : "";
  if (provider === "squadi") {
    const competitionKey = param(u, "competitionUniqueKey", UUID).toLowerCase();
    const divisionId = param(u, "divisionId", DIGITS);
    const teamId = param(u, "teamId", DIGITS);
    if (!competitionKey || !divisionId || !teamId || !Number(teamId)) return { error: SQUADI_NEEDS_TEAM };
    return {
      provider, link: u.href, competitionKey, divisionId, teamId,
      organisationKey: param(u, "organisationKey", UUID).toLowerCase(), yearId: param(u, "yearId", DIGITS)
    };
  }
  if (provider === "dribl") {
    const ids = { season: param(u, "season", HASH), competition: param(u, "competition", HASH), league: param(u, "league", HASH), club: param(u, "club", HASH) };
    if (!ids.competition && !ids.league && !ids.club) return { error: DRIBL_NEEDS_COMPETITION };
    return { provider, link: u.href, site: u.hostname.split(".")[0], ...ids };
  }
  return { error: NOT_A_FEED_LINK };
}

// A competition's Dribl draw as the registry keeps it: the link and what it
// names. Null when there is no Dribl link to keep. Rebuilt from the link
// itself, so the identifiers stored can never disagree with it.
export function sanitizeDribl(input) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input.link : input;
  const parsed = parseFeedLink(raw);
  if (parsed.provider !== "dribl") return null;
  const { provider: _p, ...dribl } = parsed;
  return dribl;
}
