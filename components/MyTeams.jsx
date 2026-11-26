"use client";
import { ChevronRight, Settings } from "lucide-react";
import { hatLabel } from "@/lib/hats";
import { AuthPage, AuthHeader, SignOutButton } from "@/components/AuthShell";
import FamilyWeek from "@/components/FamilyWeek";

// My teams (account mode, /teams): the teams the signed-in person is on
// themselves, one card each, with the roles they hold there as pills. A
// coach's own team, a parent's children's teams, a team they play in (signed
// in with their own email as a player), a team the super admin gave them a
// role on. Tapping a card opens that team in the strongest role held
// there; the Viewing-as sheet inside the team switches between roles.
//
// Running the club is not the same as being on every team in it, so a super
// admin or club admin sees only their own teams here and reaches the rest
// (and the people and access screens) through the Club admin link below.
//
// A family on two or more teams (a child in each, or their own team and their
// child's) also gets both together above the cards: the next two weeks across
// those teams, with replies given from here (components/FamilyWeek.jsx). They
// choose between that and one team at a time, and the cards always open one.
//
// The choice lives in two plain cookies the browser sets here, team_slug and
// act_as, which the server re-validates on every request against the
// memberships: a forged value can only ever narrow what the login holds.

const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const setCookie = (name, value) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
};
const clearCookie = (name) => {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
};

const byName = (a, b) => String(a.teamName || "").localeCompare(String(b.teamName || ""));
// Staff green, family blue, anything else plain: the same tints as the club admin screens.
const pillClass = (hat) => (hat.role === "coach" ? " staff" : hat.role === "parent" ? " family" : "");

// teams: lib/hats teamsFor() for this login (every team it can open; the ones
// with `mine` are listed). admin: "super" | "club" | null. viewingAs: a super
// admin is looking at this page as someone else. family: this login has a
// family on two or more teams, so the page offers them together.
export default function MyTeams({ teams = [], email, admin = null, viewingAs = false, family = false }) {
  const open = (team) => {
    setCookie("team_slug", team.teamSlug);
    // Strongest role first; the server falls back to it anyway if this is not held.
    setCookie("act_as", team.hats?.[0]?.role || "viewer");
    // A per-device identity from team-code days must not outlive the account's role.
    clearCookie(`whoami_${team.teamSlug}`);
    window.location.href = "/";
  };

  const mine = teams.filter((t) => t.mine).sort(byName);
  const count = teams.length;
  const clubSub = count === 0 ? "Create the first team"
    : `${count === 1 ? "The club's team" : `All ${count} teams`}${admin === "super" ? " and who can do what" : ""}`;

  return (
    <AuthPage>
      <AuthHeader title="My teams" sub={`Signed in as ${email}`} />
      {family && <FamilyWeek />}
      <div>
        {family && mine.length > 0 && <div className="auth-label auth-group">Open a team</div>}
        {mine.map((team) => {
          const roles = (team.hats || []).filter((h) => !h.club);
          return (
            <button key={team.teamSlug} className="auth-team auth-team-btn auth-mine" onClick={() => open(team)}
              aria-label={`${team.teamName}: ${roles.map(hatLabel).join(", ")}`}>
              <span className="auth-mine-top">
                <span className="auth-team-name">{team.teamName}</span>
                <ChevronRight className="chev" size={18} aria-hidden="true" />
              </span>
              <span className="auth-pills">
                {roles.map((h) => <span key={h.role} className={"auth-pill" + pillClass(h)}>{hatLabel(h)}</span>)}
              </span>
            </button>
          );
        })}
        {mine.length === 0 && (
          <div className="auth-card auth-none">
            <div className="auth-card-title">{admin ? "You're not on a team yourself" : "No team is linked to this login yet"}</div>
            <div className="auth-body">
              {admin ? "Open any team from club admin." : "Ask your coach to add this email to your child's record, or to your own if you play, then sign in again."}
            </div>
          </div>
        )}
        {admin && (<>
          <div className="auth-label auth-group auth-club-label">Club</div>
          <a className="auth-team auth-row auth-club" href="/admin">
            <span className="ico" aria-hidden="true"><Settings size={17} /></span>
            <span className="txt"><b>Club admin</b><span>{clubSub}</span></span>
            <ChevronRight className="chev" size={18} aria-hidden="true" />
          </a>
        </>)}
        {viewingAs && <a className="auth-btn soft" style={{ textDecoration: "none" }} href="/admin">Back to club admin</a>}
        <SignOutButton />
      </div>
    </AuthPage>
  );
}
