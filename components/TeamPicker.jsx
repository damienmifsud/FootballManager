"use client";
import { signOut } from "next-auth/react";
import { teamsFor, hatLabel } from "@/lib/hats";

// The account-mode picker: one card per DISTINCT team the signed-in email
// belongs to, and inside each card the hats held there (coach, parent of ...,
// view only). One login can wear several hats on one team — a coach whose
// child plays there is coach AND parent — so a multi-hat card offers one
// button per hat; a single-hat card is one button. Super admins and club
// admins see every team in the system (full access / view only). The choice
// lives in two plain cookies the browser sets here — team_slug and act_as —
// which the server re-validates on every request against the memberships, so
// a forged act_as can only ever narrow what the email holds, never widen it.

const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const setCookie = (name, value) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
};
const clearCookie = (name) => {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
};

const byName = (a, b) => String(a.teamName || "").localeCompare(String(b.teamName || ""));

const cardStyle = { width: "100%", textAlign: "left", background: "#fff", border: "none", borderRadius: 16, padding: 16, marginBottom: 12, boxShadow: "0 10px 26px rgba(40,0,8,.28)", color: "#1d1417", fontFamily: "inherit" };
const titleStyle = { fontWeight: 800, fontSize: 16, color: "#1d1417" };
const rowStyle = { fontSize: 13, color: "#7a6f72", marginTop: 2 };
const hatButtonStyle = { display: "block", width: "100%", textAlign: "left", background: "#faf6f7", border: "1px solid #eadfe2", borderRadius: 10, padding: "10px 12px", marginTop: 8, fontSize: 14, fontWeight: 700, color: "#1d1417", cursor: "pointer", fontFamily: "inherit" };
const sectionStyle = { fontSize: 13, fontWeight: 700, opacity: .85, margin: "18px 0 10px", textTransform: "none" };

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
  const logout = () => {
    clearCookie("team_slug");
    clearCookie("act_as");
    signOut({ callbackUrl: "/login" });
  };

  const teams = teamsFor(memberships).sort(byName);
  const first = preselect ? teams.find((t) => t.teamSlug === preselect) : null;
  const rest = first ? teams.filter((t) => t !== first) : teams;
  const clubWide = memberships.some((m) => m && (m.admin || m.clubAdmin));

  const card = (team, { plainTitle = false } = {}) => {
    const { teamSlug, teamName, hats } = team;
    if (hats.length <= 1) {
      const hat = hats[0];
      return (
        <button key={teamSlug} onClick={() => pick(teamSlug, hat ? hat.role : "viewer")} style={{ ...cardStyle, cursor: "pointer" }}>
          <div style={titleStyle}>{teamName}</div>
          {hat && <div style={rowStyle}>{hatLabel(hat)}</div>}
        </button>
      );
    }
    return (
      <div key={teamSlug} style={cardStyle}>
        <div style={titleStyle}>{plainTitle ? teamName : `Choose how to view ${teamName}`}</div>
        {hats.map((hat) => (
          <button key={hat.role} onClick={() => pick(teamSlug, hat.role)} style={hatButtonStyle}>{hatLabel(hat)}</button>
        ))}
      </div>
    );
  };

  const wrap = { minHeight: "100vh", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff" };
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 420, margin: "40px auto 0" }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{clubWide ? "Club teams" : "Your teams"}</div>
        <div style={{ fontSize: 13, opacity: .85, marginBottom: 20 }}>
          Signed in as {email}{clubWide ? ` · ${teams.length} team${teams.length === 1 ? "" : "s"}` : ""}
        </div>
        {first && (
          <>
            <div style={{ ...sectionStyle, marginTop: 0 }}>Choose how to view {first.teamName}</div>
            {card(first, { plainTitle: true })}
            {rest.length > 0 && <div style={sectionStyle}>Other teams</div>}
          </>
        )}
        {rest.map((t) => card(t))}
        <button onClick={logout} style={{ background: "none", border: "1px solid rgba(255,255,255,.4)", color: "#fff", borderRadius: 12, padding: "10px 14px", marginTop: 8, fontWeight: 700, cursor: "pointer" }}>Sign out</button>
      </div>
    </div>
  );
}
