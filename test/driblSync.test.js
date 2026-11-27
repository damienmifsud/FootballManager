import { describe, it, expect, beforeEach, vi } from "vitest";

// lib/driblSync: the browser's part of the Dribl sync. It asks /api/dribl what
// to fetch, fetches each competition's draw from Dribl (lib/dribl fetchDribl,
// stubbed here: its own tests cover reading Dribl's answer), and posts the
// games back. The server gives nothing to fetch to someone who may not post.
const { fetchDribl } = vi.hoisted(() => ({ fetchDribl: vi.fn() }));
vi.mock("@/lib/dribl", () => ({ fetchDribl }));
import { syncDribl } from "@/lib/driblSync";

const json = (ok, status, body) => ({ ok, status, json: async () => body });
const SOURCES = [
  { comp: "cprem", name: "Premier Invitational", url: "https://mc-api.dribl.com/api/fixtures?tenant=T1&league=L1", team: "" },
  { comp: "ccup", name: "Cup", url: "https://mc-api.dribl.com/api/fixtures?tenant=T1&league=L2", team: "Olympic FC U9 White" }
];
const G = (id) => ({ squadiId: "dribl:" + id, round: 1, dateISO: "2027-03-13", time: "09:00", opponent: "Lions", homeAway: "H", venue: "", opponentLogo: "", ourLogo: "" });

let asked, saveReply, calls;
// The app's own two requests; anything else is a test mistake.
const fetchImpl = vi.fn(async (url, opts = {}) => {
  const u = String(url);
  calls.push((opts.method || "GET") + " " + u);
  if (u !== "/api/dribl") throw new Error("unexpected fetch " + u);
  if (opts.method === "POST") return typeof saveReply === "function" ? saveReply(JSON.parse(opts.body)) : saveReply;
  return asked;
});
const posted = () => fetchImpl.mock.calls.filter((c) => c[1]?.method === "POST").map((c) => JSON.parse(c[1].body));

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  asked = json(true, 200, { sources: SOURCES, due: true });
  saveReply = json(true, 200, { ok: true, matchesSeen: 3, created: 2, changes: ["NEW — Premier Invitational Round 1 vs Lions"], emailStatus: "emailed" });
  fetchDribl.mockImplementation(async (source) => (source.url.includes("L1") ? [G("a"), G("b")] : [G("c")]));
});

describe("syncDribl", () => {
  it("fetches each draw the server names and posts the games in one request", async () => {
    const out = await syncDribl({ fetchImpl });
    expect(calls).toEqual(["GET /api/dribl", "POST /api/dribl"]);
    // Each source is fetched with its own request and team name, through the same fetch.
    expect(fetchDribl.mock.calls.map((c) => c[0])).toEqual([
      { url: SOURCES[0].url, team: "" },
      { url: SOURCES[1].url, team: "Olympic FC U9 White" }
    ]);
    expect(fetchDribl.mock.calls.every((c) => c[1] === fetchImpl)).toBe(true);
    expect(posted()).toEqual([{ draws: [{ comp: "cprem", records: [G("a"), G("b")] }, { comp: "ccup", records: [G("c")] }] }]);
    expect(fetchImpl.mock.calls[1][1].headers).toEqual({ "Content-Type": "application/json" });
    expect(out).toEqual({ changes: ["NEW — Premier Invitational Round 1 vs Lions"], created: 2, failed: [], synced: 2 });
  });

  it("does nothing for someone the server gives nothing to fetch (a parent, a team with no draw on Dribl)", async () => {
    asked = json(true, 200, { sources: [], due: false });
    expect(await syncDribl({ fetchImpl })).toEqual({ skipped: "no dribl draws" });
    asked = json(true, 200, { due: true });
    expect(await syncDribl({ fetchImpl })).toEqual({ skipped: "no dribl draws" });
    asked = json(true, 200, null);
    expect(await syncDribl({ fetchImpl, force: true })).toEqual({ skipped: "no dribl draws" });
    expect(fetchDribl).not.toHaveBeenCalled();
    expect(posted()).toEqual([]);
  });

  it("does nothing when the server refuses the question (not signed in, viewing as someone)", async () => {
    for (const status of [401, 403, 409, 500]) {
      asked = json(false, status, { error: "no" });
      expect(await syncDribl({ fetchImpl, force: true })).toEqual({ skipped: "unavailable" });
    }
    expect(fetchDribl).not.toHaveBeenCalled();
    expect(posted()).toEqual([]);
  });

  it("the quiet sync waits its turn; the Sync button (force) does not", async () => {
    asked = json(true, 200, { sources: SOURCES, due: false });
    expect(await syncDribl({ fetchImpl })).toEqual({ skipped: "recent" });
    expect(fetchDribl).not.toHaveBeenCalled();
    const out = await syncDribl({ fetchImpl, force: true });
    expect(fetchDribl).toHaveBeenCalledTimes(2);
    expect(out.created).toBe(2);
  });

  it("one draw Dribl will not give is named, and the others are still posted", async () => {
    fetchDribl.mockImplementation(async (source) => { if (source.url.includes("L1")) throw new Error("Dribl responded 503"); return [G("c")]; });
    const out = await syncDribl({ fetchImpl });
    expect(posted()).toEqual([{ draws: [{ comp: "ccup", records: [G("c")] }] }]);
    expect(out.failed).toEqual([{ name: "Premier Invitational", error: "Dribl responded 503" }]);
    expect(out.changes).toHaveLength(1);
    expect(out.synced).toBe(1);
  });

  it("when no draw could be fetched nothing is posted, and each is named", async () => {
    fetchDribl.mockRejectedValue(new Error("Failed to fetch"));
    const out = await syncDribl({ fetchImpl });
    expect(posted()).toEqual([]);
    expect(out).toEqual({ changes: [], created: 0, failed: [{ name: "Premier Invitational", error: "Failed to fetch" }, { name: "Cup", error: "Failed to fetch" }], synced: 0 });
  });

  it("a draw with no games yet is still posted: the server records that the sync ran", async () => {
    fetchDribl.mockResolvedValue([]);
    saveReply = json(true, 200, { ok: true, matchesSeen: 0, created: 0, changes: [], emailStatus: "no changes" });
    const out = await syncDribl({ fetchImpl });
    expect(posted()).toEqual([{ draws: [{ comp: "cprem", records: [] }, { comp: "ccup", records: [] }] }]);
    expect(out).toEqual({ changes: [], created: 0, failed: [], synced: 2 });
  });

  it("rejects with the server's sentence when the games are refused", async () => {
    saveReply = json(false, 403, { error: "Only coaches can sync a draw." });
    await expect(syncDribl({ fetchImpl })).rejects.toThrow("Only coaches can sync a draw.");
    saveReply = json(false, 500, null);
    await expect(syncDribl({ fetchImpl })).rejects.toThrow("Dribl sync failed (500)");
    saveReply = { ok: false, status: 502, json: async () => { throw new Error("not json"); } };
    await expect(syncDribl({ fetchImpl })).rejects.toThrow("Dribl sync failed (502)");
  });

  it("reads a sparse answer safely", async () => {
    saveReply = json(true, 200, { ok: true });
    expect(await syncDribl({ fetchImpl })).toEqual({ changes: [], created: 0, failed: [], synced: 2 });
  });
});
