import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, viewingAs } from "@/lib/directory";
import { getData, getClubLogos } from "@/lib/store";
import { getTeams } from "@/lib/teams";
import { squadiSources, driblSources } from "@/lib/competitions";
import { fetchSquadi } from "@/lib/squadiSync";
import { sanitizeDrawRecords, sanitizeDriblClubs } from "@/lib/dribl";
import { cleanLibrary, logoSummary, setManual, isRef, setNamedClub, dropNamedClub } from "@/lib/clubLogos";
import { readClubSite } from "@/lib/clubSite";
import { learnLogos, changeLibrary, logoAllowed, extraLogoHosts } from "@/lib/clubLogoStore";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// The club logo library, for the super admin's Logos section at /admin:
// every opposition team the club's teams have met or will meet, what is shown
// for each (built-in crest, a club the admin added, a logo found on Squadi or
// Dribl, hidden, or the initials), and the means to look again, to add a club
// with the logo from its own website, and to hide a logo that is wrong.
//
// GET  → { counts, opponents, named, dribl: [{ team, comp, name, url, teamName }], hosts }
//        `dribl` is every team's Dribl draws, for the admin's own browser to
//        read (Dribl turns servers away); `hosts` the extra logo hosts the
//        site allows (LOGO_HOSTS).
// POST { action: "refresh" }               every team's Squadi draws read again
//                                          for their logos (games are left alone)
// POST { action: "dribl", draws, clubs }   what the admin's browser read from Dribl
// POST { action: "hide" | "show", ref, club?, kind? }
//                                          the admin's own choice for a team or
//                                          club, which nothing found ever overrides
// POST { action: "site", url }             the club's website read for the
//                                          images that may be its logo:
//                                          { site, candidates }; nothing is saved
// POST { action: "club", name, logo, site } a club added (or changed), held for
//                                          the club: every team whose name has
//                                          all its words is shown the logo
// POST { action: "unclub", key }           an added club taken out again
async function requireSuperAdmin(req) {
  if (!AUTH_ON) return { error: "The logo library needs account login (set AUTH_SECRET).", status: 400 };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "unauthorized", status: 401 };
  if (!isAdminEmail(email)) return { error: "forbidden", status: 403 };
  return { email, readOnly: !!viewingAs(req, email) };
}

async function everyGame() {
  const teams = await getTeams();
  const docs = await Promise.all(teams.map((t) => Promise.resolve(getData(t.slug)).catch(() => null)));
  return { teams, games: docs.flatMap((d) => (Array.isArray(d?.fixtures) ? d.fixtures : [])) };
}

async function report() {
  const [{ teams, games }, raw] = await Promise.all([everyGame(), getClubLogos()]);
  const { opponents, counts, named } = logoSummary(cleanLibrary(raw), games, { allowed: (u) => logoAllowed(u) });
  const dribl = teams.flatMap((t) => driblSources(t).map((s) => ({ team: t.slug, teamName: t.name, comp: s.comp.id, name: s.comp.name, url: s.dribl.url, ourTeam: s.dribl.team || "" })));
  return { counts, opponents, named, dribl, hosts: extraLogoHosts() };
}

export async function GET(req) {
  const gate = await requireSuperAdmin(req);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await report());
}

export async function POST(req) {
  const gate = await requireSuperAdmin(req);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (gate.readOnly) return NextResponse.json({ error: "You're viewing as another user — read only. Exit view-as to make changes." }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const action = body && typeof body === "object" ? body.action : "";

  if (action === "refresh") {
    // Every team's Squadi draws, read again for what they say of the
    // opposition. Nothing is applied to a team's games here: the sync does
    // that. A draw Squadi will not give is counted and the rest go on.
    const teams = await getTeams();
    const sources = teams.flatMap((t) => squadiSources(t));
    let read = 0, failed = 0;
    const draws = [];
    for (const s of sources) {
      try { draws.push({ provider: "squadi", records: await fetchSquadi(s.squadi) }); read++; }
      catch { failed++; }
    }
    const learnt = await learnLogos({ draws });
    return NextResponse.json({ ok: true, read, failed, saved: !!learnt.ok, ...(learnt.ok ? {} : { error: learnt.error }), ...(await report()) });
  }

  if (action === "dribl") {
    const sent = Array.isArray(body.draws) ? body.draws.slice(0, 50) : [];
    const draws = sent.map((d) => ({ provider: "dribl", records: sanitizeDrawRecords(d?.records) || [] })).filter((d) => d.records.length);
    const clubs = sanitizeDriblClubs(body.clubs);
    const learnt = await learnLogos({ draws, clubs });
    return NextResponse.json({ ok: true, read: draws.length, clubs: clubs.length, saved: !!learnt.ok, ...(learnt.ok ? {} : { error: learnt.error }), ...(await report()) });
  }

  if (action === "hide" || action === "show") {
    // A club's logo is hidden on the club, for all its teams; a team's own
    // logo, or the one on its games, on the team. Show clears both.
    if (!isRef(body.ref) || (body.club !== undefined && !isRef(body.club))) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const target = action === "hide" && body.kind === "club" && body.club ? body.club : body.ref;
    const r = await changeLibrary((lib) => {
      let next = setManual(lib, target, { hidden: action === "hide" });
      if (action === "show" && body.club) next = setManual(next, body.club, { hidden: false });
      return { lib: next, changed: true };
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 });
    return NextResponse.json({ ok: true, ...(await report()) });
  }

  if (action === "site") {
    // Read only: the page is looked at for logos and nothing is kept.
    try {
      const { site, candidates } = await readClubSite(body.url);
      return NextResponse.json({ ok: true, site, candidates });
    } catch (e) {
      return NextResponse.json({ error: e?.siteError ? e.message : "The site couldn't be read." }, { status: 422 });
    }
  }

  if (action === "club") {
    // Checked before the library is locked, so a bad request never waits on it.
    const today = new Date().toISOString().slice(0, 10);
    const tried = setNamedClub({}, { name: body.name, logo: body.logo, site: body.site, today });
    if (tried.error) return NextResponse.json({ error: tried.error }, { status: 400 });
    const r = await changeLibrary((lib) => {
      const out = setNamedClub(lib, { name: body.name, logo: body.logo, site: body.site, today });
      return out.error ? { lib, changed: false } : { lib: out.lib, changed: true };
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 });
    return NextResponse.json({ ok: true, key: tried.key, ...(await report()) });
  }

  if (action === "unclub") {
    if (typeof body.key !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.key) || body.key.length > 200) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const r = await changeLibrary((lib) => ({ lib: dropNamedClub(lib, body.key), changed: true }));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 });
    return NextResponse.json({ ok: true, ...(await report()) });
  }

  return NextResponse.json({ error: "bad request" }, { status: 400 });
}
