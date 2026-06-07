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
