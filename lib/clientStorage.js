"use client";
// Drop-in replacement for the artifact's `window.storage`, backed by the server.
// The login cookie is sent automatically (same-origin), so no token handling here.
// The dashboard only reads/writes one shared JSON document, so we ignore the
// key/shared arguments and round-trip the whole thing through /api/data.

async function get() {
  const res = await fetch("/api/data", { cache: "no-store" });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("not signed in"); }
  if (!res.ok) throw new Error("load failed");
  const data = await res.json();
  // Keep the schedule fresh: quietly trigger a Squadi sync in the background.
  // The server throttles this to at most once per 15 minutes, and any changes
  // will be visible on the next load.
  try { fetch("/api/sync?ifStale=1").catch(() => {}); } catch {}
  if (data == null) return null;
  return { value: JSON.stringify(data), shared: true };
}

async function set(_key, value) {
  const res = await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof value === "string" ? value : JSON.stringify(value)
  });
  if (res.status === 401) { window.location.href = "/login"; throw new Error("session expired"); }
  if (!res.ok) throw new Error("save failed");
  return { ok: true };
}

const storage = {
  get,
  set,
  delete: async () => ({ deleted: true }),
  list: async () => ({ keys: [] })
};

if (typeof window !== "undefined") {
  window.storage = storage;
}

export default storage;

// Per-device "who's responding" identity for attendance attribution.
// Scoped per team (whoami_<slug>) so a parent with kids in multiple teams — or
// anyone switching team codes — never carries the wrong child's identity across.
// Stored in a plain cookie (not the team document); kept in this site shim so the
// dashboard component stays storage-API-free.
if (typeof window !== "undefined") {
  const slug = () => {
    const m = document.cookie.match(/(?:^|;\s*)team_slug=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "default";
  };
  window.identityGet = () => {
    try {
      const m = document.cookie.match(new RegExp("(?:^|;\\s*)whoami_" + slug() + "=([^;]+)"));
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch { return null; }
  };
  window.identitySet = (v) => {
    try {
      const val = encodeURIComponent(JSON.stringify(v || { kind: "guest" }));
      document.cookie = `whoami_${slug()}=${val}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    } catch {}
  };
}
