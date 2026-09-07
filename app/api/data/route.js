import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { redactForViewer, brisbaneTodayISO } from "@/lib/visibility";
import { preserveNarrowFields } from "@/lib/protect";

export const dynamic = "force-dynamic";

// Who is asking, on which team, wearing which hat: lib/viewer resolves the
// session, the validated team_slug cookie and the act_as cookie into
// { team, hat: { role, playerIds, playerNames } } (401/409 when it can't).
// A coach who is also a parent and has chosen the parent hat is, for this
// request, exactly a parent — same redaction, same refusals. A super admin
// "viewing as" someone resolves as that person and gets that person's hat,
// which is exactly how they check what a parent sees. Legacy team-code mode
// (no AUTH_SECRET) has no roles: one shared code, the whole document, hat
// role "coach" — the "what parents see" switches are UI-only there.

// READ: any member of the team (account mode) or anyone with the team code
// (legacy mode) can read team data — but what they get back depends on the
// hat they wear. Coaches see the whole document; parents and viewers get it
// redacted server-side by lib/visibility (no rules, no coach ratings or
// notes, plan and match record only as far as the coach's "what parents see"
// switches allow, with game day judged on Brisbane's calendar).
export async function GET(req) {
  const v = await resolveViewer(req);
  if (v.error) return viewerError(v);
  const doc = await getData(v.team.slug);
  if (doc == null) return NextResponse.json(null);
  return NextResponse.json(redactForViewer(doc, { role: v.hat.role, playerIds: v.hat.playerIds, todayISO: brisbaneTodayISO() }));
}

// WRITE: the coach hat only in account mode — parents use the narrow
// /api/rsvp route, and a coach-parent acting as parent is refused too. In
// legacy team-code mode everyone with the code can edit (the original access
// model: one shared code, no roles). Impersonation is strictly read-only
// (lib/viewer refuses the write before anything else).
//
// Protected fields: the dashboard posts its whole in-memory copy, which is
// stale for everything written through the narrow routes since the page
// loaded (RSVPs via /api/rsvp, plans via /api/plan, ratings via
// /api/player-coach). lib/protect re-reads the stored document and keeps
// those fields from it, so recording a score can no longer wipe a reply that
// landed a moment ago.
export async function POST(req) {
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const stored = await getData(v.team.slug);
  await setData(v.team.slug, preserveNarrowFields(stored, body));
  return NextResponse.json({ ok: true });
}
