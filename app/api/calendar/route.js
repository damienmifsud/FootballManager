import { getData } from "@/lib/store";
import { seasonICS } from "@/lib/ics";
import { teamByCalendarKey } from "@/lib/teams";

export const dynamic = "force-dynamic";

// Subscribable feed. Each team has its own key, so the key in the URL both
// authorizes the request and selects the team:
//   https://YOUR-DOMAIN/api/calendar?key=TEAM_CALENDAR_KEY
export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  const team = teamByCalendarKey(key);
  if (!team) return new Response("Forbidden", { status: 403 });

  const data = await getData(team.slug);
  const ics = data ? seasonICS(data) : "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FQ Team Dashboard//EN\r\nEND:VCALENDAR";
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="team-2026.ics"',
      "Cache-Control": "public, max-age=300, s-maxage=300"
    }
  });
}
