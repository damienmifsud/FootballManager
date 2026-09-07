import { NextResponse } from "next/server";
import crypto from "crypto";
import { getStoredTeams, setStoredTeams, getData, setData, deleteData } from "@/lib/store";
import { getTeams, clearTeamsCache } from "@/lib/teams";
import { auth } from "@/auth";
import { isAdminEmail, isClubAdminEmail } from "@/lib/directory";
import { defaultFormatForAgeGroup } from "@/lib/planner";
import { sanitizePlayers } from "@/lib/majestri";
import { sanitizeFeatures, sanitizeTrainingSessions, sanitizeStaff, sanitizeLogo, DEFAULT_FEATURES, sanitizeParentsSee, DEFAULT_PARENTS_SEE } from "@/lib/teamSetup";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;
const norm = (e) => (e || "").trim().toLowerCase();
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

// Team management for the /admin wizard. Super admins and club admins can
// list, create and edit teams; only super admins can delete one. Wizard-created
// teams live in the store (club:teams) and are live immediately — no env
// edits, no restarts. Env-defined teams are listed read-only here (except
// that an edit "takes them over" into the store, which wins on slug).
async function requireAdmin() {
  if (!AUTH_ON) return { error: "Team management needs account login (set AUTH_SECRET).", status: 400 };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "unauthorized", status: 401 };
  if (!isAdminEmail(email)) return { error: "forbidden", status: 403 };
  return { email };
}
async function requireTeamManager() {
  if (!AUTH_ON) return { error: "Team management needs account login (set AUTH_SECRET).", status: 400 };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "unauthorized", status: 401 };
  if (isAdminEmail(email)) return { email };
  if (await isClubAdminEmail(email)) return { email, clubAdmin: true };
  return { error: "forbidden", status: 403 };
}

const slugify = (name) => String(name || "")
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40);

function sanitizeTeam(input, existing = {}) {
  const t = { ...existing };
  if (input.name != null) t.name = String(input.name).trim().slice(0, 80);
  if (input.password != null) t.password = String(input.password).trim();
  if (input.calendarKey != null) t.calendarKey = String(input.calendarKey).trim();
  if (input.ageGroup != null) t.ageGroup = String(input.ageGroup).trim().slice(0, 12);
  if (input.coachEmails != null) {
    t.coachEmails = (Array.isArray(input.coachEmails) ? input.coachEmails : String(input.coachEmails).split(","))
      .map(norm).filter((e) => e.includes("@"));
  }
  if (input.squadi != null) {
    const s = input.squadi || {};
    t.squadi = (s.competitionId || s.divisionId || s.teamId)
      ? { competitionId: String(s.competitionId || "").trim(), divisionId: String(s.divisionId || "").trim(), teamId: Number(s.teamId) || 0 }
      : undefined;
    if (!t.squadi) delete t.squadi;
  }
  return t;
}

// Uniqueness across BOTH sources — the password is the team selector and the
// calendar key is the feed credential, so collisions would cross team lines.
async function clash(field, value, exceptSlug) {
  if (!value) return false;
  return (await getTeams()).some((t) => t.slug !== exceptSlug && t[field] === value);
}

// GET: every team, flagged by source, including codes/keys (admin-only view)
// plus the doc-held fields the wizard can edit (division, WhatsApp, features,
// what parents can see).
export async function GET() {
  const gate = await requireTeamManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
  clearTeamsCache(); // admin view should never be stale
  const teams = await getTeams();
  const enriched = await Promise.all(teams.map(async (t) => {
    const doc = await getData(t.slug).catch(() => null);
    return {
      slug: t.slug, name: t.name, password: t.password, calendarKey: t.calendarKey || "",
      ageGroup: t.ageGroup || "", coachEmails: t.coachEmails || [], squadi: t.squadi || null,
      source: t.stored ? "stored" : (t.legacy ? "legacy" : "env"),
      division: doc?.team?.division || "",
      whatsapp: doc?.team?.whatsapp || "",
      features: { ...DEFAULT_FEATURES, ...(doc?.team?.features || {}) },
      parentsSee: { ...DEFAULT_PARENTS_SEE, ...(doc?.team?.parentsSee || {}) },
      staff: Array.isArray(doc?.team?.staff) ? doc.team.staff.map(({ role, name, mobile, email }) => ({ role, name, mobile, email })) : [],
      coachPin: doc?.team?.coachPin || "",
      hasLogo: !!doc?.team?.logo, // the data URL itself is too heavy for the list
      hasData: !!doc
    };
  }));
  return NextResponse.json({ teams: enriched });
}

