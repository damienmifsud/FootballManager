// The browser's part of the Dribl sync (see lib/dribl.js and /api/dribl).
//
// Asks the server what to fetch, fetches each competition's draw from Dribl
// here in the browser, and posts the games back to be applied. Someone who
// cannot post the result is given nothing to fetch, so this does nothing for
// a parent. `force` skips the 15-minute throttle (the Sync button); without it
// this is the quiet sync a coach's visit sets off.
//
// Resolves to { skipped } when there was nothing to do, otherwise to
// { changes, created, failed, synced }: `failed` names each draw Dribl would
// not give ([{ name, error }]), while the others are still applied; `synced`
// is how many draws were. Rejects only when the server refuses the result.
import { fetchDribl } from "@/lib/dribl";

export async function syncDribl({ force = false, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl("/api/dribl", { cache: "no-store" });
  if (!res.ok) return { skipped: "unavailable" };
  const asked = await res.json();
  const sources = Array.isArray(asked?.sources) ? asked.sources : [];
  if (!sources.length) return { skipped: "no dribl draws" };
  if (!force && !asked.due) return { skipped: "recent" };

  const draws = [], failed = [];
  for (const s of sources) {
    try { draws.push({ comp: s.comp, records: await fetchDribl({ url: s.url, team: s.team }, fetchImpl) }); }
    catch (e) { failed.push({ name: s.name, error: String(e?.message || e) }); }
  }
  if (!draws.length) return { changes: [], created: 0, failed, synced: 0 };

  const post = await fetchImpl("/api/dribl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draws }) });
  let out = null;
  try { out = await post.json(); } catch {}
  if (!post.ok) throw new Error((out && typeof out.error === "string" && out.error) || `Dribl sync failed (${post.status})`);
  return { changes: Array.isArray(out?.changes) ? out.changes : [], created: Number(out?.created) || 0, failed, synced: draws.length };
}
