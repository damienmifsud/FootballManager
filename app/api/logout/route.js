import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Clears the legacy team-code session. site_auth is httpOnly (client JS can't
// remove it), so signing out needs this server round-trip; team_slug goes too
// so the next login starts clean. Account-mode sessions are ended separately
// via Auth.js signOut() — the dashboard's Sign out button does both.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  const opts = { path: "/", maxAge: 0, sameSite: "lax" };
  res.cookies.set("site_auth", "", { ...opts, httpOnly: true });
  res.cookies.set("team_slug", "", opts);
  return res;
}
