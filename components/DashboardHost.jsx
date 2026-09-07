"use client";
import "@/lib/clientStorage"; // sets window.storage before the dashboard mounts
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";
import { LogOut, ArrowLeftRight } from "lucide-react";

const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

const fabStyle = (bottom) => ({
  position: "fixed", left: 12, bottom, zIndex: 60, background: "rgba(24,8,12,.95)", color: "#fff",
  fontFamily: "system-ui,sans-serif", fontSize: 12, fontWeight: 700, padding: "9px 13px",
  borderRadius: 999, border: "1px solid #45121d", boxShadow: "0 6px 18px rgba(20,6,10,.35)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6
});

// Forget the session's team + hat choice (team_slug, act_as) and any legacy
// per-device identity cookies (whoami_<slug>) so "/" shows the picker again.
const clearChoiceCookies = () => {
  const names = document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean);
  const targets = new Set(["team_slug", "act_as", ...names.filter((n) => n.startsWith("whoami_"))]);
  for (const name of targets) document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
};

// The league (Squadi embed + sync setup) page moved out of the parent-facing
// dashboard — it's reachable from the /admin page (and directly at /league).
//
// canSwitch: the signed-in person has a real choice to make — several teams,
// or several hats (coach AND parent) on one team — so offer the way back to
// the picker. A single-team, single-hat person never sees it.
export default function DashboardHost({ canSwitch = false }) {
  const switchTeam = () => {
    clearChoiceCookies();
    window.location.href = "/";
  };
  // Works in both modes: the server clears the httpOnly team-code cookie,
  // then Auth.js ends the account session (a no-op redirect in code mode).
  const logout = async () => {
    clearChoiceCookies();
    try { await fetch("/api/logout", { method: "POST" }); } catch {}
    try { await signOut({ callbackUrl: "/login" }); } catch { window.location.href = "/login"; }
  };
  return (
    <>
      <button onClick={logout} style={fabStyle(96)}><LogOut size={13} aria-hidden="true" /> Sign out</button>
      {canSwitch && (
        <button onClick={switchTeam} style={fabStyle(140)}><ArrowLeftRight size={13} aria-hidden="true" /> Switch team or role</button>
      )}
      <Dashboard />
    </>
  );
}
