import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Narrow game-plan endpoint: writes ONE fixture's plan (lineup blocks, format
// override, timer) and nothing else, so a mid-game autosave can never clobber
// an RSVP or coach edit that landed moments earlier. Account mode restricts
// writes to coaches/admins; legacy team-code mode trusts any code holder (the
// original one-code-no-roles model — the planner UI itself is coach-gated).
//
// The plan's first-block keeper also writes back to the fixture's in-goal duty
// (fixture.gk) in the same merge, so the duty card and the plan always agree.
// gk is optional: absent or unchanged leaves the duty alone; "" clears it.
//
// Body: { fixtureId, plan, gk? }  — plan: { format?, subTimes, assignments,
//        overrides?, timer?, hintSeen?, updatedAt }
//        gk: "" | a player id from this team's roster
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { fixtureId, plan, gk } = body || {};
  if (!fixtureId || typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (plan.assignments != null && !Array.isArray(plan.assignments)) {
    return NextResponse.json({ error: "bad plan" }, { status: 400 });
  }
  if (gk !== undefined && typeof gk !== "string") {
    return NextResponse.json({ error: "bad gk" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const team = v.team;

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });
  if (!(data.fixtures || []).some((f) => f.id === fixtureId)) {
    return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  }
  if (gk && !(data.players || []).some((p) => p.id === gk)) {
    return NextResponse.json({ error: "no such player" }, { status: 400 });
  }

  // Merge just this one fixture's plan (and, when it actually changed, its
  // in-goal duty); every other field is preserved. An unset duty and "" both
  // mean "nobody yet", so sending "" to a fixture with no gk is not a change.
  const next = {
    ...data,
    fixtures: data.fixtures.map((f) => {
      if (f.id !== fixtureId) return f;
      const merged = { ...f, plan };
      if (gk !== undefined && (f.gk ?? "") !== gk) merged.gk = gk;
      return merged;
    })
  };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true });
}
