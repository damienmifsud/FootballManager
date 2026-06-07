// Server-side storage. One JSON document holds the whole team (same shape the
// dashboard already uses). Uses Upstash Redis when configured (production), and
// falls back to a local JSON file for `npm run dev`.
import { promises as fs } from "fs";
import path from "path";

const KEY = "team:data";
const FILE = path.join(process.cwd(), ".data", "team.json");

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

export async function getData() {
  const r = await redis();
  if (r) {
    const v = await r.get(KEY); // @upstash/redis returns the parsed object
    return v || null;
  }
  try {
    const txt = await fs.readFile(FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function setData(data) {
  const r = await redis();
  if (r) {
    await r.set(KEY, data);
    return;
  }
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

// Sync metadata lives under its own key so frequent timestamp writes can never
// race or clobber the team document itself.
const META_KEY = "team:meta";
const META_FILE = path.join(process.cwd(), ".data", "meta.json");

export async function getMeta() {
  const r = await redis();
  if (r) return (await r.get(META_KEY)) || {};
  try {
    return JSON.parse(await fs.readFile(META_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function setMeta(meta) {
  const r = await redis();
  if (r) {
    await r.set(META_KEY, meta);
    return;
  }
  await fs.mkdir(path.dirname(META_FILE), { recursive: true });
  await fs.writeFile(META_FILE, JSON.stringify(meta), "utf8");
}
