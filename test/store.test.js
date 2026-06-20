import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";

// store.js talks to Upstash Redis in production and the local filesystem in
// dev. We mock both backends with in-memory maps so the tests are hermetic and
// can assert exactly what gets read/written — including the one-time migration
// from the pre-multi-team keys, which is the path that carries an existing
// team's data over the first time TEAMS is configured.
const { redisStore, fsFiles } = vi.hoisted(() => ({ redisStore: new Map(), fsFiles: new Map() }));

vi.mock("@upstash/redis", () => ({
  // Upstash auto-(de)serialises JSON, so we round-trip objects as-is.
  Redis: class {
    async get(k) { return redisStore.has(k) ? redisStore.get(k) : null; }
    async set(k, v) { redisStore.set(k, v); }
  }
}));

vi.mock("fs", () => ({
  promises: {
    readFile: async (p) => {
      if (!fsFiles.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return fsFiles.get(p);
    },
    writeFile: async (p, v) => { fsFiles.set(p, v); },
    mkdir: async () => {}
  }
}));

// Re-import store.js per test so its memoised redis() handle and the
// env-driven backend choice are evaluated fresh.
async function loadStore() {
  vi.resetModules();
  return import("@/lib/store");
}

const dataFile = (slug) => path.join(process.cwd(), ".data", `${slug}.data.json`);
const metaFile = (slug) => path.join(process.cwd(), ".data", `${slug}.meta.json`);
const legacyFile = path.join(process.cwd(), ".data", "team.json");

const KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  redisStore.clear();
  fsFiles.clear();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function useRedis() {
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
}

describe("store — Redis backend", () => {
  beforeEach(useRedis);

  it("reads and writes per-team data under team:<slug>:data", async () => {
    const { getData, setData } = await loadStore();
    await setData("a", { x: 1 });
    expect(redisStore.get("team:a:data")).toEqual({ x: 1 });
    expect(await getData("a")).toEqual({ x: 1 });
  });

  it("returns null when a team has no data and no legacy doc to migrate", async () => {
    const { getData } = await loadStore();
    expect(await getData("a")).toBeNull();
  });

  it("migrates the pre-multi-team team:data into team:<slug>:data on first read", async () => {
    redisStore.set("team:data", { legacy: true });
    const { getData } = await loadStore();
    const v = await getData("kangaroos-white");
    expect(v).toEqual({ legacy: true });
    // The migration also persists under the new per-team key.
    expect(redisStore.get("team:kangaroos-white:data")).toEqual({ legacy: true });
  });

  it("does not adopt the legacy doc once the per-team key exists", async () => {
    redisStore.set("team:data", { legacy: true });
    redisStore.set("team:a:data", { current: true });
    const { getData } = await loadStore();
    expect(await getData("a")).toEqual({ current: true });
  });

  it("getMeta falls back to legacy meta, then to {}", async () => {
    const { getMeta } = await loadStore();
    expect(await getMeta("a")).toEqual({});

    redisStore.set("team:meta", { lastSyncAt: 123 });
    const fresh = await loadStore();
    expect(await fresh.getMeta("a")).toEqual({ lastSyncAt: 123 });
  });

  it("setMeta writes under team:<slug>:meta", async () => {
    const { setMeta } = await loadStore();
    await setMeta("a", { lastSyncAt: 9 });
    expect(redisStore.get("team:a:meta")).toEqual({ lastSyncAt: 9 });
  });

  it("defaults the slug to 'default'", async () => {
    const { getData, setData } = await loadStore();
    await setData(undefined, { d: 1 });
    expect(redisStore.get("team:default:data")).toEqual({ d: 1 });
    expect(await getData()).toEqual({ d: 1 });
  });
});

describe("store — file backend (dev, no Upstash)", () => {
  it("reads and writes a per-team JSON file", async () => {
    const { getData, setData } = await loadStore();
    await setData("a", { x: 1 });
    expect(JSON.parse(fsFiles.get(dataFile("a")))).toEqual({ x: 1 });
    expect(await getData("a")).toEqual({ x: 1 });
  });

  it("falls back to the legacy .data/team.json when the per-team file is absent", async () => {
    fsFiles.set(legacyFile, JSON.stringify({ legacy: true }));
    const { getData } = await loadStore();
    expect(await getData("a")).toEqual({ legacy: true });
  });

  it("returns null when neither the per-team nor the legacy file exists", async () => {
    const { getData } = await loadStore();
    expect(await getData("a")).toBeNull();
  });

  it("persists data as pretty-printed JSON", async () => {
    const { setData } = await loadStore();
    await setData("a", { x: 1 });
    expect(fsFiles.get(dataFile("a"))).toBe(JSON.stringify({ x: 1 }, null, 2));
  });

  it("getMeta reads the meta file or defaults to {}", async () => {
    const { getMeta, setMeta } = await loadStore();
    expect(await getMeta("a")).toEqual({});
    await setMeta("a", { lastSyncAt: 5 });
    expect(JSON.parse(fsFiles.get(metaFile("a")))).toEqual({ lastSyncAt: 5 });
    expect(await getMeta("a")).toEqual({ lastSyncAt: 5 });
  });
});
