import { NextResponse } from "next/server";
import { getData, setData, getMeta, setMeta } from "@/lib/store";
import { fetchSquadi, applySync } from "@/lib/squadiSync";
import { getTeams, teamBySlug, teamFromCookieHeader } from "@/lib/teams";
import { auth } from "@/auth";
import { membershipsForEmail, isCoachForTeam, viewingAs } from "@/lib/directory";

export const dynamic = "force-dynamic";
const AUTH_ON = !!process.env.AUTH_SECRET;
const STALE_MS = 15 * 60 * 1000; // sync-on-visit throttle

// Cron/pinger auth (syncs ALL teams) vs logged-in coach (syncs THEIR team).
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  if (new URL(req.url).searchParams.get("key") === secret) return true;
  return false;
}

async function emailChanges(teamName, changes) {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.NOTIFY_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || to.length === 0) return "email not configured";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || "Team Dashboard <onboarding@resend.dev>",
      to,
      subject: `⚽ ${teamName} — ${changes.length} fixture change${changes.length > 1 ? "s" : ""}`,
      text:
        `Fixture changes for ${teamName} just came through from Squadi:\n\n` +
        changes.map((c) => "• " + c).join("\n") +
        "\n\nCalendars subscribed to the team feed will update automatically."
    })
  });
  return res.ok ? "emailed" : `email failed (${res.status})`;
}

async function syncTeam(team, ifStale) {
  if (!team.squadi?.competitionId) return { team: team.slug, skipped: "no squadi config" };
  if (ifStale) {
    const meta = await getMeta(team.slug);
    if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < STALE_MS) {
      return { team: team.slug, skipped: "recent" };
    }
  }
  const data = await getData(team.slug);
  if (!data) return { team: team.slug, skipped: "no team data yet" };
  const squadi = await fetchSquadi(team.squadi);
  const { data: next, changes, created, mutated } = applySync(data, squadi);
  let emailStatus = "no changes";
  if (changes.length || mutated) {
    const isInitialImport = created === changes.length && created > 3;
    const toSave = isInitialImport
      ? { ...next, fixtures: next.fixtures.map((f) => ({ ...f, schedChanges: [] })) }
      : next;
    await setData(team.slug, toSave);
    emailStatus = changes.length
      ? (isInitialImport ? "initial import — email skipped" : await emailChanges(team.name, changes))
      : "silent update (e.g. logos) — saved, no email";
  }
  await setMeta(team.slug, { ...(await getMeta(team.slug)), lastSyncAt: Date.now() });
  return { team: team.slug, matchesSeen: squadi.length, created, changes, emailStatus };
}

export async function GET(req) {
  const ifStale = !!new URL(req.url).searchParams.get("ifStale");

  // Cron / pinger: sync every configured team.
  if (cronAuthorized(req)) {
    const results = [];
    for (const team of await getTeams()) {
      try {
        results.push(await syncTeam(team, ifStale));
      } catch (e) {
        results.push({ team: team.slug, ok: false, error: String(e?.message || e) });
      }
    }
    return NextResponse.json({ ok: true, results });
  }

  // Signed-in caller: sync just their team. Account mode restricts this to
  // coaches (parents can't trigger a sync); legacy team-code mode trusts
  // anyone holding the code — that's what drives the throttled sync-on-visit
  // and the /league "Sync now" button on team-code sites.
  let team = null;
  if (AUTH_ON) {
    const session = await auth();
    const email = session?.user?.email;
    if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (viewingAs(req, email)) return NextResponse.json({ error: "You're viewing as another user — read only. Exit view-as to make changes." }, { status: 403 });

    const { memberships } = await membershipsForEmail(email);
    if (!memberships.length) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const wanted = req.cookies.get("team_slug")?.value;
    const chosen = memberships.find((m) => m.teamSlug === wanted) || memberships[0];
    team = await teamBySlug(chosen.teamSlug);
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    if (!(await isCoachForTeam(email, team.slug))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    team = await teamFromCookieHeader(req.headers.get("cookie"));
    if (!team) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncTeam(team, ifStale);
    return NextResponse.json({ ok: true, changes: [], ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
