// Parent directory + role hierarchy: resolves a login email to the teams and
// roles that email holds, across ALL teams. Identity is the email; the
// parent↔child link lives in the data, so there's no "pick your kid" step.
// Used by both magic-link and Google login.
//
// Role ladder (account mode):
//   super admin  — ADMIN_EMAILS env. Full coach access to every team,
//                  including teams added later. Manages access at /admin.
//                  Immune to overrides.
//   coach        — listed on the team config's coachEmails. Edits that team.
//   parent       — matched by the emails on their child's record. Reads the
//                  team; writes only their own child's RSVPs.
//   club admin   — CLUB_ADMIN_EMAILS env or added at /admin. View-only
//                  ("viewer") on every team: reads everything, writes nothing.
//
// On top of the defaults, the super admin can set a per-email, per-team
// OVERRIDE (stored club-wide, edited at /admin): force "coach", demote to
// "parent" or "viewer", or "blocked" (no access to that team at all). This is
// how a parent who coaches Team A is kept to parent-only on Team B.
import { getTeams } from "@/lib/teams";
import { getData, getClubAccess } from "@/lib/store";

const norm = (e) => (e || "").trim().toLowerCase();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(norm(email));

const ENV_CLUB_ADMINS = (process.env.CLUB_ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);

// Roles an override may force. "blocked" removes access to that team.
export const OVERRIDE_ROLES = ["coach", "parent", "viewer", "blocked"];

// Returns { email, memberships: [{ teamSlug, teamName, role, playerId?, playerName? }] }
// role is "coach", "parent" (one membership per matched child) or "viewer".
// A coach membership suppresses the duplicate parent one for the same team.
export async function membershipsForEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return { email, memberships: [] };
  const admin = ADMIN_EMAILS.includes(email);

  let access = {};
  try { access = (await getClubAccess()) || {}; } catch { access = {}; }
  const clubAdmin = ENV_CLUB_ADMINS.includes(email) || (access.clubAdmins || []).map(norm).includes(email);
  const myOverrides = (access.overrides || {})[email] || {};

  const memberships = [];

  for (const team of getTeams()) {
    const ov = admin ? null : myOverrides[team.slug]; // the super admin is immune
    if (ov === "blocked") continue;

    // Default resolution: coach via team config (or super admin), parent via
    // the emails on player records, club admins as viewer.
    const coachEmails = (team.coachEmails || []).map(norm);
    const isCoach = admin || coachEmails.includes(email);

    const data = await getData(team.slug);
    const kids = (data && Array.isArray(data.players))
      ? data.players.filter((p) => (p.parentEmails || []).map(norm).includes(email))
      : [];

    const base = { teamSlug: team.slug, teamName: team.name };
    const flags = { ...(admin ? { admin: true } : {}), ...(clubAdmin ? { clubAdmin: true } : {}), ...(ov ? { overridden: true } : {}) };

    const wantsRole = ov || (isCoach ? "coach" : kids.length ? "parent" : clubAdmin ? "viewer" : null);
    if (!wantsRole) continue;

    if (wantsRole === "coach") {
      memberships.push({ ...base, role: "coach", ...flags });
    } else if (wantsRole === "parent") {
      if (kids.length) {
        kids.forEach((p) => memberships.push({ ...base, role: "parent", playerId: p.id, playerName: p.name, ...flags }));
      } else {
        // Forced to "parent" with no child on this roster — view-only.
        memberships.push({ ...base, role: "viewer", ...flags });
      }
    } else {
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

// Is this email a coach/admin for this specific team? Used to gate writes
// (whole-doc edits, game plans, sync) and marking any player's RSVP.
// Super admins are coaches everywhere and can't be demoted by overrides;
// everyone else must resolve to a "coach" membership for this exact slug —
// which an override can grant or revoke without touching the env config.
export async function isCoachForTeam(email, slug) {
  if (isAdminEmail(email)) return true;
  const { memberships } = await membershipsForEmail(email);
  return memberships.some((m) => m.teamSlug === slug && m.role === "coach");
}
