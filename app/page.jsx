import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardHost from "@/components/DashboardHost";

const AUTH_ON = !!process.env.AUTH_SECRET;

export default async function Page() {
  // Legacy team-code mode: middleware already gated entry; just show the dashboard.
  if (!AUTH_ON) return <DashboardHost />;

  // Auth mode: resolve the signed-in email to their team(s).
  const { auth } = await import("@/auth");
  const { membershipsForEmail } = await import("@/lib/directory");
  const TeamPicker = (await import("@/components/TeamPicker")).default;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    // Safety net: if middleware didn't redirect (e.g. bare "/"), do it here
    // rather than rendering a blank page.
    redirect("/login");
  }

  const { memberships } = await membershipsForEmail(email);
  if (memberships.length === 0) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff", textAlign: "center" }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>No team linked to {email}</div>
          <div style={{ fontSize: 14, opacity: .9 }}>Ask your coach to add this email to your child's record, then sign in again.</div>
        </div>
      </div>
    );
  }

  const slug = cookies().get("team_slug")?.value;
  const current = memberships.find((m) => m.teamSlug === slug);
  if (!current) return <TeamPicker memberships={memberships} email={email} />;

  return <DashboardHost canSwitch={memberships.length > 1} />;
}
