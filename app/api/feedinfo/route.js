import { NextResponse } from "next/server";
import { resolveViewer, viewerError } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Returns the calendar feed URL for the logged-in user's team. A read: any
// hat may subscribe (parents, viewers and club admins included). Works in
// both modes: account login resolves the team via lib/viewer (memberships +
// the team_slug cookie; 409 when several teams and none chosen), legacy
// team-code mode via the site_auth cookie.
export async function GET(req) {
  const v = await resolveViewer(req);
  if (v.error) return viewerError(v);
  const team = v.team;
  if (!team.calendarKey) return NextResponse.json({ error: "no calendar key configured for this team" }, { status: 500 });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return NextResponse.json({ feedUrl: `${proto}://${host}/api/calendar?key=${team.calendarKey}` });
}