// POST: create a team. Auto-derives slug from the name and generates the
// calendar key when omitted; seeds a clean starter document (name, age group,
// match-format default) so the team opens ready to use rather than as sample
// data.
export async function POST(req) {
  const gate = await requireTeamManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "team name is required" }, { status: 400 });
  const slug = body?.slug ? String(body.slug).trim() : slugify(name);
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: "bad slug (lowercase letters, numbers, dashes)" }, { status: 400 });
  const password = String(body?.password || "").trim();
  if (password.length < 4) return NextResponse.json({ error: "team code must be at least 4 characters" }, { status: 400 });

  clearTeamsCache();
  if ((await getTeams()).some((t) => t.slug === slug)) return NextResponse.json({ error: `a team with slug "${slug}" already exists` }, { status: 409 });
  if (await clash("password", password)) return NextResponse.json({ error: "that team code is already used by another team — codes must be unique" }, { status: 409 });

  const team = sanitizeTeam({ ...body, name, password }, { slug });
  if (!team.calendarKey) team.calendarKey = crypto.randomBytes(16).toString("hex");
  else if (await clash("calendarKey", team.calendarKey)) return NextResponse.json({ error: "calendar key already in use" }, { status: 409 });

  const stored = (await getStoredTeams()) || [];
  await setStoredTeams([...stored, team]);
  clearTeamsCache();

  // Starter document (only if this slug has never held data): the imported
  // Majestri roster (players + parents' names/emails/mobiles, so parent login
  // and RSVPs work from day one), the weekly training schedule (flows into
  // the calendar tab and every subscribed calendar via the ICS feed, just
  // like Squadi-synced games), the team's feature flags and what parents can
  // see of match day (defaults when omitted).
  const players = sanitizePlayers(body.players);
  const sessions = sanitizeTrainingSessions(body.training);
  let seeded = 0;
  if (!(await getData(slug))) {
    await setData(slug, {
      team: {
        name: team.name, ageGroup: team.ageGroup || "",
        division: String(body.division || "").trim().slice(0, 80),
        whatsapp: String(body.whatsapp || "").trim().slice(0, 200),
        coachPin: String(body.coachPin || "").trim().slice(0, 12),
        logo: sanitizeLogo(body.logo),
        staff: sanitizeStaff(body.staff),
        matchFormat: defaultFormatForAgeGroup(team.ageGroup),
        features: sanitizeFeatures(body.features),
        parentsSee: sanitizeParentsSee(body.parentsSee)
      },
      players, fixtures: [], sessions
    });
    seeded = players.length;
  }

  return NextResponse.json({ ok: true, team, playersImported: seeded, trainingSeeded: sessions.length });
}

