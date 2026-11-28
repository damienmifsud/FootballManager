import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, clubPeople } from "@/lib/directory";
import { getAskLog, addAskLog } from "@/lib/store";
import { getTeams, teamFromCookieHeader } from "@/lib/teams";
import { askLogEntry, mergeAskLogs, ASK_LOG_MAX } from "@/lib/askLog";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// The questions asked on the teams' Ask tabs, kept with who asked them
// (lib/askLog.js).
//
// POST { question }  a quick answer the Ask tab worked out on the phone (the
//                    chips: next game, training, duties…), kept for the team
//                    the request is made from, with who asked, as /api/ask
//                    keeps every question it answers. Anyone who may ask may
//                    send it; the answer itself is not kept.
// GET  ?team=<slug>  the super admin's Questions section: every team's
//                    questions newest first (or one team's), each with the
//                    club's own name for the person who asked when it has
//                    one: { teams: [{ slug, name }], questions: [...] }.

// Who is asking, on which team, as /api/ask resolves it.
async function resolveTeam(req) {
  if (AUTH_ON) {
    const { resolveViewer } = await import("@/lib/viewer");
    return await resolveViewer(req);
  }
  const team = await teamFromCookieHeader(req.headers.get("cookie"));
  return team ? { mode: "code", team } : { error: 401, message: "unauthorized" };
}

export async function POST(req) {
  const v = await resolveTeam(req);
  if (v.error) return NextResponse.json({ error: v.message }, { status: v.error });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const entry = askLogEntry({ question: body?.question, how: "quick", viewer: v });
  if (!entry) return NextResponse.json({ error: "empty question" }, { status: 400 });
  try { await addAskLog(v.team.slug, entry, ASK_LOG_MAX); } catch { return NextResponse.json({ error: "not kept" }, { status: 503 }); }
  return NextResponse.json({ ok: true });
}

export async function GET(req) {
  if (!AUTH_ON) return NextResponse.json({ error: "The questions asked need account login (set AUTH_SECRET)." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const only = req?.url ? new URL(req.url).searchParams.get("team") : null;
  const teams = (await getTeams()).map((t) => ({ slug: t.slug, name: t.name }));
  const asked = only ? teams.filter((t) => t.slug === only) : teams;
  if (only && !asked.length) return NextResponse.json({ error: "No such team." }, { status: 404 });
  const lists = await Promise.all(asked.map(async (t) => ({ ...t, entries: await Promise.resolve(getAskLog(t.slug, ASK_LOG_MAX)).catch(() => []) })));
  const questions = mergeAskLogs(lists, ASK_LOG_MAX);

  // The club's own name for each person who asked (a staff row, a guardian,
  // a player's own record), looked up now so a name added later shows too.
  let names = new Map();
  if (questions.some((q) => q.who.email)) {
    try { names = new Map((await clubPeople()).people.map((p) => [p.email, p.name || ""])); } catch {}
  }
  return NextResponse.json({
    teams,
    questions: questions.map((q) => (q.who.email && names.get(q.who.email) ? { ...q, name: names.get(q.who.email) } : q))
  });
}
