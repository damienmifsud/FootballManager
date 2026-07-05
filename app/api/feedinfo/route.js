import { NextResponse } from "next/server";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Returns the calendar feed URL for the logged-in user's team. Works in both
// modes: account login resolves the team via memberships (any role), legacy
// team-code mode via the site_auth cookie.
export async function GET(req) {
  let team = null;
  if (AUTH_ON) {
    const { auth } = await import("@/auth");
    const { membershipsForEmail } = await import("@/lib/directory");
    const session = await auth();
    const email = session?.user?.email;
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
  if (!team.calendarKey) return NextResponse.json({ error: "no calendar key configured for this team" }, { status: 500 });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return NextResponse.json({ feedUrl: `${proto}://${host}/api/calendar?key=${team.calendarKey}` });
}
