import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail, clubPeople } from "@/lib/directory";
import { teamsFor } from "@/lib/hats";

export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// The people page in club admin: everyone with a login and what each is
// attached to. Super admin only, checked against the REAL session (viewing as
// someone never lends them this list), and only in account mode, since a
// login is an email. The page holds every family's email address, so it is
// not offered to club admins.
//
// Response: { teams: [{ slug, name }], people: [{ email, name, superAdmin,
// clubAdmin: "env" | "stored" | null, teams: lib/hats teamsFor(...),
// overrides: { slug: role } }] }. Changes go through /api/access.
export async function GET() {
  if (!AUTH_ON) return NextResponse.json({ error: "The people page needs account login (set AUTH_SECRET)." }, { status: 400 });
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { teams, people } = await clubPeople();
  return NextResponse.json({
    teams,
    people: people.map(({ email: e, name, superAdmin, clubAdmin, memberships, overrides }) => (
      { email: e, name, superAdmin, clubAdmin, teams: teamsFor(memberships), overrides }
    ))
  });
}
