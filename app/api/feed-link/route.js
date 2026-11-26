import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, isClubAdminEmail } from "@/lib/directory";
import { parseFeedLink, DRIBL_NOT_SYNCED } from "@/lib/feedLinks";
import { lookupSquadiLink } from "@/lib/squadiLookup";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Reads a fixtures link pasted into the team wizard and says what it found, so
// the wizard can fill a draw in from the link and show it back before saving.
// Nothing is stored here: the team is saved through /api/teams as before.
//
// POST { link }
//   Squadi -> { ok, provider: "squadi", link, squadi: { competitionId, divisionId, teamId },
//               found: { competition, division, team, games } }
//             The competition's number is looked up on Squadi from the key in
//             the link (lib/squadiLookup.js); those three ids are what /api/sync
//             pulls the draw with.
//   Dribl  -> { ok, provider: "dribl", link, dribl: { link, site, season, competition, league, club },
//               synced: false, note }
//             Nothing is requested from Dribl: it does not let other sites read
//             its fixtures. The link is kept so the draw is one tap away.
//   Anything else -> 400 { error } with a sentence the wizard shows as it is.
//
// For the people who set teams up: super admins and club admins, the same
// gate as /api/teams. The server only ever calls api.squadi.com, with pieces
// of the link that have been checked; it never requests the pasted address.
export async function POST(req) {
  if (!AUTH_ON) return NextResponse.json({ error: "Team management needs account login (set AUTH_SECRET)." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(email) && !(await isClubAdminEmail(email))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const link = body && typeof body === "object" && !Array.isArray(body) ? body.link : undefined;

  const parsed = parseFeedLink(link);
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (parsed.provider === "dribl") {
    const { provider, ...dribl } = parsed;
    return NextResponse.json({ ok: true, provider, link: parsed.link, dribl, synced: false, note: DRIBL_NOT_SYNCED });
  }

  const found = await lookupSquadiLink(parsed.link);
  if (found.error) return NextResponse.json({ error: found.error }, { status: 400 });
  return NextResponse.json({ ok: true, ...found });
}
