// A team's fixtures link: the address of its draw on the competition's own
// site, pasted into a draw's website link in the team wizard. Two sites are
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
// link carries the filters of the fixtures request the sync fetches; the one
// thing it does not carry, which match centre it is, is asked of Dribl by the
// browser (lib/driblLink.js).
//
// The link itself is kept as the draw's website link (lib/competitions.js
// websiteLink), which takes any https address. What is returned here is only
// ever built from checked pieces: an https link on squadi.com or dribl.com
// with no credentials or port, keys that look like keys and ids that are
// digits. Requests are made with those pieces, never with the pasted address.
//
// Pure: no store, no Next imports, safe in the browser (the wizard reads a
// link as it is pasted) and on the server.

import { MAJESTRI_HOST, parseMajestriLink } from "@/lib/majestriDraw";

const URL_MAX = 1000; // a website link's own limit (lib/competitions.js LINK_MAX)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d{1,12}$/;
const HASH = /^[A-Za-z0-9]{4,24}$/; // Dribl's ids: short letter-and-digit strings
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/; // "Australia/Brisbane"
const SQUADI_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*squadi\.com$/;
// A match centre is a competition's own subdomain. Dribl's API host is not a
// page: its fixtures request has a field of its own in the wizard.
const DRIBL_HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+dribl\.com$/;
const DRIBL_API_HOST = "mc-api.dribl.com";

export const NOT_A_FEED_LINK = "That is not a Squadi, Dribl or Majestri link. Open your team's fixtures page there, copy its address and paste it here.";
export const SQUADI_NEEDS_TEAM = "That Squadi link does not name one team. On the Squadi fixtures page choose the competition, the division and your team, then copy the address again.";
export const DRIBL_NEEDS_COMPETITION = "That Dribl link does not name a competition. On the Dribl fixtures page choose the season, competition, league and club, then copy the address again.";

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

// Which site a link is a page of: "squadi", "dribl" or "" (neither, or not a
// link at all). A draw's website link can be any https address; these two are
// the ones a draw can be set up from.
export function feedProvider(raw) {
  const u = httpsUrl(raw);
  if (!u) return "";
  if (SQUADI_HOST.test(u.hostname)) return "squadi";
  if (MAJESTRI_HOST.test(u.hostname)) return "majestri";
  return DRIBL_HOST.test(u.hostname) && u.hostname !== DRIBL_API_HOST ? "dribl" : "";
}

// Read a pasted link. Returns one of:
//   { provider: "squadi", link, competitionKey, divisionId, teamId, organisationKey, yearId }
//   { provider: "dribl", link, host, site, season, competition, league, club, timezone }
//   { error }  a sentence the wizard shows as it is
// Missing optional pieces are "". A Squadi link must name the competition, the
// division and one team, because that is what a sync needs; a Dribl link must
// name at least a competition, a league or a club. `host` is the match
// centre's own address (winterleague.dribl.com) and `site` its first part.
export function parseFeedLink(raw) {
  const u = httpsUrl(raw);
  const provider = u ? feedProvider(u.href) : "";
  // A competition on a club's Majestri site (lib/majestriDraw.js).
  if (provider === "majestri") return parseMajestriLink(u.href);
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
    return { provider, link: u.href, host: u.hostname, site: u.hostname.split(".")[0], ...ids, timezone: param(u, "timezone", ZONE) };
  }
  return { error: NOT_A_FEED_LINK };
}
