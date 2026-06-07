import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Returns the team calendar feed URL for logged-in users (middleware gates this
// route with the site cookie). Parents need the key to subscribe, so exposing it
// to people who already hold the team code is by design.
export async function GET(req) {
  if (!process.env.CALENDAR_KEY) {
    return NextResponse.json({ error: "CALENDAR_KEY not configured" }, { status: 500 });
  }
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const feedUrl = `${proto}://${host}/api/calendar?key=${process.env.CALENDAR_KEY}`;
  return NextResponse.json({ feedUrl });
}
