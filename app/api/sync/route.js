import { NextResponse } from "next/server";
import { getData, setData, getMeta, setMeta } from "@/lib/store";
import { fetchSquadi, applySync } from "@/lib/squadiSync";

export const dynamic = "force-dynamic";

const STALE_MS = 15 * 60 * 1000; // sync-on-visit throttle

// Auth: callable by (a) Vercel Cron (Authorization: Bearer CRON_SECRET),
// (b) any URL pinger with ?key=CRON_SECRET, or (c) a logged-in person (site cookie).
function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return true;
  if (secret && new URL(req.url).searchParams.get("key") === secret) return true;
  const cookie = req.headers.get("cookie") || "";
  if (process.env.SITE_PASSWORD && cookie.includes(`site_auth=${encodeURIComponent(process.env.SITE_PASSWORD)}`)) return true;
  if (process.env.SITE_PASSWORD && cookie.includes(`site_auth=${process.env.SITE_PASSWORD}`)) return true;
  return false;
}

async function emailChanges(changes) {
  const key = process.env.RESEND_API_KEY;
  const to = (process.env.NOTIFY_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || to.length === 0) return "email not configured";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || "Team Dashboard <onboarding@resend.dev>",
      to,
      subject: `⚽ Fixture update — ${changes.length} change${changes.length > 1 ? "s" : ""}`,
      text:
        "The following fixture changes just came through from Squadi:\n\n" +
        changes.map((c) => "• " + c).join("\n") +
        "\n\nCalendars subscribed to the team feed will update automatically."
    })
  });
  return res.ok ? "emailed" : `email failed (${res.status})`;
}

export async function GET(req) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // Visit-triggered mode: skip entirely if a sync ran recently.
    if (new URL(req.url).searchParams.get("ifStale")) {
      const meta = await getMeta();
      if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < STALE_MS) {
        return NextResponse.json({ ok: true, skipped: "recent", lastSyncAt: meta.lastSyncAt });
      }
    }

    const data = await getData();
    if (!data) return NextResponse.json({ error: "no team data yet — open the dashboard once first" }, { status: 409 });

    const squadi = await fetchSquadi();
    const { data: next, changes, created } = applySync(data, squadi);

    let emailStatus = "no changes";
    if (changes.length) {
      // Don't email or badge the very first bulk import — only subsequent changes.
      const isInitialImport = created === changes.length && created > 3;
      const toSave = isInitialImport
        ? { ...next, fixtures: next.fixtures.map((f) => ({ ...f, schedChanges: [] })) }
        : next;
      await setData(toSave);
      emailStatus = isInitialImport ? "initial import — email skipped" : await emailChanges(changes);
    }
    await setMeta({ ...(await getMeta()), lastSyncAt: Date.now() });

    return NextResponse.json({ ok: true, matchesSeen: squadi.length, created, changes, emailStatus });
  } catch (e) {
    // Fail safe: never write anything when the upstream looks wrong.
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}
