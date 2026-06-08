import { NextResponse } from "next/server";
import { teamFromCookieHeader } from "@/lib/teams";

export const dynamic = "force-dynamic";

// Returns the calendar feed URL for the logged-in user's team.
export async function GET(req) {
  const team = teamFromCookieHeader(req.headers.get("cookie"));
  if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!team.calendarKey) return NextResponse.json({ error: "no calendar key configured for this team" }, { status: 500 });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return NextResponse.json({ feedUrl: `${proto}://${host}/api/calendar?key=${team.calendarKey}` });
}
