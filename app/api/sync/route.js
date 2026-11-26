import { NextResponse } from "next/server";
import { getData, setData, getMeta, setMeta } from "@/lib/store";
import { fetchSquadi, applySync } from "@/lib/squadiSync";
import { getTeams, squadiFeeds } from "@/lib/teams";
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

// One team's sync. A two-feed squad (lib/teams squadiFeeds) applies each feed
// in turn onto the same document and saves once. A failing feed never blocks
// the other: what succeeded is saved and the failure is reported in `errors`.
// When every feed fails the first error is thrown, as a single feed always has.
async function syncTeam(team, ifStale) {
  const feeds = squadiFeeds(team).filter((f) => f.competitionId);
  if (!feeds.length) return { team: team.slug, skipped: "no squadi config" };
  if (ifStale) {
    const meta = await getMeta(team.slug);
    if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < STALE_MS) {
      return { team: team.slug, skipped: "recent" };
    }
  }
  const data = await getData(team.slug);
  if (!data) return { team: team.slug, skipped: "no team data yet" };

  let doc = data, matchesSeen = 0, created = 0, dirty = false, anyInitial = false, firstError = null;
  const changes = [], toEmail = [], errors = [];
  for (const feed of feeds) {
    try {
      const squadi = await fetchSquadi(feed);
      const r = applySync(doc, squadi, { side: feed.label });
      matchesSeen += squadi.length;
      if (!r.changes.length && !r.mutated) continue;
      // A feed's first import (all new games, more than three) is not news:
      // no email, and its games carry no "New game" change banner.
      const isInitialImport = r.created === r.changes.length && r.created > 3;
      // On a two-feed squad only that feed's new games are cleared, so the
      // other side's real changes keep their banners.
      const before = new Set((doc.fixtures || []).map((f) => f.id));
      const fresh = (f) => feeds.length === 1 || !before.has(f.id);
      doc = isInitialImport ? { ...r.data, fixtures: r.data.fixtures.map((f) => (fresh(f) ? { ...f, schedChanges: [] } : f)) } : r.data;
      dirty = true;
      created += r.created;
      changes.push(...r.changes);
      if (isInitialImport) anyInitial = true; else toEmail.push(...r.changes);
    } catch (e) {
      firstError = firstError || e;
      errors.push({ ...(feed.label ? { side: feed.label } : {}), error: String(e?.message || e) });
    }
  }
  if (errors.length === feeds.length) throw firstError;

  let emailStatus = "no changes";
  if (dirty) {
    await setData(team.slug, doc);
    emailStatus = toEmail.length ? await emailChanges(team.name, toEmail)
      : anyInitial ? "initial import — email skipped"
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
