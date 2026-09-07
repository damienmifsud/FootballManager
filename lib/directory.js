// Parent directory + role hierarchy: resolves a login email to the teams and
// roles that email holds, across ALL teams. Identity is the email; the
// parent↔child link lives in the data, so there's no "pick your kid" step.
// Used by both magic-link and Google login.
//
// Role ladder (account mode):
//   super admin  — ADMIN_EMAILS env. Full coach access to every team,
//                  including teams added later. Manages access at /admin.
//                  Immune to overrides.
//   coach        — listed on the team config's coachEmails, OR on the team's
//                  staff list with an email (Head coach, Assistant coach,
//                  Manager — the row's title travels with the membership as
//                  staffRole). Edits that team.
//   parent       — matched by the emails on their child's record. Reads the
//                  team; writes only their own child's RSVPs.
//   club admin   — CLUB_ADMIN_EMAILS env or added at /admin. View-only
//                  ("viewer") on every team: reads everything, writes nothing.
//
// One email can hold MORE THAN ONE role on the same team — a coach whose
// child plays in the team is both coach and parent there. Every role is
// emitted as its own membership; lib/hats.js collapses them into "hats" and
// the act_as cookie (validated on every request) says which one a session
// is wearing.
//
// On top of the defaults, the super admin can set a per-email, per-team
// OVERRIDE (stored club-wide, edited at /admin): force "coach" (kids still
// give the parent hat), demote to "parent" (no coach hat) or "viewer" (no
// other hat), or "blocked" (no access to that team at all). This is how a
// parent who coaches Team A is kept to parent-only on Team B.
import { getTeams } from "@/lib/teams";
import { getData, getClubAccess } from "@/lib/store";

const norm = (e) => (e || "").trim().toLowerCase();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(norm(email));

const ENV_CLUB_ADMINS = (process.env.CLUB_ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);

// Roles an override may force. "blocked" removes access to that team.
export const OVERRIDE_ROLES = ["coach", "parent", "viewer", "blocked"];

// "View as": the super admin can browse the site exactly as another user sees
// it. The view_as cookie is only honoured when the REAL session belongs to a
// super admin, and while it's active every mutating route refuses to write —
// impersonation is strictly read-only. Returns the impersonated email, or
// null when not impersonating.
export function viewingAs(req, realEmail) {
  if (!isAdminEmail(realEmail)) return null;
  const raw = req?.cookies?.get?.("view_as")?.value;
  if (!raw) return null;
  let v = raw;
  try { v = decodeURIComponent(raw); } catch {}
  v = norm(v);
  return v.includes("@") ? v : null;
}

// Returns { email, memberships: [{ teamSlug, teamName, role, playerId?, playerName?, staffRole?, admin?, clubAdmin?, overridden? }] }
// role is "coach", "parent" (one membership per matched child) or "viewer".
// The same team can appear with BOTH a coach and parent memberships.
export async function membershipsForEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return { email, memberships: [] };
  const admin = ADMIN_EMAILS.includes(email);

  let access = {};
  try { access = (await getClubAccess()) || {}; } catch { access = {}; }
  const clubAdmin = ENV_CLUB_ADMINS.includes(email) || (access.clubAdmins || []).map(norm).includes(email);
  const myOverrides = (access.overrides || {})[email] || {};

  const memberships = [];

  for (const team of await getTeams()) {
    const ov = admin ? null : myOverrides[team.slug]; // the super admin is immune
    if (ov === "blocked") continue;

    // Default resolution: coach via team config, a staff row with this email,
    // or super admin; parent via the emails on player records; club admins as
    // viewer.
    const coachEmails = (team.coachEmails || []).map(norm);

    const data = await getData(team.slug);
    const players = (data && Array.isArray(data.players)) ? data.players : [];
    const kids = players.filter((p) => (p.parentEmails || []).map(norm).includes(email));
    // A staff row with an email is a coach-level login; its title rides along.
    const staffRows = (data && Array.isArray(data.team?.staff)) ? data.team.staff : [];
    const staffRow = staffRows.find((s) => s && norm(s.email) === email);
    const isCoach = admin || coachEmails.includes(email) || !!staffRow;
    const staffRole = staffRow?.role ? String(staffRow.role).trim().slice(0, 40) : "";

    const base = { teamSlug: team.slug, teamName: team.name };
    const flags = { ...(admin ? { admin: true } : {}), ...(clubAdmin ? { clubAdmin: true } : {}), ...(ov ? { overridden: true } : {}) };

    // Which hats this team gives the email. Overrides narrow or force:
    //   coach  -> coach hat forced; kids still give the parent hat
    //   parent -> no coach hat; parent hat if they have kids here, else viewer
    //   viewer -> viewer only
    const coachHat = ov ? ov === "coach" : isCoach;
    const parentHat = kids.length > 0 && (ov ? ov === "coach" || ov === "parent" : true);

    if (coachHat) memberships.push({ ...base, role: "coach", ...(staffRole ? { staffRole } : {}), ...flags });
    if (parentHat) kids.forEach((p) => memberships.push({ ...base, role: "parent", playerId: p.id, playerName: p.name, ...flags }));
    if (!coachHat && !parentHat && (ov === "viewer" || ov === "parent" || clubAdmin)) {
      memberships.push({ ...base, role: "viewer", ...flags });
    }
  }
  return { email, memberships };
}

// Does this email have access to this specific team (any role, incl. viewer)?
export async function emailCanAccessTeam(email, slug) {
  const { memberships } = await membershipsForEmail(email);
  return memberships.some((m) => m.teamSlug === slug);
}

// Does this email HOLD a coach hat on this team (whatever hat the session is
// wearing)? Routes gate writes on the resolved hat (lib/viewer.js); this is the
// raw capability check, used by /admin and by the view-as guard.
// Super admins are coaches everywhere and can't be demoted by overrides;
// everyone else must resolve to a "coach" membership for this exact slug —
// which an override can grant or revoke without touching the env config.
export async function isCoachForTeam(email, slug) {
  if (isAdminEmail(email)) return true;
  const { memberships } = await membershipsForEmail(email);
  return memberships.some((m) => m.teamSlug === slug && m.role === "coach");
}
