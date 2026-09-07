import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { sanitizeCoachFields } from "@/lib/teamSetup";

export const dynamic = "force-dynamic";

// Narrow coach-fields endpoint: writes ONE player's coach-only block (position
// ratings and a private note) and nothing else, so a rating tweak can never
// clobber an RSVP, a game plan or another player's edit that landed moments
// earlier. Account mode restricts writes to coaches/admins; legacy team-code
// mode trusts any code holder (the original one-code-no-roles model — the
// ratings UI itself is coach-gated).
//
// Body: { playerId, ratings?, note? }  — at least one of ratings/note.
//   ratings: { GK, DEF, MID, FWD } each 0-5 or null; note: string <= 400 chars.
// The patch is merged over the player's existing coach block, so a ratings-only
// save keeps the note and a note-only save keeps the ratings.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { playerId, ratings, note } = body || {};
  if (!playerId || (ratings === undefined && note === undefined)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  if (v.mode === "account" && v.hat.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const team = v.team;

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });
  const player = (data.players || []).find((p) => p.id === playerId);
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });

  // Merge the patch over what's already there, then run the whole block
  // through the shared guard so stored ratings are always 0-5 or null and the
  // note is always trimmed and capped.
  const existing = player.coach || {};
  const patch = {
    ...existing,
    ...(ratings !== undefined ? { ratings } : {}),
    ...(note !== undefined ? { note } : {})
  };
  const coach = sanitizeCoachFields(patch);

  // Write just this one player's coach block; every other field is preserved.
  const next = {
    ...data,
    players: data.players.map((p) => (p.id === playerId ? { ...p, coach } : p))
  };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true, playerId, coach });
}
