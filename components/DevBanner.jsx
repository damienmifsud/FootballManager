// The strip across the top of every page of a development site (APP_ENV=
// development), so it's never taken for the real one. Nothing on the real site.
import { isDevSite } from "@/lib/siteEnv";

export default function DevBanner({ env = process.env }) {
  if (!isDevSite(env)) return null;
  return (
    <div role="note" style={{
      background: "#1F3A5F", color: "#fff", font: "600 12px/1.35 system-ui, -apple-system, sans-serif",
      textAlign: "center", padding: "6px 12px", paddingTop: "max(6px, env(safe-area-inset-top))"
    }}>
      Development site, for testing. Changes here don't touch the real site, and it sends no emails.
    </div>
  );
}
