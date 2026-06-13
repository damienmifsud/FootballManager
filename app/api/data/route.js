import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Resolve which team this request is allowed to touch, from the auth session.
// The team_slug cookie picks which of the caller's teams; it's validated
// against their memberships so a forged cookie can't reach a team they're
// not in. Returns the team, or null if unauthorised.
async function resolveTeam(req) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return null;
  const wanted = req.cookies.get("team_slug")?.value;
  const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  return teamBySlug(chosen.teamSlug);
}

// READ: any member of the team (parent or coach) can read team data.
export async function GET(req) {
  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json((await getData(t.slug)) ?? null);
}

// WRITE: coach/admin only. Parents change their own child's availability via
// the narrow /api/rsvp route — never the whole team object — so this POST is
// reserved for coach edits (fixtures, squad, league config, etc.).
export async function POST(req) {
  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const session = await auth();
  const email = session?.user?.email;
  if (!(await isCoachForTeam(email, t.slug))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  await setData(t.slug, body);
  return NextResponse.json({ ok: true });
}
