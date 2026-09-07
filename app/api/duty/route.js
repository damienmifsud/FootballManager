import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { teamFeatures } from "@/lib/teamSetup";

export const dynamic = "force-dynamic";

// Narrow duty endpoint (S7, D6): writes ONE fixture's fruit / gk / jersey
// duty and nothing else, so a parent's claim can never clobber a score or an
// RSVP, and the whole-document save (lib/protect.js) can never clobber a claim.
//
// Who may write what — the worn hat decides (lib/viewer.js), mirrored in the
// Duties screen:
//   coach hat            any duty, any player, or clear ("")
//   parent hat           fruit and jersey only (never the goalkeeper), only
//                        for a child on that hat, and only when the slot is
//                        empty (a claim) or already holds their own child (a
//                        release, or switching between their own children)
//   viewer / club admin  nothing
//   legacy team-code     anyone with the code (the rsvp/plan trust model)
//
// D4: the in-goal duty and the planner's block-1 keeper are one field. Setting
// gk here also sets plan.assignments[0].GK when the plan already has that
// slot; clearing gk leaves the plan alone (the planner's own write-back
// through /api/plan covers the other direction).
//
// Body: { fixtureId, duty: "fruit" | "gk" | "jersey", playerId }  — "" clears
// Response: { ok: true, fixture: { id, fruit, gk, jersey } }

const DUTY_FEATURE = { fruit: "fruitDuty", gk: "gkDuty", jersey: "jerseyDuty" };

export const GK_COACH_ONLY = "Only coaches can assign the goalkeeper.";
export const OWN_CHILD_ONLY = "You can only claim a duty for your own child.";
export const ALREADY_TAKEN = "That duty is already taken.";

const refuse = (message) => NextResponse.json({ error: message }, { status: 403 });

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { fixtureId, duty, playerId } = body || {};
  if (!fixtureId || typeof fixtureId !== "string" || typeof playerId !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!Object.prototype.hasOwnProperty.call(DUTY_FEATURE, duty)) {
    return NextResponse.json({ error: "bad duty" }, { status: 400 });
  }

  // Who is acting, on which team, wearing which hat. A write: a super admin
  // "viewing as" someone is refused before anything else.
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  const team = v.team;

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });
  const fixture = (data.fixtures || []).find((f) => f.id === fixtureId);
  if (!fixture) return NextResponse.json({ error: "no such fixture" }, { status: 404 });
  if (!teamFeatures(data.team)[DUTY_FEATURE[duty]]) {
    return NextResponse.json({ error: "duty turned off" }, { status: 400 });
  }
  if (playerId && !(data.players || []).some((p) => p.id === playerId)) {
    return NextResponse.json({ error: "no such player" }, { status: 400 });
  }

  // Permission: the worn hat decides.
  if (v.mode === "account") {
    const hat = v.hat || {};
    if (hat.role === "parent") {
      if (duty === "gk") return refuse(GK_COACH_ONLY);
      const own = hat.playerIds || [];
      const current = fixture[duty] || "";
      if (playerId && !own.includes(playerId)) return refuse(OWN_CHILD_ONLY);
      if (current && !own.includes(current)) return refuse(playerId ? ALREADY_TAKEN : OWN_CHILD_ONLY);
    } else if (hat.role !== "coach") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // Merge just this one fixture's duty (and, for a newly set keeper, the
  // plan's block-1 GK slot when the plan already has one); every other field
  // on the fixture and every other record in the document is preserved.
  let saved;
  const next = {
    ...data,
    fixtures: data.fixtures.map((f) => {
      if (f.id !== fixtureId) return f;
      const merged = { ...f, [duty]: playerId };
      const first = Array.isArray(f.plan?.assignments) ? f.plan.assignments[0] : null;
      if (duty === "gk" && playerId && first && typeof first === "object" && !Array.isArray(first) && "GK" in first) {
        merged.plan = { ...f.plan, assignments: f.plan.assignments.map((b, i) => (i === 0 ? { ...b, GK: playerId } : b)) };
      }
      saved = merged;
      return merged;
    })
  };
  await setData(team.slug, next);
  return NextResponse.json({
    ok: true,
    fixture: { id: saved.id, fruit: saved.fruit || "", gk: saved.gk || "", jersey: saved.jersey || "" }
  });
}
