import { NextResponse } from "next/server";
import { teamByPassword } from "@/lib/teams";

export async function POST(req) {
  let password = "";
  try {
    ({ password } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const team = teamByPassword(password);
  if (!team) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, team: team.name });
  const opts = { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 };
  res.cookies.set("site_auth", team.password, { ...opts, httpOnly: true });
  // Non-httpOnly so the client can scope per-device identity (whoami) to this team.
  res.cookies.set("team_slug", team.slug, { ...opts, httpOnly: false });
  return res;
}
