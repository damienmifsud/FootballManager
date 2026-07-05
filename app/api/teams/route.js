import { NextResponse } from "next/server";
import crypto from "crypto";
import { getStoredTeams, setStoredTeams, getData, setData } from "@/lib/store";
import { getTeams, clearTeamsCache } from "@/lib/teams";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/directory";
import { defaultFormatForAgeGroup } from "@/lib/planner";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;
const norm = (e) => (e || "").trim().toLowerCase();
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

// Team management for the /admin wizard, super admin only. Wizard-created
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

// GET: every team, flagged by source, including codes/keys (admin-only view).
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
  clearTeamsCache(); // admin view should never be stale
  const teams = await getTeams();
  return NextResponse.json({
    teams: teams.map((t) => ({
      slug: t.slug, name: t.name, password: t.password, calendarKey: t.calendarKey || "",
      ageGroup: t.ageGroup || "", coachEmails: t.coachEmails || [], squadi: t.squadi || null,
      source: t.stored ? "stored" : (t.legacy ? "legacy" : "env")
    }))
  });
}

// POST: create a team. Auto-derives slug from the name and generates the
// calendar key when omitted; seeds a clean starter document (name, age group,
// match-format default) so the team opens ready to use rather than as sample
// data.
export async function POST(req) {
  const gate = await requireAdmin();
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

  // Starter document (only if this slug has never held data).
  if (!(await getData(slug))) {
    await setData(slug, {
      team: { name: team.name, ageGroup: team.ageGroup || "", division: "", coachPin: "", matchFormat: defaultFormatForAgeGroup(team.ageGroup) },
      players: [], fixtures: [], sessions: []
    });
  }

  return NextResponse.json({ ok: true, team });
}

// PATCH: edit a team. Stored teams edit in place; editing an env-defined team
// "takes it over" into the store (stored wins on slug), so coach emails or a
// rotated code no longer need an env change + restart. Slug is immutable.
export async function PATCH(req) {
  const gate = await requireAdmin();
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

  const stored = (await getStoredTeams()) || [];
  const i = stored.findIndex((t) => t && t.slug === slug);
  const list = i === -1 ? [...stored, next] : stored.map((t, k) => (k === i ? next : t));
  await setStoredTeams(list);
  clearTeamsCache();
  return NextResponse.json({ ok: true, team: next, tookOver: i === -1 && !current.stored });
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
  return NextResponse.json({ ok: true });
}
