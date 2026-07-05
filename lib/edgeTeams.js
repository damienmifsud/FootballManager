// Edge-safe lookup of wizard-created team passwords for the middleware's
// legacy-mode cookie check. lib/teams.js can't run in middleware (its store
// pulls in fs for the dev fallback), so this talks straight to Upstash's REST
// API with a short in-memory cache per edge isolate. Without Upstash env vars
// (e.g. local dev on the file store) there are no stored passwords here and
// env-defined teams still gate as before.
let _cache = { at: 0, passwords: [] };
const CACHE_MS = 60 * 1000;
export function clearStoredPasswordsCache() { _cache = { at: 0, passwords: [] }; }

export async function storedPasswords() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return [];
  if (Date.now() - _cache.at < CACHE_MS) return _cache.passwords;
  try {
    const res = await fetch(`${url}/get/club:teams`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const j = await res.json();
    // @upstash/redis JSON-serialises values on set; REST returns that string.
    const teams = j?.result ? JSON.parse(j.result) : [];
    _cache = {
      at: Date.now(),
      passwords: (Array.isArray(teams) ? teams : []).map((t) => t && t.password).filter(Boolean)
    };
  } catch {
    // Keep whatever we had; retry after the TTL.
    _cache = { at: Date.now(), passwords: _cache.passwords };
  }
  return _cache.passwords;
}
