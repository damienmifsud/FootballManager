import { NextResponse } from "next/server";
import { getData, setData } from "@/lib/store";
import { resolveViewer, viewerError } from "@/lib/viewer";
import { sanitizeParentsSee, sanitizeMatchFormat, sanitizeRules, sanitizeSeason, sanitizeStrip, sanitizeLogo } from "@/lib/teamSetup";
import { cleanFill } from "@/lib/clubs";
import { siteUrl } from "@/lib/clubSite";

export const dynamic = "force-dynamic";

// Narrow team-settings endpoint: writes ONLY the named team.* fields (what
// parents see, the match format, the match-day rules, the season window, the
// kit the team wears, the team's logo) and nothing else. The
// coach's settings screen may sit open for a long time; a parent's RSVP (or a
// live plan autosave) that lands between the coach's read and their save must
// survive, so this route re-reads the document, merges just the provided keys
// into data.team and never touches players/fixtures/sessions. A whole-document
// persist() from the settings screen would silently clobber that RSVP.
// Account mode restricts writes to coaches/admins; legacy team-code mode
// trusts any code holder (the original one-code-no-roles model — the settings
// UI itself is coach-gated).
//
// Body: { parentsSee?, matchFormat?, rules?, season?, strip?, logo?, logoFill?,
// logoSite? } — at least one key required. season: { startISO, endISO } sets
// the window, null clears it. strip: "Red" (home kit) or "Blue" (away kit);
// anything else clears it. logo: the team's logo as the coach's browser made
// it (a data: URL of a picture, lib/teamSetup.js sanitizeLogo), "" to go back
// to the club's crest; a logo that isn't one is refused rather than taken as
// "". logoFill: how far it is enlarged in its circle (1 to FILL_MAX, and 1
// with no logo). logoSite: the club website it was picked from, for finding
// it again.
// Response: { ok: true, team: { <only the provided keys, sanitised> } } so the
// client can patch its local state with exactly what was stored.
const SETTING_KEYS = ["parentsSee", "matchFormat", "rules", "season", "strip", "logo", "logoFill", "logoSite"];

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const provided = SETTING_KEYS.filter((k) => k in body);
  if (!provided.length) {
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

  // Sanitise only what was sent; anything else on data.team is left as-is.
  const patch = {};
  if ("parentsSee" in body) patch.parentsSee = sanitizeParentsSee(body.parentsSee);
  if ("matchFormat" in body) patch.matchFormat = sanitizeMatchFormat(body.matchFormat, data.team?.ageGroup);
  if ("rules" in body) patch.rules = sanitizeRules(body.rules);
  if ("season" in body) patch.season = sanitizeSeason(body.season);
  if ("strip" in body) patch.strip = sanitizeStrip(body.strip);
  if ("logo" in body) {
    patch.logo = sanitizeLogo(body.logo);
    if (body.logo && !patch.logo) return NextResponse.json({ error: "That picture can't be used as the logo. Try a smaller one." }, { status: 400 });
  }
  if ("logoFill" in body) patch.logoFill = cleanFill(body.logoFill);
  if ("logo" in body && !patch.logo) patch.logoFill = 1;
  if ("logoSite" in body) patch.logoSite = siteUrl(body.logoSite)?.href || "";

  // Merge just these team fields; players, fixtures and sessions are the
  // freshly read copies, so any RSVP that landed meanwhile rides along intact.
  const next = { ...data, team: { ...(data.team || {}), ...patch } };
  await setData(team.slug, next);
  return NextResponse.json({ ok: true, team: patch });
}
