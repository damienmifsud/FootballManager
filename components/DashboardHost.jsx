"use client";
import "@/lib/clientStorage"; // sets window.storage before the dashboard mounts
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";

const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

const fabStyle = (bottom) => ({
  position: "fixed", left: 12, bottom, zIndex: 60, background: "rgba(24,8,12,.95)", color: "#fff",
  fontFamily: "system-ui,sans-serif", fontSize: 12, fontWeight: 700, padding: "9px 13px",
  borderRadius: 999, border: "1px solid #45121d", boxShadow: "0 6px 18px rgba(20,6,10,.35)", cursor: "pointer"
});

// The league (Squadi embed + sync setup) page moved out of the parent-facing
// dashboard — it's reachable from the /admin page (and directly at /league).
export default function DashboardHost({ canSwitch = false }) {
  const switchTeam = () => {
    document.cookie = "team_slug=; path=/; max-age=0; samesite=lax";
    window.location.href = "/";
  };
  // Works in both modes: the server clears the httpOnly team-code cookie,
  // then Auth.js ends the account session (a no-op redirect in code mode).
  const logout = async () => {
    try { await fetch("/api/logout", { method: "POST" }); } catch {}
    try { await signOut({ callbackUrl: "/login" }); } catch { window.location.href = "/login"; }
  };
  return (
    <>
      <button onClick={logout} style={fabStyle(96)}>↪ Sign out</button>
      {canSwitch && (
        <button onClick={switchTeam} style={fabStyle(140)}>⇄ Switch team</button>
      )}
      <Dashboard />
    </>
  );
}
