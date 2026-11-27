import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, isClubAdminEmail } from "@/lib/directory";
import { parseFeedLink } from "@/lib/feedLinks";
import { lookupSquadiLink } from "@/lib/squadiLookup";
import { lookupMajestriLink } from "@/lib/majestriDraw";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Reads a Squadi or Majestri fixtures link pasted into the team wizard and
// says what it found, so the wizard can fill a draw in from the link and show
// it back before saving. Nothing is stored here: the team is saved through
// /api/teams as before.
//
// POST { link, team? }
//   Squadi   -> { ok, provider: "squadi", link, squadi: { competitionId, divisionId, teamId },
//                 found: { competition, division, team, games } }
//               The competition's number is looked up on Squadi from the key in
//               the link (lib/squadiLookup.js); those three ids are what /api/sync
//               pulls the draw with.
//   Majestri -> { ok, provider: "majestri", link, majestri: { url, team?, teamId? },
//                 found: { competition, division, season, teams, games, ours, ourGames, ourResults } }
//               The competition's page is read (lib/majestriDraw.js). `ours` is
//               our team when the link is a team's own page, or when `team`
//               (the name the wizard already has) is one of the page's teams;
//               otherwise the wizard asks which of `teams` is ours.
//   Anything else -> 400 { error } with a sentence the wizard shows as it is.
//
// A Dribl link is not read here: Dribl turns servers away, so the browser
// reads it (lib/driblLink.js). One sent here is told so.
//
// For the people who set teams up: super admins and club admins, the same
// gate as /api/teams. The server only ever calls api.squadi.com and a club's
// <club>.majestri.com.au, at addresses built from pieces of the link that have
// been checked; it never requests the pasted address.
export const DRIBL_IS_READ_IN_THE_BROWSER = "A Dribl link is read by the browser, not by the server.";
const TEAM_NAME_MAX = 80;

export async function POST(req) {
  if (!AUTH_ON) return NextResponse.json({ error: "Team management needs account login (set AUTH_SECRET)." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(email) && !(await isClubAdminEmail(email))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const fields = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const link = fields.link;

  const parsed = parseFeedLink(link);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  // A competition on Majestri: its page is read here, and what it holds is
  // said back (lib/majestriDraw.js). Majestri answers servers.
  if (parsed.provider === "majestri") {
    const team = typeof fields.team === "string" ? fields.team.trim().slice(0, TEAM_NAME_MAX) : "";
    const read = await lookupMajestriLink(parsed.link, undefined, { team });
    if (read.error) return NextResponse.json({ error: read.error }, { status: 400 });
    return NextResponse.json({ ok: true, ...read });
  }
  if (parsed.provider !== "squadi") return NextResponse.json({ error: DRIBL_IS_READ_IN_THE_BROWSER }, { status: 400 });

  const found = await lookupSquadiLink(parsed.link);
  if (found.error) return NextResponse.json({ error: found.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...found });
}
