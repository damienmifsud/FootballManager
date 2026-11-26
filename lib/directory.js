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
//   player       — matched by the player's OWN email on their own record
//                  (`player.email`, set by a coach in the Squad tab). Exactly
//                  what a parent gets, for that one record: they read the
//                  team and reply for themselves. Meant for adult teams and
//                  older players; a young player's parents reply for them.
//   club admin   — CLUB_ADMIN_EMAILS env or added at /admin. View-only
//                  ("viewer") on every team: reads everything, writes nothing.
//
// One email can hold MORE THAN ONE role on the same team — a coach whose
// child plays in the team is both coach and parent there. Every role is
// emitted as its own membership; lib/hats.js collapses them into "hats" and
// the act_as cookie (validated on every request) says which one a session
// is wearing. A player's own record and their children's records sit under
// the one family hat there, so someone who plays alongside their child
// replies for both without switching.
//
// PERSONAL or CLUB-LEVEL. A membership is personal when the person is on the
// team themselves: a coachEmails entry, a staff row, a child on the roster,
// their own place on the roster, or a role the super admin gave them there. The super admin's coach access
// to a team they hold no role on, and a club admin's view-only access, are
// club-level instead and carry `club: true`. The access is exactly the same
// either way; the flag only decides what is listed as "my teams" (personal)
// and what is reached through club admin (everything else), so someone who
// runs the club is not shown as attached to every team in it.
//
// On top of the defaults, the super admin can set a per-email, per-team
// OVERRIDE (stored club-wide, edited at /admin): force "coach" (kids, and
// their own record, still give the family hat), demote to "parent" (no coach
// hat; a player keeps their own record) or "viewer" (no other hat), or
// "blocked" (no access to that team at all). This is how a
// parent who coaches Team A is kept to parent-only on Team B.
import { getTeams } from "@/lib/teams";
import { getData, getClubAccess } from "@/lib/store";
import { playerFullName } from "@/lib/dashboardData";

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

// The memberships one email holds on one team. Pure: the team's config, its
// document and what the club says about this email are passed in, so one
// login is resolved from a few reads and the whole club (clubPeople, below)
// from a single load. `ov` is the per-team override for this email, already
// cleared for a super admin, who is immune.
function membershipsOnTeam(email, team, data, { admin, clubAdmin, ov }) {
  if (ov === "blocked") return [];
  const memberships = [];

  // Default resolution: coach via team config, a staff row with this email,
  // or super admin; player via their own email on their own record; parent
  // via the emails on player records; club admins as viewer.
  const coachEmails = (team.coachEmails || []).map(norm);
  const players = (data && Array.isArray(data.players)) ? data.players.filter((p) => p && typeof p === "object") : [];
  // The records this email answers for: its own first, then its children's.
  // A record that names the email both ways is the person's own.
  const selves = players.filter((p) => typeof p.email === "string" && !!p.email.trim() && norm(p.email) === email);
  const kids = players.filter((p) => !selves.includes(p) && (Array.isArray(p.parentEmails) ? p.parentEmails : []).map(norm).includes(email));
  const family = [...selves, ...kids];
  // A staff row with an email is a coach-level login; its title rides along.
  const staffRows = (data && Array.isArray(data.team?.staff)) ? data.team.staff : [];
  const staffRow = staffRows.find((s) => s && norm(s.email) === email);
  // Their own coach role here, as opposed to the super admin's access to every team.
  const ownCoach = coachEmails.includes(email) || !!staffRow;
  const isCoach = admin || ownCoach;
  const staffRole = staffRow?.role ? String(staffRow.role).trim().slice(0, 40) : "";

  const base = { teamSlug: team.slug, teamName: team.name };
  const flags = { ...(admin ? { admin: true } : {}), ...(clubAdmin ? { clubAdmin: true } : {}), ...(ov ? { overridden: true } : {}) };

  // Which hats this team gives the email. Overrides narrow or force:
  //   coach  -> coach hat forced; their records still give the family hat
  //   parent -> no coach hat; the family hat if they have a record here
  //             (a child's, or their own), else viewer
  //   viewer -> viewer only
  const coachHat = ov ? ov === "coach" : isCoach;
  const parentHat = family.length > 0 && (ov ? ov === "coach" || ov === "parent" : true);

  // Club-level: the super admin on a team they hold no role on, and a club
  // admin's default view of a team (an override is a role given on purpose).
  if (coachHat) memberships.push({ ...base, role: "coach", ...(staffRole ? { staffRole } : {}), ...(admin && !ownCoach ? { club: true } : {}), ...flags });
  if (parentHat) family.forEach((p) => memberships.push({ ...base, role: selves.includes(p) ? "player" : "parent", playerId: p.id, playerName: p.name, ...flags }));
  if (!coachHat && !parentHat && (ov === "viewer" || ov === "parent" || clubAdmin)) {
    memberships.push({ ...base, role: "viewer", ...(!ov ? { club: true } : {}), ...flags });
  }
  return memberships;
}

const clubAdminsIn = (access) => (access.clubAdmins || []).map(norm);

