import { getData } from "@/lib/store";
import { seasonICS } from "@/lib/ics";

export const dynamic = "force-dynamic";

// The subscribable calendar feed. Calendar apps (Google/Outlook) poll this and
// can't send the site-login cookie, so it's protected by an unguessable key in
// the URL instead (same idea as Google's private ICS address). Subscribe URL:
//   https://YOUR-DOMAIN/api/calendar?key=YOUR_CALENDAR_KEY
export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.CALENDAR_KEY || key !== process.env.CALENDAR_KEY) {
    return new Response("Forbidden", { status: 403 });
  }
  const data = await getData();
  const ics = data ? seasonICS(data) : "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FQ Team Dashboard//EN\r\nEND:VCALENDAR";
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="team-2026.ics"',
      "Cache-Control": "public, max-age=300, s-maxage=300"
    }
  });
}
