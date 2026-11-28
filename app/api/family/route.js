import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getData } from "@/lib/store";
import { membershipsForEmail, viewingAs } from "@/lib/directory";
import { brisbaneTodayISO } from "@/lib/visibility";
import { familyTeams, familyWeek, FAMILY_DAYS } from "@/lib/familyWeek";
import { withCrestsSafely } from "@/lib/clubLogoStore";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// The combined view for a family on more than one team (My teams, "Coming
// up"): the next fortnight across every team where the signed-in person holds
// the family hat (their children's teams, and their own when they signed in
// as a player), each event with that family's own replies. Read only; a reply
// goes through /api/rsvp, naming its team.
//
// Account mode only, since the family is an email. It is not tied to the
// team_slug or act_as cookies: this is by definition the family's view, so a
// coach who is also a parent gets their children's events here and nothing
// they see as coach. A super admin "viewing as" someone gets that person's
// week, marked read only (the reply route refuses the write regardless).
//
// Only the schedule every parent on the team already sees, and replies for
// the family's own players, leave the server (lib/familyWeek.js).
//
// Response: { todayISO, days, readOnly?, teams: [{ teamSlug, teamName,
// players: [{ id, name, isSelf? }] }], items: [lib/familyWeek familyItems] }
export async function GET(req) {
  if (!AUTH_ON) return NextResponse.json({ error: "The combined view needs account login (set AUTH_SECRET)." }, { status: 400 });
  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const impersonating = viewingAs(req, realEmail);

  const { memberships } = await membershipsForEmail(impersonating || realEmail);
  const teams = familyTeams(memberships);
  // Each game's crest from the club logo library, as the team page has it.
  const docs = await Promise.all(teams.map((t) => Promise.resolve(getData(t.teamSlug)).then(withCrestsSafely).catch(() => null)));
  const todayISO = brisbaneTodayISO();
  return NextResponse.json({
    todayISO, days: FAMILY_DAYS,
    ...(impersonating ? { readOnly: true } : {}),
    teams,
    items: familyWeek(teams, docs, todayISO)
  });
}
