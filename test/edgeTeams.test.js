import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { storedPasswords, clearStoredPasswordsCache } from "@/lib/edgeTeams";

// Edge-safe stored-team password lookup used by the middleware cookie check:
// talks straight to Upstash REST (no fs), caches per isolate, fails safe.
const KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  clearStoredPasswordsCache();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const upstashOk = (teams) => ({ ok: true, json: async () => ({ result: JSON.stringify(teams) }) });

describe("storedPasswords", () => {
  it("returns [] without Upstash env (dev file mode) and never fetches", async () => {
    expect(await storedPasswords()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads club:teams over REST and extracts the passwords", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    fetch.mockResolvedValue(upstashOk([{ slug: "b", password: "code-b" }, { slug: "x" }]));
    expect(await storedPasswords()).toEqual(["code-b"]);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://redis.test/get/club:teams");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("caches results (one fetch for consecutive calls)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    fetch.mockResolvedValue(upstashOk([{ slug: "b", password: "code-b" }]));
    await storedPasswords();
    await storedPasswords();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list when the fetch fails", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    fetch.mockResolvedValue(upstashOk([{ slug: "b", password: "code-b" }]));
    await storedPasswords();
    clearStoredPasswordsCache(); // force a re-read...
    fetch.mockRejectedValue(new Error("network"));
    // ...which fails; cache was cleared so we get the (empty) fallback rather than a throw.
    expect(await storedPasswords()).toEqual([]);
  });

  it("handles an empty key (no stored teams yet)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    fetch.mockResolvedValue({ ok: true, json: async () => ({ result: null }) });
    expect(await storedPasswords()).toEqual([]);
  });
});
