// Applies fetched draws to a team's document and saves it. Server only.
//
// A draw is the games of one source: the season (or one side of it), or
// another competition. Wherever it was fetched (Squadi, by /api/sync on the
// server; Dribl, by a coach's browser and posted to /api/dribl), what happens
// next is the same and lives here: each draw is applied in turn onto the same
// freshly read document, the document is saved once, a draw's first import is
// not treated as news, and real changes are emailed.
import { getData, setData, getMeta, setMeta } from "@/lib/store";
import { applySync } from "@/lib/squadiSync";

export async function emailChanges(teamName, changes, source = "Squadi") {
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
        `Fixture changes for ${teamName} just came through from ${source}:\n\n` +
        changes.map((c) => "• " + c).join("\n") +
        "\n\nCalendars subscribed to the team feed will update automatically."
    })
  });
  return res.ok ? "emailed" : `email failed (${res.status})`;
}

// draws: [{ comp, side, records }] — comp is null for the season and
// { id, name } otherwise; side is the feed's label on a two-feed squad;
// records are the draw's games as applySync takes them.
// `source` names where they came from in the email; `stamp` is the meta key
// that records when this kind of sync last ran.
// Returns { matchesSeen, created, changes, emailStatus }, or null when the
// team has no document yet (nothing is created from a sync).
export async function applyDraws(team, draws, { source = "Squadi", stamp = "lastSyncAt" } = {}) {
  // Read the document only now, after every fetch is done, and write it
  // straight back: a reply or a score saved while the draws were being
  // fetched is in the copy the sync applies to, not lost under it.
  let data = await getData(team.slug);
  if (!data) return null;
  const changes = [], toEmail = [];
  let matchesSeen = 0, created = 0, dirty = false, initialImport = false;
  for (const draw of draws) {
    matchesSeen += draw.records.length;
    const had = new Set((data.fixtures || []).map((f) => f.id));
    const r = applySync(data, draw.records, { comp: draw.comp, side: draw.side });
    if (!(r.changes.length || r.mutated)) continue;
    dirty = true;
    created += r.created;
    changes.push(...r.changes);
    // A draw arriving for the first time is not news: no "new game" badges on
    // the games it just added and no email. Other draws in the same run (the
    // other side of a two-feed squad, another competition) are judged on
    // their own, so their real changes keep their banners.
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
    emailStatus = toEmail.length ? await emailChanges(team.name, toEmail, source)
      : initialImport ? "initial import — email skipped"
      : "silent update (e.g. logos) — saved, no email";
  }
  await setMeta(team.slug, { ...(await getMeta(team.slug)), [stamp]: Date.now() });
  return { matchesSeen, created, changes, emailStatus };
}
