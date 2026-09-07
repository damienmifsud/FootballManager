"use client";
import "@/lib/clientStorage"; // sets window.storage before the dashboard mounts
import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("@/components/Dashboard"), { ssr: false });

// Thin client host for the dashboard. Team and hat switching, sign out and the
// club admin link all live in the dashboard's own context bar under the
// header (components/Dashboard.jsx), so nothing floats over the content.
// canSwitch is accepted for compatibility with app/page.jsx; the bar decides
// what to show from /api/me.
export default function DashboardHost({ canSwitch = false }) { // eslint-disable-line no-unused-vars
  return <Dashboard />;
}
