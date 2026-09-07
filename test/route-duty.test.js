import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/duty writes ONE fixture's fruit / gk / jersey duty and nothing else
// (S7, D6). The worn hat decides: a coach hat may set or clear any duty, a
// parent hat may claim or release fruit and jersey for their own child only,
// a viewer nothing; legacy team-code mode trusts any code holder. D4: setting
// the keeper also fills the plan's block-1 GK slot when the plan has one.
// AUTH_ON is module-load state, so each block re-imports the route.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

const DATA = () => ({
  team: { name: "A" },
  players: [{ id: "p1", name: "Sam" }, { id: "p2", name: "Ella" }, { id: "p3", name: "Leo" }],
  fixtures: [
    // f1: fruit taken by p2 (another family), keeper p1, a plan with a GK slot.
    { id: "f1", round: 1, us: 3, them: 1, fruit: "p2", gk: "p1", availability: { p1: { status: "in" } }, plan: { subTimes: [10], assignments: [{ GK: "p1", DEF1: "p2" }, { GK: "p2" }], updatedAt: 1 } },
    // f2: nothing assigned, no plan.
    { id: "f2", round: 2 },
    // f3: fruit held by p1 (Sam's family), plan whose first block has no GK key.
    { id: "f3", round: 3, fruit: "p1", plan: { assignments: [{ DEF1: "p2" }] } }
  ]
});

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
  viewingAs.mockReturnValue(null);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/duty/route");
}

function coachSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
}
// Sam's parent (p1 only).
function parentSession() {
  auth.mockResolvedValue({ user: { email: "mum@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
}
function viewerSession() {
  auth.mockResolvedValue({ user: { email: "td@club.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "viewer" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
}
function coachParentSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [
    { teamSlug: "a", role: "coach" },
    { teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }
  ] });
  teamBySlug.mockReturnValue({ slug: "a" });
}

const post = (POST, body, extra = {}) => POST(fakeRequest({ body, ...extra }));
const savedFixture = (id) => setData.mock.calls[0][1].fixtures.find((f) => f.id === id);

describe("POST /api/duty — validation", () => {
  it("400s on malformed JSON, a missing fixtureId, an unknown duty or a non-string playerId", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({}))).status).toBe(400);
    expect((await post(POST, { duty: "fruit", playerId: "p1" })).status).toBe(400);
    expect((await post(POST, { fixtureId: "f1", duty: "snacks", playerId: "p1" })).status).toBe(400);
    expect((await post(POST, { fixtureId: "f1", duty: "fruit" })).status).toBe(400);
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: null })).status).toBe(400);
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: 7 })).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s for an unknown fixture, and when there is no team document", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "ghost", duty: "fruit", playerId: "p1" })).status).toBe(404);
    getData.mockResolvedValue(null);
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" })).status).toBe(404);
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s for a player who is not on the roster", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "ghost" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "no such player" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s when that duty is turned off for the team (even for a coach)", async () => {
    coachSession();
    const data = DATA();
    data.team.features = { fruitDuty: true, gkDuty: true, jerseyDuty: false };
    getData.mockResolvedValue(data);
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "jersey", playerId: "p1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "duty turned off" });
    expect(setData).not.toHaveBeenCalled();
    // Jersey duty is off by default too.
    getData.mockResolvedValue(DATA());
    expect((await post(POST, { fixtureId: "f2", duty: "jersey", playerId: "p1" })).status).toBe(400);
  });

  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" })).status).toBe(401);
  });

  it("403s a write while a super admin is viewing as someone", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "p1" })).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/duty — coach hat", () => {
  it("assigns any duty to any player and clears it, answering with the fixture's three duties", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    let res = await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p3" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fixture: { id: "f1", fruit: "p3", gk: "p1", jersey: "" } });
    expect(savedFixture("f1").fruit).toBe("p3");

    setData.mockClear();
    res = await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fixture: { id: "f1", fruit: "", gk: "p1", jersey: "" } });
    expect(savedFixture("f1").fruit).toBe("");
  });

  it("sets the goalkeeper, overriding another family's fruit claim as well", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f2", duty: "gk", playerId: "p2" })).status).toBe(200);
    expect(savedFixture("f2")).toEqual({ id: "f2", round: 2, gk: "p2" });
    setData.mockClear();
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" })).status).toBe(200);
    expect(savedFixture("f1").fruit).toBe("p1");
  });

  it("writes the whole document with only that fixture's field changed", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "p1" });
    expect(res.status).toBe(200);
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.fixtures.find((f) => f.id === "f2")).toEqual({ id: "f2", round: 2, fruit: "p1" });
    // Everything else — the other fixtures, the team, the roster — as it was.
    expect(saved.fixtures.find((f) => f.id === "f1")).toEqual(DATA().fixtures[0]);
    expect(saved.fixtures.find((f) => f.id === "f3")).toEqual(DATA().fixtures[2]);
    expect(saved.team).toEqual({ name: "A" });
    expect(saved.players).toEqual(DATA().players);
    expect(Object.keys(saved).sort()).toEqual(["fixtures", "players", "team"]);
  });

  it("a coach-parent acting as the parent gets the parent's powers (the worn hat decides)", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "gk", playerId: "p1" }, { cookies: { act_as: "parent" } });
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
    // Without the act_as cookie the same login wears the coach hat and may set the keeper.
    expect((await post(POST, { fixtureId: "f2", duty: "gk", playerId: "p1" })).status).toBe(200);
  });
});

