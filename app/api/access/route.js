import { NextResponse } from "next/server";
import { getClubAccess, setClubAccess } from "@/lib/store";
import { getTeams } from "@/lib/teams";
import { auth } from "@/auth";
import { isAdminEmail, OVERRIDE_ROLES, viewingAs } from "@/lib/directory";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;
const norm = (e) => (e || "").trim().toLowerCase();

// Access-control management, super admin only. Roles only exist in account
// mode (identity = email), so in legacy team-code mode this whole surface is
// disabled rather than guessable.
async function requireAdmin() {
  if (!AUTH_ON) return { error: "Access control needs account login (set AUTH_SECRET).", status: 400 };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "unauthorized", status: 401 };
  if (!isAdminEmail(email)) return { error: "forbidden", status: 403 };
  return { email };
}

// GET: the current access doc + enough context to manage it.
export async function GET(req) {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const access = (await getClubAccess()) || {};
  const envClubAdmins = (process.env.CLUB_ADMIN_EMAILS || "").split(",").map(norm).filter(Boolean);
  return NextResponse.json({
    teams: (await getTeams()).map((t) => ({ slug: t.slug, name: t.name, coachEmails: t.coachEmails || [] })),
    clubAdmins: (access.clubAdmins || []).map(norm),
    envClubAdmins, // configured in the env; shown but not editable here
    overrides: access.overrides || {},
    roles: OVERRIDE_ROLES,
    viewingAs: viewingAs(req, gate.email)
  });
}

// POST: one mutation at a time.
//   { action: "setOverride", email, teamSlug, role }   role in OVERRIDE_ROLES, or null to clear
//   { action: "addClubAdmin" | "removeClubAdmin", email }
export async function POST(req) {
  const gate = await requireAdmin();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const action = body?.action;

  // "View as" toggles a session cookie only; it never touches the access doc.
  // The cookie is deliberately session-lived (no maxAge) so impersonation
  // can't outlive the browser session.
  if (action === "clearViewAs") {
    const res = NextResponse.json({ ok: true, viewingAs: null });
    res.cookies.set("view_as", "", { path: "/", maxAge: 0, sameSite: "lax" });
    return res;
  }
  const email = norm(body?.email);
  if (!email || !email.includes("@")) return NextResponse.json({ error: "bad email" }, { status: 400 });
  if (action === "viewAs") {
    if (isAdminEmail(email)) return NextResponse.json({ error: "you already are the super admin" }, { status: 400 });
    const res = NextResponse.json({ ok: true, viewingAs: email });
    res.cookies.set("view_as", email, { path: "/", sameSite: "lax", httpOnly: true });
    return res;
  }

  const access = (await getClubAccess()) || {};
  const next = { clubAdmins: (access.clubAdmins || []).map(norm), overrides: { ...(access.overrides || {}) } };

  if (action === "setOverride") {
    const teamSlug = body?.teamSlug;
    const role = body?.role ?? null;
    if (!(await getTeams()).some((t) => t.slug === teamSlug)) return NextResponse.json({ error: "no such team" }, { status: 400 });
    if (role !== null && !OVERRIDE_ROLES.includes(role)) return NextResponse.json({ error: "bad role" }, { status: 400 });
    if (isAdminEmail(email)) return NextResponse.json({ error: "the super admin can't be overridden" }, { status: 400 });
    const mine = { ...(next.overrides[email] || {}) };
    if (role === null) delete mine[teamSlug]; else mine[teamSlug] = role;
    if (Object.keys(mine).length === 0) delete next.overrides[email]; else next.overrides[email] = mine;
  } else if (action === "addClubAdmin") {
    if (!next.clubAdmins.includes(email)) next.clubAdmins.push(email);
  } else if (action === "removeClubAdmin") {
    next.clubAdmins = next.clubAdmins.filter((e) => e !== email);
  } else {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }

  await setClubAccess(next);
  return NextResponse.json({ ok: true, clubAdmins: next.clubAdmins, overrides: next.overrides });
}
