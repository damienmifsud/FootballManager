"use client";
// Drop-in replacement for the artifact's `window.storage`, backed by the server.
// The login cookie is sent automatically (same-origin), so no token handling here.
// The dashboard only reads/writes one shared JSON document, so we ignore the
// key/shared arguments and round-trip the whole thing through /api/data.

// 401: not signed in (or no team) -> login. 409: signed in with several
// teams and none chosen -> the team picker at "/", which sets the team_slug
// (and act_as) cookies and comes back.
function bounce(res) {
  if (res.status === 401) { window.location.href = "/login"; return true; }
  if (res.status === 409) { window.location.href = "/"; return true; }
  return false;
}

// The server's error text from a failed JSON response, or a fallback.
async function errorText(res, fallback) {
  try {
    const json = await res.json();
    if (json && typeof json.error === "string" && json.error) return json.error;
  } catch {}
  return fallback;
}

async function get() {
  const res = await fetch("/api/data", { cache: "no-store" });
  if (bounce(res)) throw new Error(res.status === 401 ? "not signed in" : "pick a team first");
  if (!res.ok) throw new Error(await errorText(res, "load failed"));
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
  if (bounce(res)) throw new Error(res.status === 401 ? "session expired" : "pick a team first");
  if (!res.ok) throw new Error(await errorText(res, "save failed"));
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
