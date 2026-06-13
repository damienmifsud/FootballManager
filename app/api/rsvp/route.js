import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Narrow RSVP endpoint. A parent can set in/out only for their own child;
// a coach can set anyone. Writes just one player's availability entry for one
// game or session — no whole-object overwrite, so concurrent parents can't
// clobber each other and nobody can smuggle in config/score changes.
//
// Body: { kind: "game" | "session", id, occ?, playerId, status, reason? }
//  - kind "game":    id = fixture id
//  - kind "session": id = session id, occ = occurrence ISO date (yyyy-mm-dd)
//  - status: "in" | "out" | null  (null clears the response)
export async function POST(req) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { kind, id, occ, playerId, status, reason } = body || {};

  if (!["game", "session"].includes(kind) || !id || !playerId) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (status !== "in" && status !== "out" && status !== null) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  if (kind === "session" && !occ) {
    return NextResponse.json({ error: "missing occurrence" }, { status: 400 });
  }

  // Which team is this caller acting on? Use their selected team_slug,
  // validated against their memberships (a forged cookie can't reach a team
  // they're not in).
  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const wanted = req.cookies.get("team_slug")?.value;
  const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  const team = teamBySlug(chosen.teamSlug);
  if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });

  const player = (data.players || []).find((p) => p.id === playerId);
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });

  // Permission: coach can mark anyone; a parent only their own child.
  const coach = await isCoachForTeam(email, team.slug);
  const norm = (e) => (e || "").trim().toLowerCase();
  const isOwnChild = (player.parentEmails || []).map(norm).includes(norm(email));
  if (!coach && !isOwnChild) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Build the single entry. Stamp who/when for coach tools + display.
  const label = coach ? "Coach" : (player.name || "Parent");
  const entry = status == null
    ? null
    : { status, ...(status === "out" ? { reason: reason || "Away" } : {}), by: label, at: Date.now() };

  // Merge just this one player's entry into the right availability map.
  let next;
  if (kind === "game") {
    next = {
      ...data,
      fixtures: (data.fixtures || []).map((f) => {
        if (f.id !== id) return f;
        const avail = { ...(f.availability || {}) };
        if (entry == null) delete avail[playerId]; else avail[playerId] = entry;
        return { ...f, availability: avail };
      })
    };
  } else {
    next = {
      ...data,
      sessions: (data.sessions || []).map((s) => {
        if (s.id !== id) return s;
        const dayMap = { ...(s.availability || {}) };
        const day = { ...(dayMap[occ] || {}) };
        if (entry == null) delete day[playerId]; else day[playerId] = entry;
        dayMap[occ] = day;
        return { ...s, availability: dayMap };
      })
    };
  }

  await setData(team.slug, next);
  return NextResponse.json({ ok: true, entry });
}
