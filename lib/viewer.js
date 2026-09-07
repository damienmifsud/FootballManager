// One resolver for every API route: who is asking, on which team, wearing
// which hat. Replaces the copy-pasted "session → memberships → team_slug →
// memberships[0]" block that used to live in each route, and fixes what that
// block got wrong: an unknown team cookie now asks the caller to pick a team
// (409) instead of quietly serving their first team, and the chosen hat (the
// act_as cookie, set by the team picker or the header switcher) decides the
// role — so a coach who is also a parent can act as the parent for a session,
// and gets exactly the parent's reads and writes.
//
// Result shape:
//   { mode: "account", email, realEmail, impersonating, team, memberships, hat }
//   { mode: "code",    team, hat: { role: "coach", playerIds: [], playerNames: [] } }   // legacy team-code mode: no roles
//   { error: 401 | 403 | 409, message }
// hat is from lib/hats.js: { role, playerIds, playerNames, staffRole?, admin?, clubAdmin? }.
// Pass { write: true } for mutating routes: a super admin "viewing as" someone
// is refused (403) before anything else, keeping impersonation read-only.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { membershipsForEmail, viewingAs } from "@/lib/directory";
import { pickHat, teamsFor } from "@/lib/hats";

const AUTH_ON = !!process.env.AUTH_SECRET;

export const READ_ONLY_MESSAGE = "You're viewing as another user — read only. Exit view-as to make changes.";
export const PICK_TEAM_MESSAGE = "Pick a team first.";

export async function resolveViewer(req, { write = false } = {}) {
  if (!AUTH_ON) {
    const team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return { error: 401, message: "unauthorized" };
    return { mode: "code", team, hat: { role: "coach", playerIds: [], playerNames: [] }, memberships: [], email: null, realEmail: null, impersonating: null };
  }

  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) return { error: 401, message: "unauthorized" };
  const impersonating = viewingAs(req, realEmail);
  if (write && impersonating) return { error: 403, message: READ_ONLY_MESSAGE };
  const email = impersonating || realEmail;

  const { memberships } = await membershipsForEmail(email);
  if (!memberships.length) return { error: 401, message: "unauthorized" };

  const slugs = teamsFor(memberships).map((t) => t.teamSlug);
  const wanted = req.cookies.get("team_slug")?.value;
  const slug = slugs.includes(wanted) ? wanted : (slugs.length === 1 ? slugs[0] : null);
  if (!slug) return { error: 409, message: PICK_TEAM_MESSAGE };

  const team = await teamBySlug(slug);
  if (!team) return { error: 401, message: "unauthorized" };

  const hat = pickHat(memberships, slug, req.cookies.get("act_as")?.value);
  // The directory always emits a recognised role, so this is belt-and-braces:
  // a membership list that gives no hat on the chosen team is no access.
  if (!hat) return { error: 401, message: "unauthorized" };
  return { mode: "account", email, realEmail, impersonating, team, memberships, hat };
}

// The JSON error response for a failed resolve.
export function viewerError(v) {
  return NextResponse.json({ error: v.message }, { status: v.error });
}

// Convenience: is this viewer allowed to make coach-level changes?
export const isCoachHat = (v) => !!v && !v.error && v.hat?.role === "coach";
