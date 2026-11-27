// Looking a pasted Squadi fixtures link up on Squadi.
//
// The link names the competition by its key (a UUID) and the sync asks for the
// competition by its number, which the link does not carry. Squadi's public
// list of a competition's divisions has both: each division says which
// competition number it belongs to. So one request turns the link into the
// three ids the sync has always used (competitionId, divisionId, teamId), and a
// second reads the team's draw to say what was found: the competition, the
// division, the team as Squadi names it and how many games are published.
// The wizard shows that back before anything is saved, so a link for the wrong
// team is seen for what it is.
//
// Every request goes to api.squadi.com, built from pieces lib/feedLinks.js has
// already checked (a key that looks like a key, ids that are digits). The
// pasted address itself is never requested.
//
// Both endpoints are undocumented, like the one the sync uses, so everything
// here fails closed: a response that is not the expected shape is an error
// said in words, never a guess.

import { parseFeedLink, NOT_A_FEED_LINK } from "@/lib/feedLinks";
import { apiUrl } from "@/lib/squadiSync";

const TIMEOUT_MS = 10000;
const divisionsUrl = (competitionKey) => `https://api.squadi.com/livescores/division?competitionKey=${competitionKey}`;

export const SQUADI_UNKNOWN_COMPETITION = "Squadi did not recognise the competition in that link. Check it is your team's fixtures page, copy the address again and paste it here.";
export const SQUADI_UNKNOWN_DIVISION = "Squadi does not list that division in that competition. Copy the address again from your team's fixtures page.";
export const SQUADI_UNREACHABLE = "Squadi could not be reached just now. Try again in a minute.";

const text = (v) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

// From Squadi's list of a competition's divisions: the competition's number,
// and the names to show back. { competitionId, competition, division } or
// { error }.
export function competitionFromDivisions(divisions, divisionId) {
  if (!Array.isArray(divisions) || divisions.length === 0) return { error: SQUADI_UNKNOWN_COMPETITION };
  const d = divisions.find((x) => x && typeof x === "object" && String(x.id) === String(divisionId));
  if (!d) return { error: SQUADI_UNKNOWN_DIVISION };
  // The division says which competition it is in, and so does the competition
  // it carries. One is enough; two that disagree are not an answer to trust.
  const own = d.competitionId, nested = d.competition?.id;
  if (own != null && nested != null && String(own) !== String(nested)) return { error: SQUADI_UNKNOWN_COMPETITION };
  const competitionId = String(own ?? nested ?? "");
  if (!/^\d{1,12}$/.test(competitionId) || !Number(competitionId)) return { error: SQUADI_UNKNOWN_COMPETITION };
  return { competitionId, competition: text(d.competition?.longName) || text(d.competition?.name), division: text(d.name) || text(d.divisionName) };
}

// From the team's draw: its name as Squadi writes it, and how many games it
// has (byes are not games). A draw that is not out yet has none and no name.
// Null when the response is not a draw at all.
export function describeDraw(json, teamId) {
  if (!json || !Array.isArray(json.rounds)) return null;
  const id = Number(teamId);
  let team = "", games = 0;
  for (const r of json.rounds) {
    for (const m of Array.isArray(r?.matches) ? r.matches : []) {
      if (!m || !m.team1 || !m.team2) continue;
      const us = Number(m.team1.id) === id ? m.team1 : Number(m.team2.id) === id ? m.team2 : null;
      if (!us) continue;
      if (!team) team = text(us.name);
      if (m.team1.name !== "Bye" && m.team2.name !== "Bye") games++;
    }
  }
  return { team, games };
}

async function getJson(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { return { unreachable: true }; }
  if (!res.ok) return { status: res.status };
  try { return { json: await res.json() }; } catch { return { status: res.status }; }
}

// Look a pasted link up. Returns
//   { provider: "squadi", link, squadi: { competitionId, divisionId, teamId },
//     found: { competition, division, team, games } }
// or { error } with a sentence to show. `games` is null when the draw could
// not be read just now (the ids still stand: they came from the first request).
export async function lookupSquadiLink(raw, fetchImpl = fetch) {
  const parsed = parseFeedLink(raw);
  if (parsed.error) return { error: parsed.error };
  if (parsed.provider !== "squadi") return { error: NOT_A_FEED_LINK };

  const divisions = await getJson(divisionsUrl(parsed.competitionKey), fetchImpl);
  if (divisions.unreachable) return { error: SQUADI_UNREACHABLE };
  // Squadi answers an unknown key with an error status rather than an empty list.
  if (!divisions.json) return { error: SQUADI_UNKNOWN_COMPETITION };
  const comp = competitionFromDivisions(divisions.json, parsed.divisionId);
  if (comp.error) return { error: comp.error };

  const squadi = { competitionId: comp.competitionId, divisionId: parsed.divisionId, teamId: Number(parsed.teamId) };
  const draw = await getJson(apiUrl(squadi), fetchImpl);
  const seen = draw.json ? describeDraw(draw.json, squadi.teamId) : null;
  return {
    provider: "squadi", link: parsed.link, squadi,
    found: { competition: comp.competition, division: comp.division, team: seen ? seen.team : "", games: seen ? seen.games : null }
  };
}
