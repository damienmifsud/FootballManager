"use client";
import "@/lib/clientStorage"; // sets window.storage before the dashboard mounts
import dynamic from "next/dynamic";
import Link from "next/link";

// The dashboard touches window/localStorage, so render it client-side only.
const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

export default function Page() {
  return (
    <>
      {/* Site-only shortcut to the embedded Squadi league view */}
      <Link
        href="/league"
        style={{
          position: "fixed", left: 12, bottom: 96, zIndex: 60,
          background: "rgba(24,8,12,.95)", color: "#fff", textDecoration: "none",
          fontFamily: "system-ui,sans-serif", fontSize: 12, fontWeight: 700,
          padding: "9px 13px", borderRadius: 999, border: "1px solid #45121d",
          boxShadow: "0 6px 18px rgba(20,6,10,.35)"
        }}
      >
        League ▸
      </Link>
      <Dashboard />
    </>
  );
}
