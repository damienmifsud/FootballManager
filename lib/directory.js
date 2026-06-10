// Parent directory: resolves a login email to the teams + children that email
// is attached to, across ALL teams. This is the heart of the parent-centric
// login — identity is the email, the parent↔child link lives in the data, so
// there's no "pick your kid" step. Used by both magic-link and Google login.
import { getTeams } from "@/lib/teams";
import { getData } from "@/lib/store";

const norm = (e) => (e || "").trim().toLowerCase();

// Superusers get coach access to EVERY team automatically — including teams
// added later — without being listed on each team's coachEmails.
// Set ADMIN_EMAILS="manager@dam.fund" (comma-separated for more) in the env.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(norm(email));

// Returns { email, memberships: [{ teamSlug, teamName, role, playerId, playerName }] }
// role is "parent" (matched a player's parentEmails) or "coach" (listed on the
// team config's coachEmails, OR a superuser). A parent with kids in several teams
// gets several memberships; the UI shows them as a "Your teams" list.
export async function membershipsForEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return { email, memberships: [] };
  const admin = ADMIN_EMAILS.includes(email);
  const memberships = [];

  for (const team of getTeams()) {
    // Coaches/managers via coachEmails — or any team at all for a superuser.
    const coachEmails = (team.coachEmails || []).map(norm);
    if (admin || coachEmails.includes(email)) {
      memberships.push({ teamSlug: team.slug, teamName: team.name, role: "coach", admin: admin || undefined });
    }

    const data = await getData(team.slug);
    if (!data || !Array.isArray(data.players)) continue;
    const alreadyCoach = memberships.some((m) => m.teamSlug === team.slug && m.role === "coach");
    for (const p of data.players) {
      const emails = (p.parentEmails || []).map(norm);
      if (emails.includes(email) && !alreadyCoach) {
        memberships.push({
          teamSlug: team.slug,
          teamName: team.name,
          role: "parent",
          playerId: p.id,
          playerName: p.name
        });
      }
    }
  }
  return { email, memberships };
}

// Does this email have access to this specific team (any role)?
export async function emailCanAccessTeam(email, slug) {
  const { memberships } = await membershipsForEmail(email);
  return memberships.some((m) => m.teamSlug === slug);
}
