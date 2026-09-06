import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam, viewingAs } from "@/lib/directory";
import { sanitizeCoachFields } from "@/lib/teamSetup";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Narrow coach-fields endpoint: writes ONE player's coach-only block (position
// ratings and a private note) and nothing else, so a rating tweak can never
// clobber an RSVP, a game plan or another player's edit that landed moments
// earlier. Account mode restricts writes to coaches/admins; legacy team-code
// mode trusts any code holder (the original one-code-no-roles model — the
// ratings UI itself is coach-gated).
//
// Body: { playerId, ratings?, note? }  — at least one of ratings/note.
//   ratings: { GK, DEF, MID, FWD } each 0-5 or null; note: string <= 400 chars.
// The patch is merged over the player's existing coach block, so a ratings-only
// save keeps the note and a note-only save keeps the ratings.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { playerId, ratings, note } = body || {};
  if (!playerId || (ratings === undefined && note === undefined)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  let team = null;
  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (viewingAs(req, email)) return NextResponse.json({ error: "You're viewing as another user — read only. Exit view-as to make changes." }, { status: 403 });
    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const wanted = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
    team = await teamBySlug(chosen.teamSlug);
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!(await isCoachForTeam(email, team.slug))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });
  const player = (data.players || []).find((p) => p.id === playerId);
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });

  // Merge the patch over what's already there, then run the whole block
  // through the shared guard so stored ratings are always 0-5 or null and the
  // note is always trimmed and capped.
  const existing = player.coach || {};
  const patch = {
    ...existing,
    ...(ratings !== undefined ? { ratings } : {}),
    ...(note !== undefined ? { note } : {})
  };
  const coach = sanitizeCoachFields(patch);

  // Write just this one player's coach block; every other field is preserved.
  const next = {
    ...data,
    players: data.players.map((p) => (p.id === playerId ? { ...p, coach } : p))
  };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true, playerId, coach });
}