// Returns { email, memberships: [{ teamSlug, teamName, role, playerId?, playerName?, staffRole?, admin?, clubAdmin?, club?, overridden? }] }
// role is "coach", "player" (the email is that player's own), "parent" (one
// membership per matched child) or "viewer". The same team can appear with a
// coach membership AND player or parent ones.
export async function membershipsForEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return { email, memberships: [] };
  const admin = ADMIN_EMAILS.includes(email);

  let access = {};
  try { access = (await getClubAccess()) || {}; } catch { access = {}; }
  const clubAdmin = ENV_CLUB_ADMINS.includes(email) || clubAdminsIn(access).includes(email);
  const myOverrides = (access.overrides || {})[email] || {};

  const memberships = [];
  for (const team of await getTeams()) {
    const ov = admin ? null : myOverrides[team.slug]; // the super admin is immune
    if (ov === "blocked") continue; // no access: the team's document is not even read
    const data = await getData(team.slug);
    memberships.push(...membershipsOnTeam(email, team, data, { admin, clubAdmin, ov }));
  }
  return { email, memberships };
}

// A name as typed into a registration form, made fit to list: trimmed, and
// given ordinary capitals when it arrived all in capitals or all in lower
// case ("PAT LANE", "pat lane"). A name with any mix of cases is left exactly
// as written, since that is somebody's own spelling ("van Dyk", "McKay").
function tidyName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name || (name !== name.toUpperCase() && name !== name.toLowerCase())) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, lead, letter) => lead + letter.toUpperCase());
}

// Everyone with a login in the club, and what each is attached to: the
// people page in club admin. Every email that appears anywhere (the env
// lists, the access doc, a team's coach list, a staff row, a player's record)
// is resolved with the same rules as a sign-in, from ONE load of the club's
// teams and documents rather than one per person. An email that resolves to
// nothing at all (a guardian's address that is not a login) is left out.
//
// Returns { teams: [{ slug, name }], people: [{ email, name, superAdmin,
// clubAdmin: "env" | "stored" | null, memberships, overrides: { slug: role } }] }
// sorted by name, then email. `name` is the best one the club's own records
// give ("" when none): a staff row's name first, then a guardian's, then the
// player's own name for a player's own email.
export async function clubPeople() {
  const teams = await getTeams();
  let access = {};
  try { access = (await getClubAccess()) || {}; } catch { access = {}; }
  const docs = await Promise.all(teams.map((t) => Promise.resolve(getData(t.slug)).catch(() => null)));

  const names = new Map(); // email -> best name known so far
  const seen = (rawEmail, name = "") => {
    const email = norm(rawEmail);
    if (!email.includes("@")) return;
    const n = tidyName(name);
    if (!names.has(email) || (!names.get(email) && n)) names.set(email, n);
  };
  // Staff first, so a coach who is also a parent goes by the name on the staff list.
  teams.forEach((team, i) => {
    const staff = Array.isArray(docs[i]?.team?.staff) ? docs[i].team.staff : [];
    staff.forEach((s) => s && seen(s.email, s.name));
  });
  teams.forEach((team, i) => {
    (team.coachEmails || []).forEach((e) => seen(e));
    const players = Array.isArray(docs[i]?.players) ? docs[i].players : [];
    for (const p of players) {
      if (!p) continue;
      const guardians = Array.isArray(p.guardians) ? p.guardians.filter(Boolean) : [];
      guardians.forEach((g) => seen(g.email, g.name));
      const emails = Array.isArray(p.parentEmails) ? p.parentEmails : [];
      // Older records name one parent beside one email.
      emails.forEach((e, k) => seen(e, !guardians.length && k === 0 ? p.parentName : ""));
    }
  });
  // A player's own email, by the player's own name. Last, so an address a
  // parent also uses for their child's record keeps the parent's name.
  teams.forEach((team, i) => {
    const players = Array.isArray(docs[i]?.players) ? docs[i].players : [];
    for (const p of players) if (p) seen(p.email, playerFullName(p));
  });
  ADMIN_EMAILS.forEach((e) => seen(e));
  ENV_CLUB_ADMINS.forEach((e) => seen(e));
  clubAdminsIn(access).forEach((e) => seen(e));
  Object.keys(access.overrides || {}).forEach((e) => seen(e));

  const stored = clubAdminsIn(access);
  const people = [];
  for (const [email, name] of names) {
    const admin = ADMIN_EMAILS.includes(email);
    const clubAdmin = ENV_CLUB_ADMINS.includes(email) ? "env" : stored.includes(email) ? "stored" : null;
    // A super admin is immune to overrides, and one left behind for a team that has gone means nothing.
    const overrides = admin ? {} : Object.fromEntries(Object.entries((access.overrides || {})[email] || {}).filter(([slug]) => teams.some((t) => t.slug === slug)));
    const memberships = teams.flatMap((team, i) => membershipsOnTeam(email, team, docs[i], { admin, clubAdmin: !!clubAdmin, ov: overrides[team.slug] }));
    if (!memberships.length && !admin && !clubAdmin && !Object.keys(overrides).length) continue;
    people.push({ email, name, superAdmin: admin, clubAdmin, memberships, overrides });
  }
  const key = (p) => (p.name || p.email).toLowerCase();
  people.sort((a, b) => key(a).localeCompare(key(b)) || a.email.localeCompare(b.email));
  return { teams: teams.map((t) => ({ slug: t.slug, name: t.name })), people };
}

// Is this email a club admin (env list or added at /admin)? Club admins are
// view-only on every team, and may create and edit teams in the wizard.
export async function isClubAdminEmail(rawEmail) {
  const email = norm(rawEmail);
  if (!email) return false;
  if (ENV_CLUB_ADMINS.includes(email)) return true;
  try {
    const access = (await getClubAccess()) || {};
    return (access.clubAdmins || []).map(norm).includes(email);
  } catch { return false; }
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
