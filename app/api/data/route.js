import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { teamFromCookieHeader, teamBySlug } from "@/lib/teams";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Resolve which team this request is allowed to touch.
// - Auth mode: session email must have a membership; the team_slug cookie picks
//   which of their teams, validated against memberships (forged cookie can't
//   reach a team you're not in).
// - Legacy mode: the team-code cookie maps to exactly one team.
async function resolveTeam(req) {
  if (AUTH_ON) {
    const { auth } = await import("@/auth");
    const { membershipsForEmail } = await import("@/lib/directory");
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return null;
    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return null;
    const m = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((x) => x.teamSlug === m) || memberships[0];
    return teamBySlug(chosen.teamSlug);
  }
  return teamFromCookieHeader(req.headers.get("cookie"));
}

export async function GET(req) {
  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json((await getData(t.slug)) ?? null);
}

export async function POST(req) {
  const t = await resolveTeam(req);
  if (!t) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  await setData(t.slug, body);
  return NextResponse.json({ ok: true });
}
