import { NextResponse } from "next/server";
import { teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isAdminEmail } from "@/lib/directory";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Who am I, and what am I allowed to do here? Lets the dashboard show the
// right controls (coach toggle for coaches/admins, read-only for parents,
// viewers and club admins) instead of guessing client-side. The server still
// enforces every write regardless of what the client renders.
export async function GET(req) {
  if (!AUTH_ON) {
    const team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json({ mode: "code", teamSlug: team.slug, teamName: team.name });
  }

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wanted = req.cookies.get("team_slug")?.value;
  const current = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  return NextResponse.json({
    mode: "account",
    email,
    admin: isAdminEmail(email),
    teamSlug: current.teamSlug,
    role: current.role,
    memberships: memberships.map(({ teamSlug, teamName, role, playerId, playerName }) => ({ teamSlug, teamName, role, playerId, playerName }))
  });
}
