// The combined view for a family on more than one team (My teams, "Coming
// up"): the next fortnight of games, training and events across every team
// where a login holds the family hat, each with that family's own replies.
// Pure: memberships and team documents in, a flat list out. /api/family
// serves it; components/FamilyWeek.jsx shows it.
//
// What it gives away is deliberately small. A team's schedule (opponent,
// date, time, place, round) is what every parent on that team already sees,
// and the only replies listed are for the players this login answers for:
// their children, and themselves when they signed in as a player. Nothing
// else from a team document is passed on.
import { upcomingItems, activeOn, inSquad, roundLabel, sideOf, twinOf, teamSides } from "@/lib/dashboardData";
import { teamsFor } from "@/lib/hats";

// How far ahead the combined view looks: today and the thirteen days after.
export const FAMILY_DAYS = 14;

// The teams a login holds the family hat on, with the players it answers for
// there: [{ teamSlug, teamName, players: [{ id, name, isSelf? }] }]. A team
// where the login is only a coach, or only allowed to look, is not one.
export function familyTeams(memberships) {
  return teamsFor(memberships).map((t) => {
    const hat = t.hats.find((h) => h.role === "parent");
    if (!hat) return null;
    const self = new Set(hat.selfIds || []);
    return {
      teamSlug: t.teamSlug, teamName: t.teamName,
      players: hat.playerIds.map((id, i) => ({ id, name: hat.playerNames[i] || "", ...(self.has(id) ? { isSelf: true } : {}) }))
    };
  }).filter(Boolean);
}

// Does this login have a family on two or more teams? That is who the
// combined view is for.
export const hasFamilyOnSeveralTeams = (memberships) => familyTeams(memberships).length > 1;

// One team's coming events for one family. `team` is a familyTeams() entry,
// `data` that team's document (null: nothing yet). Each item:
//   { teamSlug, teamName, kind: "game" | "session", what, id, occ?, dateISO,
//     time, endTime?, title, place, label, opponent?, homeAway?, cancelled?,
//     paired?, sides?, replies }
// `kind` is how a reply is addressed (/api/rsvp); `what` is the sort of event
// ("game", "training", "event", "carnival"). A game names its `opponent` (for
// the crest beside "vs …") and says whether it is home or away ("H" | "A";
// left out when the fixture does not say, or the two games of a pair differ).
// A paired round's game also lists both games of the round in the team's
// side order, `sides: [{ side, time, place }]`, because one reply covers both
// and the family should see where each is. `replies` has one entry per own
// player who is asked: { playerId, name, isSelf?, status: "in" | "out" | null,
// reason? }. A guest outside their dates is not asked, nor is a player left
// out of a competition's squad, and nobody is asked about a cancelled game.
// A game already played is not coming up, so it is left out.
export function familyItems(team, data, todayISO, days = FAMILY_DAYS) {
  if (!team || !data || typeof data !== "object") return [];
  const doc = { ...data, fixtures: Array.isArray(data.fixtures) ? data.fixtures.filter(Boolean) : [], sessions: Array.isArray(data.sessions) ? data.sessions.filter(Boolean) : [], players: Array.isArray(data.players) ? data.players.filter(Boolean) : [] };
  const own = team.players.map((p) => ({ ...p, record: doc.players.find((x) => x.id === p.id) })).filter((p) => p.record);
  const order = teamSides(doc);
  const items = [];
  for (const it of upcomingItems(doc, todayISO, days)) {
    if (it.kind === "birthday") continue;
    const isGame = it.kind === "game";
    const ref = it.ref;
    if (isGame && ref.status === "played") continue;
    const cancelled = isGame && ref.status === "cancelled";
    const av = (isGame ? ref.availability : ref.availability?.[it.occ]) || {};
    const twin = isGame ? twinOf(doc, ref) : null;
    const asked = cancelled ? [] : own.filter((p) => activeOn(p.record, it.dateISO) && (!isGame || inSquad(doc, ref, p.id)));
    items.push({
      teamSlug: team.teamSlug, teamName: team.teamName,
      kind: isGame ? "game" : "session", what: it.kind, id: ref.id, ...(isGame ? {} : { occ: it.occ }),
      dateISO: it.dateISO, time: it.time || "", ...(!isGame && ref.endTime ? { endTime: ref.endTime } : {}),
      title: String(it.title || "").trim() || (isGame ? "Game" : "Training"),
      place: String((isGame ? ref.venue : ref.location) || "").trim(),
      label: isGame ? [roundLabel(ref), sideOf(doc, ref)].filter(Boolean).join(" · ") : "",
      ...(isGame ? { opponent: String(ref.opponent || "").trim() } : {}),
      // Home or away as the fixture says it; unsaid when the two games of a paired round differ.
      ...(isGame && (ref.homeAway === "H" || ref.homeAway === "A") && (!twin || twin.homeAway === ref.homeAway) ? { homeAway: ref.homeAway } : {}),
      ...(cancelled ? { cancelled: true } : {}),
      // A two-team squad plays two games a round and answers once for both.
      ...(twin ? {
        paired: true,
        sides: [ref, twin].sort((a, b) => order.indexOf(a.side) - order.indexOf(b.side))
          .map((g) => ({ side: String(g.side || ""), time: g.time || "", place: String(g.venue || "").trim() }))
      } : {}),
      replies: asked.map((p) => {
        const entry = av[p.id];
        return {
          playerId: p.id, name: p.name || p.record.name || "", ...(p.isSelf ? { isSelf: true } : {}),
          status: entry?.status === "in" || entry?.status === "out" ? entry.status : null,
          ...(entry?.status === "out" && entry.reason ? { reason: String(entry.reason).slice(0, 80) } : {})
        };
      })
    });
  }
  return items;
}

// Everything, in the order it happens: by date, then time (an event with no
// time set comes first that day), then team name.
export function familyWeek(teams, docs, todayISO, days = FAMILY_DAYS) {
  const items = (teams || []).flatMap((t, i) => familyItems(t, (docs || [])[i], todayISO, days));
  return items.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.time.localeCompare(b.time) || a.teamName.localeCompare(b.teamName) || String(a.id).localeCompare(String(b.id)));
}
