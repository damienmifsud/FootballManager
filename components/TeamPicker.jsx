"use client";
import { signOut } from "next-auth/react";

// The account-mode team list. Parents see the team(s) their kids play in;
// coaches their teams; super admins and club admins see EVERY team in the
// system (their memberships span all teams) and can jump into any of them —
// full access for the super admin, view-only for a club admin. The server
// enforces the role on every request regardless of what's picked here.
const roleLabel = (m) => {
  if (m.admin) return "Super admin — full access";
  if (m.role === "coach") return "Coach / manager access";
  if (m.role === "parent") return `Parent of ${m.playerName || "your player"}`;
  if (m.clubAdmin) return "Club admin — view only";
  return "View only";
};

export default function TeamPicker({ memberships, email }) {
  const pick = (m) => {
    // team_slug selects the team (server validates against memberships on every request).
    document.cookie = `team_slug=${encodeURIComponent(m.teamSlug)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    // For parents, also pre-bind the attendance identity to their child — no kid-picking.
    if (m.role === "parent" && m.playerId) {
      const who = encodeURIComponent(JSON.stringify({ kind: "parent", pid: m.playerId, label: m.playerName }));
      document.cookie = `whoami_${m.teamSlug}=${who}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    }
    window.location.href = "/";
  };
  const list = [...memberships].sort((a, b) => String(a.teamName).localeCompare(String(b.teamName)));
  const clubWide = memberships.some((m) => m.admin || m.clubAdmin);
  const wrap = { minHeight: "100vh", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff" };
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 420, margin: "40px auto 0" }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{clubWide ? "Club teams" : "Your teams"}</div>
        <div style={{ fontSize: 13, opacity: .85, marginBottom: 20 }}>
          Signed in as {email}{clubWide ? ` · ${list.length} team${list.length === 1 ? "" : "s"}` : ""}
        </div>
        {list.map((m, i) => (
          <button key={i} onClick={() => pick(m)} style={{ width: "100%", textAlign: "left", background: "#fff", border: "none", borderRadius: 16, padding: 16, marginBottom: 12, cursor: "pointer", boxShadow: "0 10px 26px rgba(40,0,8,.28)" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#1d1417" }}>{m.teamName}</div>
            <div style={{ fontSize: 13, color: "#7a6f72", marginTop: 2 }}>{roleLabel(m)}</div>
          </button>
        ))}
        <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ background: "none", border: "1px solid rgba(255,255,255,.4)", color: "#fff", borderRadius: 12, padding: "10px 14px", marginTop: 8, fontWeight: 700, cursor: "pointer" }}>Sign out</button>
      </div>
    </div>
  );
}
