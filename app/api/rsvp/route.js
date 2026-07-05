import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam } from "@/lib/directory";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Narrow RSVP endpoint. In account mode a parent can set in/out only for
// their own child and a coach can set anyone. In legacy team-code mode
// everyone with the code is trusted (the original access model: one shared
// code, no roles), and the per-device whoami cookie attributes the response.
// Writes just one player's availability entry for one game or session — no
// whole-object overwrite, so concurrent parents can't clobber each other and
// nobody can smuggle in config/score changes.
//
// Body: { kind: "game" | "session", id, occ?, playerId, status, reason? }
//  - kind "game":    id = fixture id
//  - kind "session": id = session id, occ = occurrence ISO date (yyyy-mm-dd)
//  - status: "in" | "out" | null  (null clears the response)

// Legacy mode: the per-device whoami_<slug> cookie says who is responding.
function whoamiFromCookies(req, slug) {
  const raw = req.cookies.get(`whoami_${slug}`)?.value;
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return null; }
}

export async function POST(req) {
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

  // Which team is this caller acting on? Account mode validates the team_slug
  // cookie against the session's memberships (a forged cookie can't reach a
  // team they're not in); legacy mode maps the team code to its one team.
  let team = null;
  let email = null;
  if (AUTH_ON) {
    const session = await auth();
    email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const wanted = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
    team = await teamBySlug(chosen.teamSlug);
  } else {
    team = await teamFromCookieHeader(req.headers.get("cookie"));
  }
  if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });

  const player = (data.players || []).find((p) => p.id === playerId);
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });

  // Permission + attribution.
  let label;
  if (AUTH_ON) {
    const coach = await isCoachForTeam(email, team.slug);
    const norm = (e) => (e || "").trim().toLowerCase();
    const isOwnChild = (player.parentEmails || []).map(norm).includes(norm(email));
    if (!coach && !isOwnChild) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    label = coach ? "Coach" : (player.name || "Parent");
  } else {
    // Anyone with the code may write; attribute from the device identity:
    // this child's parent, or otherwise the coach.
    const who = whoamiFromCookies(req, team.slug);
    label = who?.kind === "parent" && who.pid === playerId ? (player.name || "Parent") : "Coach";
  }

  // Build the single entry. Stamp who/when for coach tools + display.
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
