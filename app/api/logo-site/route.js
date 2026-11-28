import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, isClubAdminEmail, viewingAs } from "@/lib/directory";
import { resolveViewer, READ_ONLY_MESSAGE } from "@/lib/viewer";
import { readClubSite, readLogoImage } from "@/lib/clubSite";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// The team's own logo from its club's website, for the coach's Club logo card
// in Team settings and the team form in Club admin:
//
// POST { action: "site", url }   the club's website read for the images that
//                                may be its logo: { site, candidates }
// POST { action: "image", url }  the one the person picked, fetched here so
//                                their browser can fit it into the team's logo:
//                                { type, picture } (a data: URL of the bytes)
//
// Nothing is kept here: the browser turns the picture into the team's logo and
// saves it the way an uploaded one is saved. Each read is one request to a
// public https site, checked as lib/clubSite.js describes.
//
// Who may: a signed-in super admin or club admin, or a coach of the team the
// request is made from (its team_slug cookie). Not while viewing as someone
// else, and not in team-code mode, where nobody is signed in. Each sign-in
// gets READS_PER_WINDOW reads in WINDOW_MS, so the server can't be made to
// read site after site.
export const READS_PER_WINDOW = 30;
const WINDOW_MS = 10 * 60 * 1000;
const reads = new Map();

function spend(email, now = Date.now()) {
  const recent = (reads.get(email) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= READS_PER_WINDOW) { reads.set(email, recent); return false; }
  recent.push(now);
  reads.set(email, recent);
  if (reads.size > 500) for (const [k, v] of reads) if (!v.some((t) => now - t < WINDOW_MS)) reads.delete(k);
  return true;
}

async function gate(req) {
  if (!AUTH_ON) return { error: "Reading a club's website needs account login.", status: 400 };
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "unauthorized", status: 401 };
  if (viewingAs(req, email)) return { error: READ_ONLY_MESSAGE, status: 403 };
  if (isAdminEmail(email) || (await isClubAdminEmail(email))) return { email };
  const v = await resolveViewer(req, { write: true });
  if (v.error) return { error: v.message, status: v.error };
  if (v.hat?.role !== "coach") return { error: "forbidden", status: 403 };
  return { email };
}

export async function POST(req) {
  const g = await gate(req);
  if (g.error) return NextResponse.json({ error: g.error }, { status: g.status });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const action = body && typeof body === "object" ? body.action : "";
  if (action !== "site" && action !== "image") return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (typeof body.url !== "string" || !body.url.trim()) return NextResponse.json({ error: "Paste the club's website first." }, { status: 400 });
  if (!spend(g.email)) return NextResponse.json({ error: "That's a lot of reading in a short time. Wait a few minutes and try again." }, { status: 429 });

  try {
    if (action === "site") {
      const { site, candidates } = await readClubSite(body.url);
      return NextResponse.json({ ok: true, site, candidates });
    }
    const { type, bytes } = await readLogoImage(body.url);
    return NextResponse.json({ ok: true, type, picture: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` });
  } catch (e) {
    return NextResponse.json({ error: e?.siteError ? e.message : "The site couldn't be read." }, { status: 422 });
  }
}
