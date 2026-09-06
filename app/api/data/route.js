import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam, viewingAs } from "@/lib/directory";
import { redactForViewer, brisbaneTodayISO } from "@/lib/visibility";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

const READ_ONLY = { error: "You're viewing as another user — read only. Exit view-as to make changes." };

// Resolve who is asking and what they may see: { team, role, playerIds }, or
// null when the request can't be tied to a team member.
// - Account mode (AUTH_SECRET set): the session email must have a membership;
//   the team_slug cookie picks which of their teams, validated against their
//   memberships so a forged cookie can't reach a team they're not in. The role
//   is "coach" for coaches and super admins (isCoachForTeam), "parent" when any
//   of their memberships on this team is a parent one, else "viewer"; playerIds
//   are their children on this team. A super admin who is "viewing as" someone
//   resolves as that person AND gets that person's role — which is exactly how
//   they check what a parent sees.
// - Legacy team-code mode: the site_auth cookie maps to exactly one team. That
//   model has no roles (one shared code for everyone), so the full document is
//   served as it always was — role "coach" — and the "what parents see"
//   switches are UI-only there, like the coach PIN.
async function resolveViewer(req) {
  if (!AUTH_ON) {
    const team = await teamFromCookieHeader(req.headers.get("cookie"));
    return team ? { team, role: "coach", playerIds: [] } : null;
  }
  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) return null;
  const email = viewingAs(req, realEmail) || realEmail;
  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return null;
  const wanted = req.cookies.get("team_slug")?.value;
  const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
  const team = await teamBySlug(chosen.teamSlug);
  if (!team) return null;
  const mine = memberships.filter((m) => m.teamSlug === team.slug);
  const role = (await isCoachForTeam(email, team.slug))
    ? "coach"
    : (mine.some((m) => m.role === "parent") ? "parent" : "viewer");
  const playerIds = mine.map((m) => m.playerId).filter(Boolean);
  return { team, role, playerIds };
}

// READ: any member of the team (account mode) or anyone with the team code
// (legacy mode) can read team data — but what they get back depends on who
// they are. Coaches see the whole document; parents and viewers get it
// redacted server-side by lib/visibility (no rules, no coach ratings or notes,
// plan and match record only as far as the coach's "what parents see"
// switches allow, with game day judged on Brisbane's calendar).
export async function GET(req) {
  const viewer = await resolveViewer(req);
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const doc = await getData(viewer.team.slug);
  if (doc == null) return NextResponse.json(null);
  const { role, playerIds } = viewer;
  return NextResponse.json(redactForViewer(doc, { role, playerIds, todayISO: brisbaneTodayISO() }));
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

  const viewer = await resolveViewer(req);
  if (!viewer) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // viewingAs was refused above, so in account mode the role here is the real
  // signed-in user's (coach iff isCoachForTeam). Legacy mode is always "coach".
  if (AUTH_ON && viewer.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  await setData(viewer.team.slug, body);
  return NextResponse.json({ ok: true });
}
