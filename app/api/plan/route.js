import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam } from "@/lib/directory";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Narrow game-plan endpoint: writes ONE fixture's plan (lineup blocks, format
// override, timer) and nothing else, so a mid-game autosave can never clobber
// an RSVP or coach edit that landed moments earlier. Account mode restricts
// writes to coaches/admins; legacy team-code mode trusts any code holder (the
// original one-code-no-roles model — the planner UI itself is coach-gated).
//
// Body: { fixtureId, plan }  — plan: { format?, subTimes, assignments,
//        overrides?, timer?, hintSeen?, updatedAt }
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { fixtureId, plan } = body || {};
  if (!fixtureId || typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (plan.assignments != null && !Array.isArray(plan.assignments)) {
    return NextResponse.json({ error: "bad plan" }, { status: 400 });
  }

  let team = null;
  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const wanted = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
    team = await teamBySlug(chosen.teamSlug);
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!(await isCoachForTeam(email, team.slug))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });
  if (!(data.fixtures || []).some((f) => f.id === fixtureId)) {
    return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  }

  // Merge just this one fixture's plan; every other field is preserved.
  const next = {
    ...data,
    fixtures: data.fixtures.map((f) => (f.id === fixtureId ? { ...f, plan } : f))
  };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true });
}
