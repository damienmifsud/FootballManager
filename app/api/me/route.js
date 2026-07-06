import { NextResponse } from "next/server";
import { teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isAdminEmail, viewingAs } from "@/lib/directory";

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
  const realEmail = session?.user?.email;
  if (!realEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Super admins may be "viewing as" someone: resolve everything as that
  // person so the UI renders exactly what they'd see (reads only — every
  // mutating route refuses writes while impersonating).
  const impersonating = viewingAs(req, realEmail);
  const email = impersonating || realEmail;

  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) {
    if (impersonating) {
      // Still tell the admin what's going on rather than a bare 401.
      return NextResponse.json({ mode: "account", email, viewingAs: impersonating, realAdmin: true, admin: false, role: null, memberships: [] });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const wanted = req.cookies.get("team_slug")?.value;
  const current = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  return NextResponse.json({
    mode: "account",
    email,
    admin: !impersonating && isAdminEmail(realEmail),
    ...(impersonating ? { viewingAs: impersonating, realAdmin: true } : {}),
    teamSlug: current.teamSlug,
    role: current.role,
    memberships: memberships.map(({ teamSlug, teamName, role, playerId, playerName }) => ({ teamSlug, teamName, role, playerId, playerName }))
  });
}
