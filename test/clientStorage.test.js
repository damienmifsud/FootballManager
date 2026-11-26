// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The browser's storage shim reads the team's document and, without waiting,
// sets off the two fixture syncs: Squadi's on the server, then a Dribl draw's
// here in the browser. One after the other, because both write the document.
const syncDribl = vi.fn();
vi.mock("@/lib/driblSync", () => ({ syncDribl: (...a) => syncDribl(...a) }));

const json = (ok, status, body) => ({ ok, status, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("clientStorage get", () => {
  let storage, releaseSync, order;
  beforeEach(async () => {
    order = [];
    syncDribl.mockReset();
    syncDribl.mockImplementation(async () => { order.push("dribl"); return { skipped: "no dribl draws" }; });
    const held = new Promise((r) => { releaseSync = r; });
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u === "/api/data") return json(true, 200, { team: { name: "U9" }, fixtures: [] });
      if (u === "/api/sync?ifStale=1") { order.push("squadi asked"); await held; order.push("squadi answered"); return json(true, 200, { ok: true }); }
      throw new Error("unexpected fetch " + u);
    });
    vi.resetModules();
    storage = (await import("@/lib/clientStorage")).default;
  });
  afterEach(() => { delete global.fetch; });

  it("returns the document without waiting for either sync", async () => {
    const got = await storage.get("k", true);
    expect(JSON.parse(got.value)).toEqual({ team: { name: "U9" }, fixtures: [] });
    expect(order).toEqual(["squadi asked"]); // still unanswered, and the read is done
    releaseSync();
  });

  it("asks Squadi's sync first and starts the Dribl one only once it has answered", async () => {
    await storage.get("k", true);
    await tick();
    expect(order).toEqual(["squadi asked"]);
    expect(syncDribl).not.toHaveBeenCalled();
    releaseSync();
    await vi.waitFor(() => expect(order).toEqual(["squadi asked", "squadi answered", "dribl"]));
    // The quiet sync: never forced, so the server's 15-minute throttle decides.
    expect(syncDribl).toHaveBeenCalledWith();
  });

  it("a Squadi sync that cannot be reached does not stop the Dribl one, and nothing is thrown", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (String(url) === "/api/data") return json(true, 200, { fixtures: [] });
      throw new TypeError("Failed to fetch");
    });
    await expect(storage.get("k", true)).resolves.toBeTruthy();
    await vi.waitFor(() => expect(syncDribl).toHaveBeenCalledTimes(1));
  });

  it("a Dribl sync that fails is nobody's problem: the read stands and nothing is left unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    syncDribl.mockImplementation(async () => { throw new Error("Dribl responded 503"); });
    releaseSync();
    await expect(storage.get("k", true)).resolves.toBeTruthy();
    await vi.waitFor(() => expect(syncDribl).toHaveBeenCalledTimes(1));
    await tick(); await tick();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("a read that fails sets off no sync at all", async () => {
    global.fetch.mockImplementation(async () => json(false, 500, { error: "boom" }));
    await expect(storage.get("k", true)).rejects.toThrow("boom");
    await tick();
    expect(syncDribl).not.toHaveBeenCalled();
    expect(global.fetch.mock.calls.map((c) => c[0])).toEqual(["/api/data"]);
  });
});