describe("POST /api/duty — parent hat", () => {
  it("claims fruit for their own child on an empty slot", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "p1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fixture: { id: "f2", fruit: "p1", gk: "", jersey: "" } });
    expect(savedFixture("f2")).toEqual({ id: "f2", round: 2, fruit: "p1" });
  });

  it("claims jersey duty too when the team has it switched on", async () => {
    parentSession();
    const data = DATA();
    data.team.features = { jerseyDuty: true };
    getData.mockResolvedValue(data);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f2", duty: "jersey", playerId: "p1" })).status).toBe(200);
    expect(savedFixture("f2").jersey).toBe("p1");
  });

  it("403s for the goalkeeper, even for their own child", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "gk", playerId: "p1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only coaches can assign the goalkeeper." });
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s for another family's child", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "p2" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can only claim a duty for your own child." });
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s when the slot is already taken by someone else", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That duty is already taken." });
    expect(setData).not.toHaveBeenCalled();
  });

  it("cannot clear another family's claim", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can only claim a duty for your own child." });
    expect(setData).not.toHaveBeenCalled();
  });

  it("releases their own claim", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { fixtureId: "f3", duty: "fruit", playerId: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fixture: { id: "f3", fruit: "", gk: "", jersey: "" } });
    expect(savedFixture("f3")).toEqual({ ...DATA().fixtures[2], fruit: "" });
  });
});

describe("POST /api/duty — viewer hat", () => {
  it("403s every write", async () => {
    viewerSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f2", duty: "fruit", playerId: "p1" })).status).toBe(403);
    expect((await post(POST, { fixtureId: "f3", duty: "fruit", playerId: "" })).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/duty — legacy team-code mode", () => {
  it("lets any code holder assign or clear any duty without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await post(POST, { fixtureId: "f1", duty: "gk", playerId: "p3" }, { headers: { cookie: "site_auth=code" } });
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(savedFixture("f1").gk).toBe("p3");
    setData.mockClear();
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "" }, { headers: { cookie: "site_auth=code" } })).status).toBe(200);
    expect(savedFixture("f1").fruit).toBe("");
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" })).status).toBe(401);
  });
});

describe("POST /api/duty — D4: the keeper is one field with the planner's block-1 GK", () => {
  it("setting gk also fills plan.assignments[0].GK when the plan has that slot; other blocks and fields untouched", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f1", duty: "gk", playerId: "p3" })).status).toBe(200);
    const f1 = savedFixture("f1");
    expect(f1.gk).toBe("p3");
    expect(f1.plan).toEqual({ subTimes: [10], assignments: [{ GK: "p3", DEF1: "p2" }, { GK: "p2" }], updatedAt: 1 });
    expect(f1).toMatchObject({ us: 3, them: 1, fruit: "p2", availability: { p1: { status: "in" } } });
  });

  it("clearing gk leaves the plan alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f1", duty: "gk", playerId: "" })).status).toBe(200);
    const f1 = savedFixture("f1");
    expect(f1.gk).toBe("");
    expect(f1.plan).toEqual(DATA().fixtures[0].plan);
  });

  it("never invents a GK slot: no plan, or a first block without a GK key, stays as it was", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f2", duty: "gk", playerId: "p1" })).status).toBe(200);
    expect(savedFixture("f2")).toEqual({ id: "f2", round: 2, gk: "p1" });
    setData.mockClear();
    expect((await post(POST, { fixtureId: "f3", duty: "gk", playerId: "p1" })).status).toBe(200);
    expect(savedFixture("f3")).toEqual({ ...DATA().fixtures[2], gk: "p1" });
  });

  it("a fruit or jersey write never touches the plan", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { fixtureId: "f1", duty: "fruit", playerId: "p1" })).status).toBe(200);
    expect(savedFixture("f1").plan).toEqual(DATA().fixtures[0].plan);
  });
});
