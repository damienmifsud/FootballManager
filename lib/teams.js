// Multi-team registry. Teams come from two places, merged:
//
// 1. The TEAMS env var (JSON array) — the original mechanism; existing
//    deployments keep working unchanged:
//    TEAMS=[{"slug":"kangaroos-white","name":"Olympic FC U8 Kangaroos White",
//            "password":"team-code-here","calendarKey":"random-hex",
//            "squadi":{"competitionId":"1439","divisionId":"10661","teamId":110013}}]
// 2. Teams created live through the /admin wizard, stored club-wide
//    (club:teams) — no env edits or restarts needed. On a slug collision the
//    stored entry wins, so a wizard edit can take over an env-defined team.
//
// Each password doubles as the team selector, so passwords MUST be unique
// across teams. If neither source has teams, the legacy single-team env vars
// (SITE_PASSWORD / CALENDAR_KEY / SQUADI_*) are used.
import { getStoredTeams } from "@/lib/store";

function envTeams() {
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

// Short-lived cache: the registry is consulted several times per request
// (directory loops, lookups) and stored teams live in Redis.
let _cache = { at: 0, teams: null };
const CACHE_MS = 15 * 1000;
export function clearTeamsCache() { _cache = { at: 0, teams: null }; }

export async function getTeams() {
  if (_cache.teams && Date.now() - _cache.at < CACHE_MS) return _cache.teams;
  const env = envTeams();
  let stored = [];
  try { stored = (await getStoredTeams()) || []; } catch { stored = []; }
  stored = (Array.isArray(stored) ? stored : []).filter((t) => t && t.slug && t.password);

  const bySlug = new Map();
  env.forEach((t) => bySlug.set(t.slug, t));
  stored.forEach((t) => bySlug.set(t.slug, { ...t, stored: true }));
  const teams = [...bySlug.values()];
  _cache = { at: Date.now(), teams };
  return teams;
}

export const teamByPassword = async (pw) => (pw ? (await getTeams()).find((t) => t.password === pw) || null : null);
export const teamByCalendarKey = async (key) => (key ? (await getTeams()).find((t) => t.calendarKey && t.calendarKey === key) || null : null);
export const teamBySlug = async (slug) => (slug ? (await getTeams()).find((t) => t.slug === slug) || null : null);

// The auth cookie stores the team password (httpOnly); resolve it back to a team.
export async function teamFromCookieHeader(cookieHeader) {
  const m = (cookieHeader || "").match(/(?:^|;\s*)site_auth=([^;]+)/);
  if (!m) return null;
  let val = m[1];
  try { val = decodeURIComponent(val); } catch {}
  return teamByPassword(val);
}
