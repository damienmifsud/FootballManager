import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardHost from "@/components/DashboardHost";
import { resolveTeamSlug, hasChoice } from "@/lib/hats";

const AUTH_ON = !!process.env.AUTH_SECRET;

export default async function Page() {
  // Legacy team-code mode: middleware already gated entry; just show the dashboard.
  if (!AUTH_ON) return <DashboardHost />;

  // Auth mode: resolve the signed-in email to their team(s).
  const { auth } = await import("@/auth");
  const { membershipsForEmail, isAdminEmail, isClubAdminEmail } = await import("@/lib/directory");
  const { AuthPage, AuthHeader, AuthFooter, SignOutButton } = await import("@/components/AuthShell");

  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) {
    // Safety net: if middleware didn't redirect (e.g. bare "/"), do it here
    // rather than rendering a blank page.
    return redirect("/login");
  }

  // A super admin "viewing as" someone resolves as that person (read-only —
  // the API routes refuse writes while the view_as cookie is set).
  const cookieStore = await cookies();
  const va = cookieStore.get("view_as")?.value;
  const impersonating = va && isAdminEmail(realEmail) ? decodeURIComponent(va) : null;
  const email = impersonating || realEmail;

  const { memberships } = await membershipsForEmail(email);
  if (memberships.length === 0) {
    // A brand-new club: the super admin has no memberships because there are
    // no teams yet. Point them at club admin instead of a dead end.
    // Super admins and club admins can create the first team themselves.
    const superAdmin = isAdminEmail(realEmail);
    if (!impersonating && (superAdmin || (await isClubAdminEmail(realEmail)))) {
      return (
        <AuthPage>
          <AuthHeader />
          <div className="auth-card">
            <div className="auth-card-title">No teams yet</div>
            <div className="auth-body">{superAdmin ? "You're the club's super admin." : "You're a club admin."} Create the first team to get started.</div>
            <div className="auth-links"><a href="/admin" className="auth-btn">Open club admin</a></div>
          </div>
          <AuthFooter />
        </AuthPage>
      );
    }
    return (
      <AuthPage>
        <AuthHeader />
        <div className="auth-card">
          <div className="auth-card-title">No team linked to {email}</div>
          <div className="auth-body">
            {impersonating
              ? <>You're viewing as {email}, who has no team access. Head back to <a href="/admin">/admin</a> to exit view-as.</>
              : "Ask your coach to add this email to your child's record, or to your own if you play, then sign in again."}
          </div>
          <div className="auth-links">
            {impersonating
              ? <a href="/admin" className="auth-btn soft">Back to club admin</a>
              : <SignOutButton className="auth-btn soft" />}
          </div>
        </div>
        <AuthFooter />
      </AuthPage>
    );
  }

  // Which team: the team_slug cookie if it names a team this login can open
  // (set by My teams, the Viewing-as sheet, or club admin's Open); without
  // one, the only team there is no choice about. Anything else is a choice
  // to make, on the My teams page. lib/viewer.js applies the same rule to
  // every API route, so the dashboard and its data always agree.
  //
  // Which role: the act_as cookie carries the one the session wears, and a
  // value the login doesn't hold on that team falls back to the strongest, so
  // nobody is asked up front. The header chip shows the role and the
  // Viewing-as sheet switches it.
  const slug = resolveTeamSlug(memberships, cookieStore.get("team_slug")?.value);
  if (!slug) return redirect("/teams");

  return <DashboardHost canSwitch={hasChoice(memberships)} />;
}
