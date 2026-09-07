import { redirect } from "next/navigation";

const AUTH_ON = !!process.env.AUTH_SECRET;

const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff", textAlign: "center" };

// Club access control and the team wizard. Roles are identities (emails), so
// this page only exists in account mode.
export default async function AdminPage() {
  if (!AUTH_ON) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 400 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Access control needs account login</div>
          <div style={{ fontSize: 14, opacity: .9 }}>The site is running in shared team-code mode. Set AUTH_SECRET (and a login provider) to use roles, then sign in as a super admin.</div>
        </div>
      </div>
    );
  }

  const { auth } = await import("@/auth");
  const { isAdminEmail, isClubAdminEmail } = await import("@/lib/directory");
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  // Super admins get the whole page (access control + team wizard); club
  // admins get the team wizard and the role table only.
  const superAdmin = isAdminEmail(email);
  const clubAdmin = !superAdmin && (await isClubAdminEmail(email));
  if (!superAdmin && !clubAdmin) {
    return (
      <div style={wrap}>
        <div style={{ maxWidth: 400 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Club admins and super admins only</div>
          <div style={{ fontSize: 14, opacity: .9 }}>{email} isn't a super admin (ADMIN_EMAILS) or a club admin.</div>
        </div>
      </div>
    );
  }

  const AccessManager = (await import("@/components/AccessManager")).default;
  return <AccessManager adminEmail={email} scope={superAdmin ? "super" : "club"} />;
}
