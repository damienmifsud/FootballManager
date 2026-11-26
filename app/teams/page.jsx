import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { teamsFor } from "@/lib/hats";
import { hasFamilyOnSeveralTeams } from "@/lib/familyWeek";

// Always per request: who is signed in, and what they are on, decides the page.
export const dynamic = "force-dynamic";

const AUTH_ON = !!process.env.AUTH_SECRET;

// My teams: the teams the signed-in person is on themselves, and for the
// people who run the club, the way into club admin. A family on two or more
// teams also gets them together on this page (the next two weeks, with
// replies), and chooses between that and one team at a time. Reached from the
// Viewing-as sheet's Switch team, and from the home page when there is more
// than one team to choose from. Roles are identities (emails), so the page
// only exists in account mode.
export default async function TeamsPage() {
  if (!AUTH_ON) return redirect("/");

  const { auth } = await import("@/auth");
  const { membershipsForEmail, isAdminEmail, isClubAdminEmail } = await import("@/lib/directory");
  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) return redirect("/login");

  // A super admin "viewing as" someone sees that person's teams (read only),
  // without the club section: it is their view, not the admin's.
  const cookieStore = await cookies();
  const va = cookieStore.get("view_as")?.value;
  const impersonating = va && isAdminEmail(realEmail) ? decodeURIComponent(va) : null;
  const email = impersonating || realEmail;

  const { memberships } = await membershipsForEmail(email);
  const admin = impersonating ? null : isAdminEmail(realEmail) ? "super" : (await isClubAdminEmail(realEmail)) ? "club" : null;
  // No team and nothing to run: the home page says what to do next.
  if (memberships.length === 0 && !admin) return redirect("/");

  const MyTeams = (await import("@/components/MyTeams")).default;
  return <MyTeams teams={teamsFor(memberships)} email={impersonating ? `${email} (viewing as)` : email} admin={admin} viewingAs={!!impersonating}
    family={hasFamilyOnSeveralTeams(memberships)} />;
}
