import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, viewingAs } from "@/lib/directory";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { hatsFor, teamsFor, hasChoice } from "@/lib/hats";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Who am I, and what am I allowed to do here? Lets the dashboard show the
// right controls (coach toggle for coaches/admins, read-only for parents,
// viewers and club admins) instead of guessing client-side. The server still
// enforces every write regardless of what the client renders.
//
// Hats: one login can hold several roles on one team — a coach whose child
// plays there is coach AND parent. `role`, `playerIds` and `playerNames`
// describe the hat currently WORN (chosen by the act_as cookie, validated by
// lib/viewer so it can only narrow, never widen); `hats` lists every hat held
// on this team, strongest first; `teams` lists every team with the hats held
// there; `canSwitch` says whether there is any choice at all (more than one
// team, or more than one hat on some team), so the header knows whether to
// render the switcher. `memberships` stays as the raw rows for older callers.
export async function GET(req) {
  const v = await resolveViewer(req);

  if (v.mode === "code") {
    return NextResponse.json({ mode: "code", teamSlug: v.team.slug, teamName: v.team.name });
  }

  if (v.error) {
    if (v.error === 401 && AUTH_ON) {
      // Two "no memberships" cases deserve a 200 with an explanation rather
      // than a bare 401: a super admin viewing as someone with no teams, and a
      // super admin in an empty club (page.jsx offers "create your first team").
      const session = await auth();
      const realEmail = session?.user?.email;
      if (realEmail) {
        const impersonating = viewingAs(req, realEmail);
        const email = impersonating || realEmail;
        const empty = { role: null, teamSlug: null, teamName: null, hats: [], teams: [], memberships: [], canSwitch: false, clubAdmin: false };
        if (impersonating) {
          return NextResponse.json({ mode: "account", email, viewingAs: impersonating, realAdmin: true, admin: false, ...empty });
        }
        if (isAdminEmail(realEmail)) {
          return NextResponse.json({ mode: "account", email, admin: true, ...empty });
        }
      }
    }
    return viewerError(v);
  }

  const { email, realEmail, impersonating, team, memberships, hat } = v;
  return NextResponse.json({
    mode: "account",
    email,
    admin: !impersonating && isAdminEmail(realEmail),
    clubAdmin: memberships.some((m) => !!m.clubAdmin),
    ...(impersonating ? { viewingAs: impersonating, realAdmin: true } : {}),
    teamSlug: team.slug,
    teamName: team.name,
    role: hat.role,
    playerIds: hat.playerIds,
    playerNames: hat.playerNames,
    ...(hat.staffRole ? { staffRole: hat.staffRole } : {}),
    hats: hatsFor(memberships, team.slug),
    teams: teamsFor(memberships),
    canSwitch: hasChoice(memberships),
    memberships: memberships.map(({ teamSlug, teamName, role, playerId, playerName, staffRole }) => (
      { teamSlug, teamName, role, playerId, playerName, ...(staffRole ? { staffRole } : {}) }
    ))
  });
}
