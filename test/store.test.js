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
    async del(...keys) { keys.forEach((k) => redisStore.delete(k)); }
  }
}));

vi.mock("fs", () => ({
  promises: {
    readFile: async (p) => {
      if (!fsFiles.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return fsFiles.get(p);
    },
    writeFile: async (p, v) => { fsFiles.set(p, v); },
    unlink: async (p) => {
      if (!fsFiles.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      fsFiles.delete(p);
    },
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

// TEAMS / SITE_PASSWORD decide which ONE team may inherit the pre-multi-team
// document; every test starts with neither set (no team inherits).
const KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "TEAMS", "SITE_PASSWORD"];
const envFirstTeam = (slug) => { process.env.TEAMS = JSON.stringify([{ slug, name: "First", password: "code-1" }, { slug: "second", name: "Second", password: "code-2" }]); };
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

  it("migrates the pre-multi-team team:data into team:<slug>:data on first read — for the FIRST env-defined team only", async () => {
    envFirstTeam("kangaroos-white");
    redisStore.set("team:data", { legacy: true });
    const { getData } = await loadStore();
    const v = await getData("kangaroos-white");
    expect(v).toEqual({ legacy: true });
    // The migration also persists under the new per-team key.
    expect(redisStore.get("team:kangaroos-white:data")).toEqual({ legacy: true });
  });

  it("a second env team, a wizard-created team and an unknown slug never inherit the legacy doc (the cross-team leak)", async () => {
    envFirstTeam("kangaroos-white");
    redisStore.set("team:data", { legacy: true, team: { name: "Original" } });
    const { getData } = await loadStore();
    // A brand-new team must read as EMPTY so the wizard seeds it, not as a
    // copy of the original team's document.
    expect(await getData("second")).toBeNull();
    expect(await getData("u9-blue")).toBeNull();
    expect(redisStore.has("team:second:data")).toBe(false);
    expect(redisStore.has("team:u9-blue:data")).toBe(false);
    // No env teams at all (wizard-only club): nobody inherits.
    delete process.env.TEAMS;
    const fresh = await loadStore();
    expect(await fresh.getData("kangaroos-white")).toBeNull();
  });

  it("single-team SITE_PASSWORD mode: only 'default' inherits", async () => {
    process.env.SITE_PASSWORD = "code";
    redisStore.set("team:data", { legacy: true });
    const { getData } = await loadStore();
    expect(await getData("u9-blue")).toBeNull();
    expect(await getData("default")).toEqual({ legacy: true });
  });

  it("does not adopt the legacy doc once the per-team key exists", async () => {
    envFirstTeam("a");
    redisStore.set("team:data", { legacy: true });
    redisStore.set("team:a:data", { current: true });
    const { getData } = await loadStore();
    expect(await getData("a")).toEqual({ current: true });
  });

  it("getMeta falls back to legacy meta only for the legacy owner, then to {}", async () => {
    const { getMeta } = await loadStore();
    expect(await getMeta("a")).toEqual({});

    redisStore.set("team:meta", { lastSyncAt: 123 });
    const fresh = await loadStore();
    expect(await fresh.getMeta("a")).toEqual({}); // not the owner: no inherited sync clock
    envFirstTeam("a");
    const owner = await loadStore();
    expect(await owner.getMeta("a")).toEqual({ lastSyncAt: 123 });
  });

  it("deleteData wipes one team's data and meta and nothing else", async () => {
    const { setData, setMeta, deleteData, getData, getMeta } = await loadStore();
    await setData("a", { x: 1 }); await setMeta("a", { lastSyncAt: 1 });
    await setData("b", { y: 2 });
    redisStore.set("team:data", { legacy: true });
    await deleteData("a");
    expect(await getData("a")).toBeNull();
    expect(await getMeta("a")).toEqual({});
    expect(await getData("b")).toEqual({ y: 2 });
    expect(redisStore.get("team:data")).toEqual({ legacy: true });
  });

  it("legacyOwnerSlug reads the env directly", async () => {
    const { legacyOwnerSlug } = await loadStore();
    expect(legacyOwnerSlug({})).toBeNull();
    expect(legacyOwnerSlug({ SITE_PASSWORD: "x" })).toBe("default");
    expect(legacyOwnerSlug({ TEAMS: JSON.stringify([{ slug: "k", password: "p" }]), SITE_PASSWORD: "x" })).toBe("k");
    expect(legacyOwnerSlug({ TEAMS: "{bad" })).toBeNull();
    expect(legacyOwnerSlug({ TEAMS: "[]" })).toBeNull();
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

describe("store — wizard teams doc", () => {
  it("redis: defaults to [] and round-trips under club:teams", async () => {
    useRedis();
    const { getStoredTeams, setStoredTeams } = await loadStore();
    expect(await getStoredTeams()).toEqual([]);
    const teams = [{ slug: "b", name: "Team B", password: "code-b" }];
    await setStoredTeams(teams);
    expect(redisStore.get("club:teams")).toEqual(teams);
    expect(await getStoredTeams()).toEqual(teams);
  });

  it("file backend: persists to .data/club.teams.json", async () => {
    const { getStoredTeams, setStoredTeams } = await loadStore();
    expect(await getStoredTeams()).toEqual([]);
    await setStoredTeams([{ slug: "b", name: "B", password: "p" }]);
    const p = path.join(process.cwd(), ".data", "club.teams.json");
    expect(JSON.parse(fsFiles.get(p))).toEqual([{ slug: "b", name: "B", password: "p" }]);
  });
});

describe("store — club access doc", () => {
  it("redis: defaults to {} and round-trips the doc under club:access", async () => {
    useRedis();
    const { getClubAccess, setClubAccess } = await loadStore();
    expect(await getClubAccess()).toEqual({});
    const doc = { clubAdmins: ["td@club.com"], overrides: { "x@y.com": { a: "viewer" } } };
    await setClubAccess(doc);
    expect(redisStore.get("club:access")).toEqual(doc);
    expect(await getClubAccess()).toEqual(doc);
  });

  it("file backend: defaults to {} and persists to .data/club.access.json", async () => {
    const { getClubAccess, setClubAccess } = await loadStore();
    expect(await getClubAccess()).toEqual({});
    await setClubAccess({ clubAdmins: ["td@club.com"] });
    const p = path.join(process.cwd(), ".data", "club.access.json");
    expect(JSON.parse(fsFiles.get(p))).toEqual({ clubAdmins: ["td@club.com"] });
    expect(await getClubAccess()).toEqual({ clubAdmins: ["td@club.com"] });
  });
});

describe("store — file backend (dev, no Upstash)", () => {
  it("reads and writes a per-team JSON file", async () => {
    const { getData, setData } = await loadStore();
    await setData("a", { x: 1 });
    expect(JSON.parse(fsFiles.get(dataFile("a")))).toEqual({ x: 1 });
    expect(await getData("a")).toEqual({ x: 1 });
  });

  it("falls back to the legacy .data/team.json only for the legacy owner", async () => {
    fsFiles.set(legacyFile, JSON.stringify({ legacy: true }));
    const { getData } = await loadStore();
    expect(await getData("a")).toBeNull(); // a wizard team stays empty
    envFirstTeam("a");
    const owner = await loadStore();
    expect(await owner.getData("a")).toEqual({ legacy: true });
    expect(await owner.getData("second")).toBeNull();
  });

  it("returns null when neither the per-team nor the legacy file exists", async () => {
    const { getData } = await loadStore();
    expect(await getData("a")).toBeNull();
  });

  it("deleteData unlinks the team's files and tolerates a missing one", async () => {
    const { setData, setMeta, deleteData, getData, getMeta } = await loadStore();
    await setData("a", { x: 1 }); await setMeta("a", { lastSyncAt: 1 });
    await deleteData("a");
    expect(fsFiles.has(dataFile("a"))).toBe(false);
    expect(fsFiles.has(metaFile("a"))).toBe(false);
    expect(await getData("a")).toBeNull();
    expect(await getMeta("a")).toEqual({});
    await expect(deleteData("never-existed")).resolves.toBeUndefined();
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
