import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { knownCompetitions, sanitizeSquad } from "@/lib/competitions";

export const dynamic = "force-dynamic";

// Narrow endpoint for competition squads: reads and writes ONLY
// data.competitionSquads, the coach's pick of who is in each competition's
// squad (lib/competitions.js).
//
// A team's season is for everyone. Another competition (a winter tournament,
// an invitational league) often takes part of the squad, and only those
// players should be asked to reply and counted for its games. The pick lives
// on the team document as data.competitionSquads[competitionId] =
// [playerId, …]; no entry means everyone. lib/protect.js keeps the
// whole-document save from writing it.
//
// Not the weekly split of one squad between two teams in a round: that is a
// per-game list and has its own route.
//
// GET: any member of the team. Response: { competitions: [{ id, name,
// playerIds }] } — every competition the team has (its registry entry's list,
// plus any that only survive on its games), each with its squad (the picked
// players still on the team) or null for everyone. This is what the picker in
// Team settings lists.
//
// POST: coach hat only in account mode; legacy team-code mode trusts any code
// holder, as the other narrow routes do. A super admin "viewing as" someone is
// refused before anything else.
// Body: { comp, playerIds }  — playerIds: an array of player ids, or null for
// everyone. comp must be one of the team's competitions, so a squad can never
// be written for a competition the team does not have. Ids of players who are
// not on the team are dropped, and a list that leaves nobody is stored as
// everyone.
// Response: { ok: true, comp, playerIds } — exactly what was stored (null for
// everyone).

export const COACH_ONLY = "Only coaches can pick a squad.";
export const NO_SUCH_COMPETITION = "That competition is not one of this team's.";

const isDoc = (d) => !!d && typeof d === "object" && !Array.isArray(d);
const squadsOf = (data) => (isDoc(data?.competitionSquads) ? data.competitionSquads : {});

export async function GET(req) {
  const v = await resolveViewer(req);
  if (v.error) return viewerError(v);
  const data = await getData(v.team.slug);
  const stored = squadsOf(data);
  const competitions = knownCompetitions(v.team, data).map((c) => ({
    ...c,
    playerIds: Array.isArray(stored[c.id]) ? sanitizeSquad(stored[c.id], data?.players) : null
  }));
  return NextResponse.json({ competitions });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const sent = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  // playerIds must be sent, as a list or as null: leaving it out is not a way to say everyone.
  const listOrNull = "playerIds" in sent && (sent.playerIds === null || Array.isArray(sent.playerIds));
  if (typeof sent.comp !== "string" || !sent.comp || !listOrNull) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: COACH_ONLY }, { status: 403 });
  }
  const team = v.team;

  const data = await getData(team.slug);
  if (!isDoc(data)) return NextResponse.json({ error: "no data" }, { status: 404 });
  if (!knownCompetitions(team, data).some((c) => c.id === sent.comp)) {
    return NextResponse.json({ error: NO_SUCH_COMPETITION }, { status: 400 });
  }
  const playerIds = sanitizeSquad(sent.playerIds, data.players);

  // Replace just this one competition's entry; every other squad and the rest
  // of the document are the freshly read copies. Everyone = no entry at all.
  const competitionSquads = { ...squadsOf(data) };
  if (playerIds === null) delete competitionSquads[sent.comp]; else competitionSquads[sent.comp] = playerIds;
  await setData(team.slug, { ...data, competitionSquads });
  return NextResponse.json({ ok: true, comp: sent.comp, playerIds });
}
