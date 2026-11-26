import { redirect } from "next/navigation";

const AUTH_ON = !!process.env.AUTH_SECRET;

// Club access control and the team wizard. Roles are identities (emails), so
// this page only exists in account mode. Its two dead ends use the sign-in
// shell (crest, one card), like the other splashes in app/page.jsx.
export default async function AdminPage() {
  if (!AUTH_ON) {
    const { AuthPage, AuthHeader, AuthFooter } = await import("@/components/AuthShell");
    return (
      <AuthPage>
        <AuthHeader />
        <div className="auth-card">
          <div className="auth-card-title">Club admin needs account login</div>
          <div className="auth-body">The site is running in shared team-code mode. Set AUTH_SECRET (and a login provider) to use roles, then sign in as a super admin.</div>
          <div className="auth-links"><a href="/" className="auth-btn soft">Back to the team hub</a></div>
        </div>
        <AuthFooter />
      </AuthPage>
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
    const { AuthPage, AuthHeader, AuthFooter, SignOutButton } = await import("@/components/AuthShell");
    return (
      <AuthPage>
        <AuthHeader />
        <div className="auth-card">
          <div className="auth-card-title">Club admins and super admins only</div>
          <div className="auth-body">{email} isn't a super admin (ADMIN_EMAILS) or a club admin.</div>
          <div className="auth-links">
            <a href="/" className="auth-btn">Back to the team hub</a>
            <SignOutButton className="auth-btn soft" />
          </div>
        </div>
        <AuthFooter />
      </AuthPage>
    );
  }

  const AccessManager = (await import("@/components/AccessManager")).default;
  return <AccessManager adminEmail={email} scope={superAdmin ? "super" : "club"} />;
}