// PATCH: edit a team. Stored teams edit in place; editing an env-defined team
// "takes it over" into the store (stored wins on slug), so coach emails or a
// rotated code no longer need an env change + restart. Slug is immutable.
export async function PATCH(req) {
  const gate = await requireTeamManager();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const slug = String(body?.slug || "").trim();
  clearTeamsCache();
  const current = (await getTeams()).find((t) => t.slug === slug);
  if (!current) return NextResponse.json({ error: "no such team" }, { status: 404 });

  if (body.password != null && String(body.password).trim().length < 4) {
    return NextResponse.json({ error: "team code must be at least 4 characters" }, { status: 400 });
  }
  if (body.password != null && (await clash("password", String(body.password).trim(), slug))) {
    return NextResponse.json({ error: "that team code is already used by another team" }, { status: 409 });
  }
  if (body.calendarKey != null && (await clash("calendarKey", String(body.calendarKey).trim(), slug))) {
    return NextResponse.json({ error: "calendar key already in use" }, { status: 409 });
  }

  const { stored: _s, legacy: _l, ...base } = current;
  const next = sanitizeTeam(body, { ...base, slug });
  if (!next.name || !next.password) return NextResponse.json({ error: "name and team code can't be empty" }, { status: 400 });
  // Rotate the calendar feed credential (e.g. after a leaked subscribe URL):
  // every existing subscription goes dead until re-subscribed with the new link.
  if (body.rotateCalendarKey === true) next.calendarKey = crypto.randomBytes(16).toString("hex");

  const stored = (await getStoredTeams()) || [];
  const i = stored.findIndex((t) => t && t.slug === slug);
  const list = i === -1 ? [...stored, next] : stored.map((t, k) => (k === i ? next : t));
  await setStoredTeams(list);
  clearTeamsCache();

  // Doc-held fields (shown throughout the dashboard) update in place too.
  let docUpdated = false;
  if (body.division != null || body.whatsapp != null || body.features != null || body.parentsSee != null ||
      body.name != null || body.logo != null || body.staff != null || body.coachPin != null) {
    const doc = await getData(slug);
    if (doc) {
      const teamDoc = { ...(doc.team || {}) };
      if (body.name != null) teamDoc.name = next.name;
      if (body.division != null) teamDoc.division = String(body.division).trim().slice(0, 80);
      if (body.whatsapp != null) teamDoc.whatsapp = String(body.whatsapp).trim().slice(0, 200);
      if (body.features != null) teamDoc.features = sanitizeFeatures(body.features);
      if (body.parentsSee != null) teamDoc.parentsSee = sanitizeParentsSee(body.parentsSee);
      if (body.logo != null) { const l = sanitizeLogo(body.logo); if (l) teamDoc.logo = l; }
      if (body.staff != null) {
        // Staff is replaced wholesale, but for rows kept by name we preserve
        // (a) photos added in the dashboard and (b) the stored email when the
        // incoming row carries no email key at all — an older client that never
        // collected emails must not wipe someone's coach-level login. A row
        // that explicitly sends email: "" does clear it.
        const prev = Array.isArray(teamDoc.staff) ? teamDoc.staff : [];
        const prevByName = (name) => prev.find((p) => p.name === String(name || "").trim().slice(0, 80));
        const incoming = (Array.isArray(body.staff) ? body.staff : []).map((s) => {
          if (!s || typeof s !== "object" || s.email !== undefined) return s;
          const kept = prevByName(s.name)?.email;
          return kept ? { ...s, email: kept } : s;
        });
        teamDoc.staff = sanitizeStaff(incoming).map((s) => ({
          ...s, photo: prevByName(s.name)?.photo || ""
        }));
      }
      if (body.coachPin != null) teamDoc.coachPin = String(body.coachPin).trim().slice(0, 12);
      await setData(slug, { ...doc, team: teamDoc });
      docUpdated = true;
    }
  }

  return NextResponse.json({ ok: true, team: next, tookOver: i === -1 && !current.stored, docUpdated });
}

// DELETE: remove a wizard-created team's registration. The team's data
// document is left in the store, so re-adding the same slug restores it.
// Env-defined teams can't be deleted here (remove them from the env).
export async function DELETE(req) {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const slug = String(body?.slug || "").trim();
  const stored = (await getStoredTeams()) || [];
  if (!stored.some((t) => t && t.slug === slug)) {
    return NextResponse.json({ error: "not a wizard-created team (env teams are removed via the TEAMS env var)" }, { status: 400 });
  }
  await setStoredTeams(stored.filter((t) => t && t.slug !== slug));
  clearTeamsCache();
  // purgeData: also wipe the team's document, so re-creating the slug seeds
  // a fresh starter document instead of restoring whatever was stored.
  if (body?.purgeData === true) await deleteData(slug);
  return NextResponse.json({ ok: true, purged: body?.purgeData === true });
}
