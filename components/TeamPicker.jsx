"use client";
import { ChevronRight } from "lucide-react";
import { teamsFor, hatLabel, joinNames } from "@/lib/hats";
import { AuthPage, AuthHeader, SignOutButton } from "@/components/AuthShell";

// The account-mode picker: one card per DISTINCT team the signed-in email
// belongs to, and inside each card the hats held there (coach, parent of ...,
// view only). One login can wear several hats on one team — a coach whose
// child plays there is coach AND parent — so a multi-hat card offers one
// row per hat; a single-hat card is one button. Super admins and club
// admins see every team in the system (full access / view only). The choice
// lives in two plain cookies the browser sets here — team_slug and act_as —
// which the server re-validates on every request against the memberships, so
// a forged act_as can only ever narrow what the email holds, never widen it.
//
// Direction C (S10, decision D8): this is the "Viewing as" sheet as a page.
// The server needs the team_slug cookie before the dashboard can load, so
// the hat choice after sign-in can't be an in-app sheet; the rows here
// mirror the dashboard's .hs-row pattern exactly so it reads as the same
// control.

const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const setCookie = (name, value) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
};
const clearCookie = (name) => {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
};

const byName = (a, b) => String(a.teamName || "").localeCompare(String(b.teamName || ""));

const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Disc: C for a coach, the child's initials for a parent (first letters of
// each first name when there are several), V for everyone else.
const hatInitials = (hat) => {
  if (!hat || hat.role === "viewer") return "V";
  if (hat.role === "coach") return "C";
  const names = hat.playerNames || [];
  return names.length === 1 ? initials(names[0]) : (names.map((n) => firstName(n)[0] || "").join("").slice(0, 3).toUpperCase() || "P");
};
const hatSub = (hat) => {
  if (!hat) return "";
  if (hat.role === "coach") return "Edit fixtures, scores and duties";
  if (hat.role === "parent") return `Reply for ${joinNames(hat.playerNames) || "your child"} and see the team`;
  return "Read everything, change nothing";
};

export default function TeamPicker({ memberships = [], email, preselect }) {
  const pick = (slug, role) => {
    // team_slug selects the team, act_as the hat; both are validated server-side.
    setCookie("team_slug", slug);
    setCookie("act_as", role);
    // Legacy per-device identity for this team no longer applies — the hat
    // (and, for parents, the children) now comes from the account.
    clearCookie(`whoami_${slug}`);
    window.location.href = "/";
  };

  const teams = teamsFor(memberships).sort(byName);
  const first = preselect ? teams.find((t) => t.teamSlug === preselect) : null;
  const rest = first ? teams.filter((t) => t !== first) : teams;
  const clubWide = memberships.some((m) => m && (m.admin || m.clubAdmin));
  const groupLabel = clubWide ? `Club teams · ${teams.length} team${teams.length === 1 ? "" : "s"}` : "Your teams";

  // One hat row in the dashboard's .hs-row shape. The accessible name is the
  // hat label alone (aria-labelledby), the sub line its description.
  const hatRow = (teamSlug, hat, { as = "button", onClick } = {}) => {
    const id = `hat-${teamSlug}-${hat ? hat.role : "viewer"}`;
    const inner = (<>
      <span className="disc" aria-hidden="true">{hatInitials(hat)}</span>
      <span className="txt"><b id={id}>{hatLabel(hat) || "View only"}</b><span id={`${id}-sub`}>{hatSub(hat)}</span></span>
      <ChevronRight className="chev" size={18} aria-hidden="true" />
    </>);
    return as === "button"
      ? <button key={id} className="auth-row" onClick={onClick} aria-labelledby={id} aria-describedby={`${id}-sub`}>{inner}</button>
      : <span key={id} className="auth-row">{inner}</span>;
  };

  // A multi-hat card heads itself "Choose how to view X" unless the group
  // label above it already says so (the preselected team).
  const card = (team, { plainTitle = false } = {}) => {
    const { teamSlug, teamName, hats } = team;
    if (hats.length <= 1) {
      // Single hat: the whole card (team name + hat row) is the one button.
      const hat = hats[0];
      return (
        <button key={teamSlug} className="auth-team auth-team-btn" onClick={() => pick(teamSlug, hat ? hat.role : "viewer")}>
          <span className="auth-team-name">{teamName}</span>
          {hatRow(teamSlug, hat, { as: "span" })}
        </button>
      );
    }
    return (
      <div key={teamSlug} className="auth-team">
        <span className="auth-team-name">{plainTitle ? teamName : `Choose how to view ${teamName}`}</span>
        {hats.map((hat) => hatRow(teamSlug, hat, { onClick: () => pick(teamSlug, hat.role) }))}
      </div>
    );
  };

  return (
    <AuthPage>
      <AuthHeader title="Viewing as" sub={`Signed in as ${email}`} />
      <div>
        {first ? (<>
          <div className="auth-label auth-group">Choose how to view {first.teamName}</div>
          {card(first, { plainTitle: true })}
          {rest.length > 0 && <div className="auth-label auth-group">Other teams</div>}
        </>) : (
          teams.length > 0 && <div className="auth-label auth-group">{groupLabel}</div>
        )}
        {rest.map((t) => card(t))}
        <SignOutButton />
      </div>
    </AuthPage>
  );
}
