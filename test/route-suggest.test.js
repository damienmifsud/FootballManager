import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/suggest: the AI lineup fill. Coach-only, for the coaches an admin
// ticked on a team with Suggest on; the model call is stubbed (global fetch)
// so nothing is billed. The lineup engine finishes and checks the reply.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

const R = (GK, DEF, MID, FWD) => ({ ratings: { GK, DEF, MID, FWD }, note: "" });
const PLAYERS = [
  ["sp", "Spencer Lee", R(4, 2, 2, 1)], ["he", "Henry Ash", R(0, 4, 3, 2)], ["se", "Seyjan Rao", R(0, 3, 2, 2)],
  ["ma", "Max Bell", R(0, 2, 4, 3)], ["ol", "Oli Grant", R(0, 1, 3, 4)], ["ja", "Jack Moss", R(0, 3, 3, 3)],
  ["le", "Leo Park", R(0, 2, 2, 5)], ["ru", "Rubi Hart", R(0, 0, 2, 3)], ["ai", "Aiden Cole", R(0, 3, 1, 0)]
].map(([id, name, coach], i) => ({ id, name, number: i + 1, coach }));
const FORMAT = { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };
const DATA = (team = {}) => ({
  team: { name: "A", ageGroup: "U8", features: { suggest: true }, suggestCoaches: ["coach@a.com"], ...team },
  players: PLAYERS,
  fixtures: [{ id: "f1", dateISO: "2026-12-05", opponent: "Wests", availability: {} }]
});
const PLAN = { format: FORMAT, subTimes: [10, 30], assignments: [{ GK: "sp" }, { GK: "sp" }, { GK: "sp" }, { GK: "sp" }], opposition: "even" };
const body = (over = {}) => ({ body: { fixtureId: "f1", plan: PLAN, ...over } });

// A structured reply filling block 0 only; the engine does the rest.
const reply = (fills, why = "Leo leads the line, Henry anchors the back.", extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ fills, why }) }], ...extra }),
  text: async () => ""
});
const BLOCK0 = [{ block: 0, players: ["he", "se", "ma", "ja", "ol", "le"] }];

let savedSecret, savedKey, fetchMock;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET; savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  getData.mockResolvedValue(DATA());
  viewingAs.mockReturnValue(null);
  fetchMock = vi.fn().mockResolvedValue(reply(BLOCK0));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
});

async function loadRoute({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/suggest/route");
}
function session(email, role = "coach") {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role, ...(role === "parent" ? { playerId: "sp", playerName: "Spencer" } : {}) }] });
  teamBySlug.mockReturnValue({ slug: "a", name: "A" });
}

describe("who may use Suggest", () => {
  it("a ticked coach on a team with Suggest on gets a filled plan", async () => {
    session("coach@a.com");
    const { POST } = await loadRoute();
    const res = await POST(fakeRequest(body()));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const j = await res.json();
    expect(j.why).toBe("Leo leads the line, Henry anchors the back.");
    expect(j.assignments[0]).toMatchObject({ GK: "sp", r0c0: "he", r2c0: "le" });
    expect(j.assignments.every((s) => Object.keys(s).length === 7)).toBe(true); // the engine finished blocks 1-3
    expect(j.locked).toEqual(["0:GK", "1:GK", "2:GK", "3:GK"]);
    expect(j.receipts.map((r) => r.ruleId)).toContain("bi-period");
    expect(setData).not.toHaveBeenCalled(); // nothing is saved here
  });

  it("refuses a coach who isn't ticked, a team with it off, a parent, team-code mode and view-as", async () => {
    session("other@a.com");
    let { POST } = await loadRoute();
    expect((await POST(fakeRequest(body()))).status).toBe(403);
    session("coach@a.com");
    getData.mockResolvedValue(DATA({ features: { suggest: false } }));
    ({ POST } = await loadRoute());
    expect((await POST(fakeRequest(body()))).status).toBe(403);
    getData.mockResolvedValue(DATA());
    session("coach@a.com", "parent");
    ({ POST } = await loadRoute());
    expect((await POST(fakeRequest(body()))).status).toBe(403);
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    ({ POST } = await loadRoute({ authOn: false }));
    expect((await POST(fakeRequest(body()))).status).toBe(403);
    session("coach@a.com");
    viewingAs.mockReturnValue("coach@a.com");
    ({ POST } = await loadRoute());
    expect((await POST(fakeRequest(body()))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the model call", () => {
  it("asks for structured JSON on the configured model, with fallbacks on, and sends first names only", async () => {
    session("coach@a.com");
    const { POST } = await loadRoute();
    await POST(fakeRequest(body()));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.fallbacks).toBe("default");
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.output_config.effort).toBe("medium");
    expect(sent.messages[0].content).toMatch(/OPPOSITION THIS WEEK: ABOUT EVEN \(vs Wests\)/);
    expect(sent.messages[0].content).not.toMatch(/Spencer Lee/);
  });

  it("a plan that breaks a rule gets one rebalance round, echoing the reply back", async () => {
    session("coach@a.com");
    // Round 1 puts Rubi (DEF 0) at the back; round 2 is clean.
    fetchMock.mockResolvedValueOnce(reply([{ block: 0, players: ["ru", "se", "ma", "ja", "ol", "le"] }]))
      .mockResolvedValueOnce(reply(BLOCK0, "Fixed."));
    const { POST } = await loadRoute();
    const j = await (await POST(fakeRequest(body()))).json();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body).messages;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[2].content).toMatch(/Rubi is rated 0 in defence/);
    expect(j.why).toBe("Fixed.");
  });

  it("never moves the coach's picks, whatever the model sends", async () => {
    session("coach@a.com");
    fetchMock.mockResolvedValue(reply([{ block: 0, players: ["sp", "sp", "sp", "sp", "sp", "sp"] }, { block: 1, players: ["he", "he"] }]));
    const { POST } = await loadRoute();
    const j = await (await POST(fakeRequest(body()))).json();
    j.assignments.forEach((s) => expect(s.GK).toBe("sp"));
    j.assignments.forEach((s) => expect(new Set(Object.values(s)).size).toBe(Object.keys(s).length));
  });

  it("a refusal, an unreadable reply or an API error is an error the planner can show", async () => {
    session("coach@a.com");
    fetchMock.mockResolvedValue(reply(BLOCK0, "", { stop_reason: "refusal" }));
    let { POST } = await loadRoute();
    let res = await POST(fakeRequest(body()));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Auto-fill/);
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}), text: async () => "slow down" });
    ({ POST } = await loadRoute());
    res = await POST(fakeRequest(body()));
    expect(res.status).toBe(429);
    fetchMock.mockRejectedValue(new Error("offline"));
    ({ POST } = await loadRoute());
    expect((await POST(fakeRequest(body()))).status).toBe(502);
  });

  it("refuses when every spot is filled, or too few are in", async () => {
    session("coach@a.com");
    const { POST } = await loadRoute();
    const full = [0, 1, 2, 3].map(() => ({ GK: "sp", r0c0: "he", r0c1: "se", r1c0: "ma", r1c1: "ja", r1c2: "ol", r2c0: "le" }));
    expect((await POST(fakeRequest(body({ plan: { ...PLAN, assignments: full } })))).status).toBe(409);
    const outs = Object.fromEntries(PLAYERS.slice(3).map((p) => [p.id, "out"]));
    expect((await POST(fakeRequest(body({ plan: { ...PLAN, overrides: outs } })))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
