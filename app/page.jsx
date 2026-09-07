import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashboardHost from "@/components/DashboardHost";
import { teamsFor, hatsFor, hasChoice } from "@/lib/hats";

const AUTH_ON = !!process.env.AUTH_SECRET;

const splash = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff", textAlign: "center" };

export default async function Page() {
  // Legacy team-code mode: middleware already gated entry; just show the dashboard.
  if (!AUTH_ON) return <DashboardHost />;

  // Auth mode: resolve the signed-in email to their team(s).
  const { auth } = await import("@/auth");
  const { membershipsForEmail, isAdminEmail } = await import("@/lib/directory");
  const TeamPicker = (await import("@/components/TeamPicker")).default;

  const session = await auth();
  const realEmail = session?.user?.email;
  if (!realEmail) {
    // Safety net: if middleware didn't redirect (e.g. bare "/"), do it here
    // rather than rendering a blank page.
    redirect("/login");
  }

  // A super admin "viewing as" someone resolves as that person (read-only —
  // the API routes refuse writes while the view_as cookie is set).
  const cookieStore = await cookies();
  const va = cookieStore.get("view_as")?.value;
  const impersonating = va && isAdminEmail(realEmail) ? decodeURIComponent(va) : null;
  const email = impersonating || realEmail;
  const emailLabel = impersonating ? `${email} (viewing as)` : email;

  const { memberships } = await membershipsForEmail(email);
  if (memberships.length === 0) {
    // A brand-new club: the super admin has no memberships because there are
    // no teams yet. Point them at club admin instead of a dead end.
    if (!impersonating && isAdminEmail(realEmail)) {
      return (
        <div style={splash}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>No teams yet</div>
            <div style={{ fontSize: 14, opacity: .9, marginBottom: 16 }}>You're the club's super admin. Create the first team to get started.</div>
            <a href="/admin" style={{ display: "inline-block", background: "#fff", color: "#7A0A1B", borderRadius: 12, padding: "10px 16px", fontWeight: 700, textDecoration: "none" }}>Open club admin</a>
          </div>
        </div>
      );
    }
    return (
      <div style={splash}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>No team linked to {email}</div>
          <div style={{ fontSize: 14, opacity: .9 }}>
            {impersonating
              ? <>You're viewing as {email}, who has no team access. Head back to <a href="/admin" style={{ color: "#fff" }}>/admin</a> to exit view-as.</>
              : "Ask your coach to add this email to your child's record, then sign in again."}
          </div>
        </div>
      </div>
    );
  }

  // Which team: the team_slug cookie if it names a team this email belongs to;
  // a lone team needs no choice; otherwise the picker.
  const teams = teamsFor(memberships);
  const slugCookie = cookieStore.get("team_slug")?.value;
  const slug = teams.some((t) => t.teamSlug === slugCookie)
    ? slugCookie
    : (teams.length === 1 ? teams[0].teamSlug : null);
  if (!slug) return <TeamPicker memberships={memberships} email={emailLabel} />;

  // Which hat: one login can hold several roles on one team (a coach whose
  // child plays there is coach AND parent). The act_as cookie carries the hat
  // the session wears; lib/viewer.js re-validates it on every request and a
  // value the email doesn't hold falls back to the strongest hat, so the
  // cookie can only narrow. A multi-hat person with no valid act_as yet is
  // asked once (picker preselected on their team); a single-hat person never
  // is — there's nothing to choose.
  const hats = hatsFor(memberships, slug);
  const actAs = cookieStore.get("act_as")?.value;
  if (hats.length > 1 && !hats.some((h) => h.role === actAs)) {
    return <TeamPicker memberships={memberships} email={emailLabel} preselect={slug} />;
  }

  return <DashboardHost canSwitch={hasChoice(memberships)} />;
}
