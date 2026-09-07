import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";

export const dynamic = "force-dynamic";

// Narrow RSVP endpoint. In account mode the WORN hat (lib/viewer.js) decides:
// a coach hat can set anyone (stamped "Coach"), a parent hat only the children
// listed on that hat (stamped with the child's name), a viewer hat nothing.
// A coach who is also a parent and has chosen to act as the parent gets
// exactly the parent's powers — the hat, not the email, is the permission.
// In legacy team-code mode everyone with the code is trusted (the original
// access model: one shared code, no roles), and the per-device whoami cookie
// attributes the response.
// Writes just one player's availability entry for one game or session — no
// whole-object overwrite, so concurrent parents can't clobber each other and
// nobody can smuggle in config/score changes.
//
// Body: { kind: "game" | "session", id, occ?, playerId, status, reason? }
//  - kind "game":    id = fixture id
//  - kind "session": id = session id, occ = occurrence ISO date (yyyy-mm-dd)
//  - status: "in" | "out" | null  (null clears the response)

// Legacy mode: the per-device whoami_<slug> cookie says who is responding.
function whoamiFromCookies(req, slug) {
  const raw = req.cookies.get(`whoami_${slug}`)?.value;
  if (!raw) return null;
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return null; }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { kind, id, occ, playerId, status, reason } = body || {};

  if (!["game", "session"].includes(kind) || !id || !playerId) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (status !== "in" && status !== "out" && status !== null) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  if (kind === "session" && !occ) {
    return NextResponse.json({ error: "missing occurrence" }, { status: 400 });
  }

  // Who is acting, on which team, wearing which hat. A write: a super admin
  // "viewing as" someone is refused before anything else.
  const v = await resolveViewer(req, { write: true });
  if (v.error) return viewerError(v);
  const team = v.team;

  const data = await getData(team.slug);
  if (!data) return NextResponse.json({ error: "no data" }, { status: 404 });

  const player = (data.players || []).find((p) => p.id === playerId);
  if (!player) return NextResponse.json({ error: "no such player" }, { status: 404 });

  // Permission + attribution: the worn hat decides.
  let label;
  if (v.mode === "account") {
    const hat = v.hat || {};
    if (hat.role === "coach") {
      label = "Coach";
    } else if (hat.role === "parent" && (hat.playerIds || []).includes(playerId)) {
      label = player.name || "Parent";
    } else {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    // Anyone with the code may write; attribute from the device identity:
    // this child's parent, or otherwise the coach.
    const who = whoamiFromCookies(req, team.slug);
    label = who?.kind === "parent" && who.pid === playerId ? (player.name || "Parent") : "Coach";
  }

  // Build the single entry. Stamp who/when for coach tools + display.
  const entry = status == null
    ? null
    : { status, ...(status === "out" ? { reason: reason || "Away" } : {}), by: label, at: Date.now() };

  // Merge just this one player's entry into the right availability map.
  let next;
  if (kind === "game") {
    next = {
      ...data,
      fixtures: (data.fixtures || []).map((f) => {
        if (f.id !== id) return f;
        const avail = { ...(f.availability || {}) };
        if (entry == null) delete avail[playerId]; else avail[playerId] = entry;
        return { ...f, availability: avail };
      })
    };
  } else {
    next = {
      ...data,
      sessions: (data.sessions || []).map((s) => {
        if (s.id !== id) return s;
        const dayMap = { ...(s.availability || {}) };
        const day = { ...(dayMap[occ] || {}) };
        if (entry == null) delete day[playerId]; else day[playerId] = entry;
        dayMap[occ] = day;
        return { ...s, availability: dayMap };
      })
    };
  }

  await setData(team.slug, next);
  return NextResponse.json({ ok: true, entry });
}
