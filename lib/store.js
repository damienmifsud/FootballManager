// Server-side storage, scoped per team. One JSON document per team (same shape
// the dashboard already uses). Uses Upstash Redis when configured (production),
// falls back to local JSON files for `npm run dev`.
import { promises as fs } from "fs";
import path from "path";

const dataKey = (slug) => `team:${slug}:data`;
const metaKey = (slug) => `team:${slug}:meta`;
const LEGACY_DATA_KEY = "team:data"; // pre-multi-team key
const LEGACY_META_KEY = "team:meta";
const file = (slug, kind) => path.join(process.cwd(), ".data", `${slug}.${kind}.json`);

let _redis;
async function redis() {
  if (_redis !== undefined) return _redis;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  } else {
    _redis = null;
  }
  return _redis;
}

async function readFileJSON(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}
async function writeFileJSON(p, v) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(v, null, 2), "utf8");
}

// The one team allowed to inherit the pre-multi-team document (team:data /
// .data/team.json): the first env-defined team, or "default" in single-team
// SITE_PASSWORD mode. Teams created through the /admin wizard NEVER inherit
// it — a brand-new team with no document of its own must start empty, not
// as a copy of the original team. Reading TEAMS here rather than through
// lib/teams keeps the store free of a circular import.
export function legacyOwnerSlug(env = process.env) {
  if (env.TEAMS) {
    try {
      const teams = JSON.parse(env.TEAMS);
      const first = Array.isArray(teams) ? teams.find((t) => t && t.slug && t.password) : null;
      return first ? String(first.slug) : null;
    } catch { return null; }
  }
  return env.SITE_PASSWORD ? "default" : null;
}
const inheritsLegacy = (slug) => !!slug && slug === legacyOwnerSlug();

export async function getData(slug = "default") {
  const r = await redis();
  if (r) {
    let v = await r.get(dataKey(slug));
    if (!v && inheritsLegacy(slug)) {
      // One-time migration from the pre-multi-team key, for the legacy owner only.
      const legacy = await r.get(LEGACY_DATA_KEY);
      if (legacy) {
        await r.set(dataKey(slug), legacy);
        v = legacy;
      }
    }
    return v || null;
  }
  return (await readFileJSON(file(slug, "data")))
    || (inheritsLegacy(slug) ? await readFileJSON(path.join(process.cwd(), ".data", "team.json")) : null);
}

export async function setData(slug = "default", data) {
  const r = await redis();
  if (r) { await r.set(dataKey(slug), data); return; }
  await writeFileJSON(file(slug, "data"), data);
}

// Wipe one team's document and sync meta (the admin's "remove and wipe" —
// used to clear a team that was seeded with the wrong data). Never touches
// the legacy keys or any other team.
export async function deleteData(slug) {
  if (!slug) return;
  const r = await redis();
  if (r) { await r.del(dataKey(slug), metaKey(slug)); return; }
  for (const kind of ["data", "meta"]) {
    try { await fs.unlink(file(slug, kind)); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  }
}

// Teams created through the /admin wizard (same shape as TEAMS env entries).
// Env-defined teams keep working; these are merged in by lib/teams.js.
const STORED_TEAMS_KEY = "club:teams";
const storedTeamsFile = () => path.join(process.cwd(), ".data", "club.teams.json");

export async function getStoredTeams() {
  const r = await redis();
  if (r) return (await r.get(STORED_TEAMS_KEY)) || [];
  return (await readFileJSON(storedTeamsFile())) || [];
}

export async function setStoredTeams(v) {
  const r = await redis();
  if (r) { await r.set(STORED_TEAMS_KEY, v); return; }
  await writeFileJSON(storedTeamsFile(), v);
}

// Club-level access control (role overrides + managed club admins), one
// document for the whole club — edited by the super admin at /admin.
// Shape: { clubAdmins: ["email"], overrides: { "email": { "slug": "coach"|"parent"|"viewer"|"blocked" } } }
const CLUB_ACCESS_KEY = "club:access";
const clubAccessFile = () => path.join(process.cwd(), ".data", "club.access.json");

export async function getClubAccess() {
  const r = await redis();
  if (r) return (await r.get(CLUB_ACCESS_KEY)) || {};
  return (await readFileJSON(clubAccessFile())) || {};
}

export async function setClubAccess(v) {
  const r = await redis();
  if (r) { await r.set(CLUB_ACCESS_KEY, v); return; }
  await writeFileJSON(clubAccessFile(), v);
}

export async function getMeta(slug = "default") {
  const r = await redis();
  if (r) return (await r.get(metaKey(slug))) || (inheritsLegacy(slug) ? await r.get(LEGACY_META_KEY) : null) || {};
  return (await readFileJSON(file(slug, "meta"))) || {};
}

export async function setMeta(slug = "default", meta) {
  const r = await redis();
  if (r) { await r.set(metaKey(slug), meta); return; }
  await writeFileJSON(file(slug, "meta"), meta);
}
