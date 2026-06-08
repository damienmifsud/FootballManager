"use client";
import { signOut } from "next-auth/react";

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
  const wrap = { minHeight: "100vh", padding: 24, fontFamily: "system-ui,sans-serif", background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff" };
  return (
    <div style={wrap}>
      <div style={{ maxWidth: 420, margin: "40px auto 0" }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Your teams</div>
        <div style={{ fontSize: 13, opacity: .85, marginBottom: 20 }}>Signed in as {email}</div>
        {memberships.map((m, i) => (
          <button key={i} onClick={() => pick(m)} style={{ width: "100%", textAlign: "left", background: "#fff", border: "none", borderRadius: 16, padding: 16, marginBottom: 12, cursor: "pointer", boxShadow: "0 10px 26px rgba(40,0,8,.28)" }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#1d1417" }}>{m.teamName}</div>
            <div style={{ fontSize: 13, color: "#7a6f72", marginTop: 2 }}>
              {m.role === "coach" ? "Coach / manager access" : `Parent of ${m.playerName}`}
            </div>
          </button>
        ))}
        <button onClick={() => signOut({ callbackUrl: "/login" })} style={{ background: "none", border: "1px solid rgba(255,255,255,.4)", color: "#fff", borderRadius: 12, padding: "10px 14px", marginTop: 8, fontWeight: 700, cursor: "pointer" }}>Sign out</button>
      </div>
    </div>
  );
}
