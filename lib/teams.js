// Multi-team registry. Teams are defined in the TEAMS env var as JSON:
//
// TEAMS=[{"slug":"kangaroos-white","name":"Olympic FC U8 Kangaroos White",
//         "password":"team-code-here","calendarKey":"random-hex",
//         "squadi":{"competitionId":"1439","divisionId":"10661","teamId":110013}}]
//
// Each password doubles as the team selector, so passwords MUST be unique
// across teams. If TEAMS is not set, the legacy single-team env vars
// (SITE_PASSWORD / CALENDAR_KEY / SQUADI_*) are used — existing deployments
// keep working unchanged.

export function getTeams() {
  if (process.env.TEAMS) {
    try {
      const teams = JSON.parse(process.env.TEAMS);
      if (Array.isArray(teams) && teams.length) {
        return teams.filter((t) => t && t.slug && t.password);
      }
    } catch (e) {
      console.error("TEAMS env var is not valid JSON:", e.message);
    }
  }
  // Legacy single-team mode
  if (!process.env.SITE_PASSWORD) return [];
  return [{
    slug: "default",
    name: "Team",
    password: process.env.SITE_PASSWORD,
    calendarKey: process.env.CALENDAR_KEY || "",
    squadi: {
      competitionId: process.env.SQUADI_COMPETITION_ID || "1439",
      divisionId: process.env.SQUADI_DIVISION_ID || "10661",
      teamId: Number(process.env.SQUADI_TEAM_ID || "110013")
    },
    legacy: true
  }];
}

export const teamByPassword = (pw) => (pw ? getTeams().find((t) => t.password === pw) || null : null);
export const teamByCalendarKey = (key) => (key ? getTeams().find((t) => t.calendarKey && t.calendarKey === key) || null : null);
export const teamBySlug = (slug) => (slug ? getTeams().find((t) => t.slug === slug) || null : null);

// The auth cookie stores the team password (httpOnly); resolve it back to a team.
export function teamFromCookieHeader(cookieHeader) {
  const m = (cookieHeader || "").match(/(?:^|;\s*)site_auth=([^;]+)/);
  if (!m) return null;
  let val = m[1];
  try { val = decodeURIComponent(val); } catch {}
  return teamByPassword(val);
}
