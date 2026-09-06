import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam, viewingAs } from "@/lib/directory";
import { sanitizeParentsSee, sanitizeMatchFormat, sanitizeRules } from "@/lib/teamSetup";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Narrow team-settings endpoint: writes ONLY the named team.* fields (what
// parents see, the match format, the match-day rules) and nothing else. The
// coach's settings screen may sit open for a long time; a parent's RSVP (or a
// live plan autosave) that lands between the coach's read and their save must
// survive, so this route re-reads the document, merges just the provided keys
// into data.team and never touches players/fixtures/sessions. A whole-document
// persist() from the settings screen would silently clobber that RSVP.
// Account mode restricts writes to coaches/admins; legacy team-code mode
// trusts any code holder (the original one-code-no-roles model — the settings
// UI itself is coach-gated).
//
// Body: { parentsSee?, matchFormat?, rules? } — at least one key required.
// Response: { ok: true, team: { <only the provided keys, sanitised> } } so the
// client can patch its local state with exactly what was stored.
const SETTING_KEYS = ["parentsSee", "matchFormat", "rules"];

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const provided = SETTING_KEYS.filter((k) => k in body);
  if (!provided.length) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  let team = null;
  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (viewingAs(req, email)) return NextResponse.json({ error: "You're viewing as another user — read only. Exit view-as to make changes." }, { status: 403 });
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

  // Sanitise only what was sent; anything else on data.team is left as-is.
  const patch = {};
  if ("parentsSee" in body) patch.parentsSee = sanitizeParentsSee(body.parentsSee);
  if ("matchFormat" in body) patch.matchFormat = sanitizeMatchFormat(body.matchFormat, data.team?.ageGroup);
  if ("rules" in body) patch.rules = sanitizeRules(body.rules);

  // Merge just these team fields; players, fixtures and sessions are the
  // freshly read copies, so any RSVP that landed meanwhile rides along intact.
  const next = { ...data, team: { ...(data.team || {}), ...patch } };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true, team: patch });
}
