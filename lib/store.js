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

export async function getData(slug = "default") {
  const r = await redis();
  if (r) {
    let v = await r.get(dataKey(slug));
    if (!v) {
      // One-time migration from the pre-multi-team key (first/legacy team only).
      const legacy = await r.get(LEGACY_DATA_KEY);
      if (legacy) {
        await r.set(dataKey(slug), legacy);
        v = legacy;
      }
    }
    return v || null;
  }
  return (await readFileJSON(file(slug, "data")))
    || (slug && (await readFileJSON(path.join(process.cwd(), ".data", "team.json"))));
}

export async function setData(slug = "default", data) {
  const r = await redis();
  if (r) { await r.set(dataKey(slug), data); return; }
  await writeFileJSON(file(slug, "data"), data);
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
  if (r) return (await r.get(metaKey(slug))) || (await r.get(LEGACY_META_KEY)) || {};
  return (await readFileJSON(file(slug, "meta"))) || {};
}

export async function setMeta(slug = "default", meta) {
  const r = await redis();
  if (r) { await r.set(metaKey(slug), meta); return; }
  await writeFileJSON(file(slug, "meta"), meta);
}
