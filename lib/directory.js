// Parent directory: resolves a login email to the teams + children that email
// is attached to, across ALL teams. This is the heart of the parent-centric
// login — identity is the email, the parent↔child link lives in the data, so
// there's no "pick your kid" step. Used by both magic-link and Google login.
import { getTeams } from "@/lib/teams";
import { getData } from "@/lib/store";

const norm = (e) => (e || "").trim().toLowerCase();

// Returns { email, memberships: [{ teamSlug, teamName, role, playerId, playerName }] }
// role is "parent" (matched a player's parentEmails) or "coach" (listed on the
// team config's coachEmails). A parent with kids in several teams gets several
// memberships; the UI shows them as a "Your teams" list.
export async function membershipsForEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return { email, memberships: [] };
  const memberships = [];

  for (const team of getTeams()) {
    // Coaches/managers can be granted access via a coachEmails array on the team config.
    const coachEmails = (team.coachEmails || []).map(norm);
    if (coachEmails.includes(email)) {
      memberships.push({ teamSlug: team.slug, teamName: team.name, role: "coach" });
    }

    const data = await getData(team.slug);
    if (!data || !Array.isArray(data.players)) continue;
    for (const p of data.players) {
      const emails = (p.parentEmails || []).map(norm);
      if (emails.includes(email)) {
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
