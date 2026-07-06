import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam, viewingAs } from "@/lib/directory";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

const READ_ONLY = { error: "You're viewing as another user — read only. Exit view-as to make changes." };

// Resolve which team this request is allowed to touch.
// - Account mode (AUTH_SECRET set): the session email must have a membership;
//   the team_slug cookie picks which of their teams, validated against their
//   memberships so a forged cookie can't reach a team they're not in. A super
//   admin who is "viewing as" someone resolves as that person.
// - Legacy team-code mode: the site_auth cookie maps to exactly one team.
async function resolveTeam(req) {
  if (!AUTH_ON) return await teamFromCookieHeader(req.headers.get("cookie"));
  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) return null;
  const email = viewingAs(req, realEmail) || realEmail;
  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return null;
  const wanted = req.cookies.get("team_slug")?.value;
  const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  return await teamBySlug(chosen.teamSlug);
}

// READ: any member of the team (account mode) or anyone with the team code
// (legacy mode) can read team data.
export async function GET(req) {
  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json((await getData(t.slug)) ?? null);
}

// WRITE: coach/admin only in account mode — parents use the narrow /api/rsvp
// route. In legacy team-code mode everyone with the code can edit (the
// original access model: one shared code, no roles). Impersonation is
// strictly read-only: no writes while viewing as someone else.
export async function POST(req) {
  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (viewingAs(req, email)) return NextResponse.json(READ_ONLY, { status: 403 });
  }

  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!(await isCoachForTeam(email, t.slug))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  await setData(t.slug, body);
  return NextResponse.json({ ok: true });
}
