import { NextResponse } from "next/server";
import { getData, setData, getMeta, setMeta } from "@/lib/store";
import { fetchSquadi, applySync } from "@/lib/squadiSync";
import { squadiSources } from "@/lib/competitions";
import { getTeams } from "@/lib/teams";
import { resolveViewer, viewerError } from "@/lib/viewer";

export const dynamic = "force-dynamic";
const STALE_MS = 15 * 60 * 1000; // sync-on-visit throttle

// Cron/pinger auth (syncs ALL teams) vs a signed-in viewer (syncs THEIR team).
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

// One team's sync. A team has one draw or several (lib/competitions.js): its
// season (two feeds, for one squad that plays as two teams each round), plus
// any other competition whose Squadi ids are complete. One draw failing (it is
// not published yet, say) never stops the others: it is listed under `errors`
// and the rest are applied. Only when every draw fails is the whole sync an
// error, as it was with one.
async function syncTeam(team, ifStale) {
  const sources = squadiSources(team);
  if (!sources.length) return { team: team.slug, skipped: "no squadi config" };
  if (ifStale) {
    const meta = await getMeta(team.slug);
    if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < STALE_MS) {
      return { team: team.slug, skipped: "recent" };
    }
  }
  if (!(await getData(team.slug))) return { team: team.slug, skipped: "no team data yet" };

  // Fetch every draw first, then read the document and write it straight
  // back: a reply or a score saved while Squadi was answering is in the copy
  // the sync applies to, not lost under it.
  const draws = await Promise.all(sources.map(async (src) => {
    try { return { ...src, squadi: await fetchSquadi(src.squadi) }; }
    catch (e) { return { ...src, error: String(e?.message || e) }; }
  }));
  // Each failure is named for whoever reads it (the side, the competition, or
  // "Season"), and carries `side` when it is one of a squad's two feeds.
  const errors = draws.filter((d) => d.error).map((d) => ({
    name: d.side || (d.comp ? d.comp.name : "Season"), ...(d.side ? { side: d.side } : {}), error: d.error
  }));
  if (errors.length === draws.length) throw new Error(errors[0].error);

  let data = await getData(team.slug);
  if (!data) return { team: team.slug, skipped: "no team data yet" };
  const changes = [], toEmail = [];
  let matchesSeen = 0, created = 0, dirty = false, initialImport = false;
  for (const draw of draws) {
    if (draw.error) continue;
    matchesSeen += draw.squadi.length;
    const had = new Set((data.fixtures || []).map((f) => f.id));
    const r = applySync(data, draw.squadi, { comp: draw.comp, side: draw.side });
    if (!(r.changes.length || r.mutated)) continue;
    dirty = true;
    created += r.created;
    changes.push(...r.changes);
    // A draw arriving for the first time is not news: no "new game" badges on
    // the games it just added and no email. Other draws in the same run (the
    // squad's other feed, another competition) are judged on their own.
    const isInitialImport = r.created === r.changes.length && r.created > 3;
    if (isInitialImport) {
      initialImport = true;
      data = { ...r.data, fixtures: r.data.fixtures.map((f) => (had.has(f.id) ? f : { ...f, schedChanges: [] })) };
    } else {
      data = r.data;
      toEmail.push(...r.changes);
    }
  }

  let emailStatus = "no changes";
  if (dirty) {
    await setData(team.slug, data);
    emailStatus = toEmail.length ? await emailChanges(team.name, toEmail)
      : initialImport ? "initial import — email skipped"
      : "silent update (e.g. logos) — saved, no email";
  }
  await setMeta(team.slug, { ...(await getMeta(team.slug)), lastSyncAt: Date.now() });
  return { team: team.slug, matchesSeen, created, changes, emailStatus, ...(errors.length ? { errors } : {}) };
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

  // Signed-in caller: sync just their team. A sync writes the team document,
  // so it is always a write (a super admin "viewing as" someone is refused).
  // The throttled sync-on-visit (?ifStale=1) is open to ANY hat — a parent
  // opening the dashboard keeps the fixtures near-live for everyone. A manual
  // sync (no ifStale, the /league "Sync now" button) needs the coach hat in
  // account mode; legacy team-code mode trusts anyone holding the code.
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && !ifStale && v.hat?.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const team = v.team;

  try {
    const result = await syncTeam(team, ifStale);
    return NextResponse.json({ ok: true, changes: [], ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
