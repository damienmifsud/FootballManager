// One resolver for every API route: who is asking, on which team, wearing
// which hat. Replaces the copy-pasted "session → memberships → team_slug →
// memberships[0]" block that used to live in each route, and fixes what that
// block got wrong: an unknown team cookie now asks the caller to pick a team
// (409) instead of quietly serving their first team, and the chosen hat (the
// act_as cookie, set by the My teams page or the Viewing-as sheet) decides the
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
//
// Two more options are for a request that says for itself which team it is
// about, instead of leaving that to the team_slug cookie: the combined family
// view on My teams, where one page replies for children in several teams.
//   team: a team slug named by the request. It must be a team this login can
//         open, or the request is refused (403). It is never quietly swapped
//         for another team the way an out-of-date cookie is.
//   as:   the role to act in ("parent" for the family view), whatever the
//         act_as cookie says. The login must hold that hat on that team, or
//         the request is refused (403).
// Neither can widen anything: the team is checked against the same
// memberships, and the hat is one the login already holds there.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { membershipsForEmail, viewingAs } from "@/lib/directory";
import { pickHat, resolveTeamSlug, hatsFor, teamsFor } from "@/lib/hats";

const AUTH_ON = !!process.env.AUTH_SECRET;

export const READ_ONLY_MESSAGE = "You're viewing as another user — read only. Exit view-as to make changes.";
export const PICK_TEAM_MESSAGE = "Pick a team first.";

export async function resolveViewer(req, { write = false, team: named, as } = {}) {
  if (!AUTH_ON) {
    const team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return { error: 401, message: "unauthorized" };
    // Team-code mode has one team per code: a request naming any other is refused.
    if (named !== undefined && named !== team.slug) return { error: 403, message: "forbidden" };
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

  // A team the request names itself must be one this login can open. Without
  // one, the same rule the home page uses (lib/hats.js): the cookie's team if
  // this login can open it, else the one team there is no choice about.
  let slug;
  if (named !== undefined) {
    if (!teamsFor(memberships).some((t) => t.teamSlug === named)) return { error: 403, message: "forbidden" };
    slug = named;
  } else {
    slug = resolveTeamSlug(memberships, req.cookies.get("team_slug")?.value);
    if (!slug) return { error: 409, message: PICK_TEAM_MESSAGE };
  }

  const team = await teamBySlug(slug);
  if (!team) return { error: 401, message: "unauthorized" };

  // A role the request pins must be one held on that team: there is no falling
  // back to a stronger one. Otherwise the act_as cookie chooses among the hats
  // held, and an unknown value falls back to the strongest.
  if (as !== undefined) {
    const pinned = hatsFor(memberships, slug).find((h) => h.role === as);
    if (!pinned) return { error: 403, message: "forbidden" };
    return { mode: "account", email, realEmail, impersonating, team, memberships, hat: pinned };
  }
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
