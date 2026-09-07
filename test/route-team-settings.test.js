import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/team-settings writes ONLY the named team.* fields (parentsSee,
// matchFormat, rules) and nothing else — players/fixtures/sessions come from
// the fresh server-side read, so an RSVP that landed after the coach loaded
// the settings screen survives their save. Coach-gated in account mode; any
// code holder in legacy mode. AUTH_ON is module-load state, so each block
// re-imports the route.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

const PARENTS_SEE = { planBeforeKickoff: true, liveScore: false };
const DATA = () => ({
  team: {
    name: "A",
    ageGroup: "U8",
    logo: "data:image/png;base64,abc",
    features: { fruitDuty: true, jerseyDuty: true },
    parentsSee: { liveScore: true, liveLineup: true },
    matchFormat: { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 },
    rules: [{ id: "bi-period", text: "Everyone available plays in both halves", builtin: true }]
  },
  players: [
    { id: "p1", name: "Sam", number: 7, coach: { ratings: { GK: 3, DEF: null, MID: 4, FWD: 2 }, note: "Left footed" } },
    { id: "p2", name: "Ava", number: 9 }
  ],
  fixtures: [
    {
      id: "f1", round: 1, us: 3, them: 1, gk: "p1",
      availability: { p1: { status: "in", by: "coach@a.com", at: 1 } },
      plan: { subTimes: [10, 30], assignments: [{ GK: "p1" }], updatedAt: 1 }
    },
    { id: "f2", round: 2 }
  ],
  sessions: [{ id: "s1", kind: "training", weekday: 2, time: "17:00" }]
});

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
  // clearAllMocks keeps return values, so a view-as test would otherwise
  // leak its impersonation into every later test.
  viewingAs.mockReturnValue(null);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/team-settings/route");
}

// The worn hat decides what a login may do (real lib/viewer + lib/hats over
// the mocked directory), so a session's intent lives in its membership roles.
function coachSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
}
function parentSession() {
  auth.mockResolvedValue({ user: { email: "mum@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
}
// A coach whose child plays on the same team: two hats, act_as picks one.
function coachParentSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [
    { teamSlug: "a", role: "coach" },
    { teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }
  ] });
  teamBySlug.mockReturnValue({ slug: "a" });
}

// The untouched parts of the document must come back byte-identical.
function expectRestUntouched(saved, original) {
  expect(JSON.stringify(saved.players)).toBe(JSON.stringify(original.players));
  expect(JSON.stringify(saved.fixtures)).toBe(JSON.stringify(original.fixtures));
  expect(JSON.stringify(saved.sessions)).toBe(JSON.stringify(original.sessions));
}

describe("POST /api/team-settings — validation", () => {
  it("400s on malformed JSON", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s when the body isn't an object or names none of the three settings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const body of [null, "junk", 42, [], {}, { fixtureId: "f1", plan: {} }, { features: { fruitDuty: false } }]) {
      const res = await POST(fakeRequest({ body }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s when the team has no data document", async () => {
    coachSession();
    getData.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no data" });
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/team-settings — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s a signed-in account with no memberships", async () => {
    auth.mockResolvedValue({ user: { email: "stranger@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent (non-coach)", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a coach-parent who is acting as the parent (the worn hat decides)", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE }, cookies: { act_as: "parent" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(setData).not.toHaveBeenCalled();
    // Without the act_as cookie the same login wears the coach hat and may write.
    expect((await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }))).status).toBe(200);
  });

  it("403s a write while a super admin is viewing as someone else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/viewing as another user/);
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie when the coach has several teams", async () => {
    coachSession();
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }, { teamSlug: "b", role: "coach" }] });
    teamBySlug.mockImplementation((slug) => ({ slug }));
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE }, cookies: { team_slug: "b" } }));
    expect(res.status).toBe(200);
    expect(teamBySlug).toHaveBeenCalledWith("b");
    expect(getData).toHaveBeenCalledWith("b");
    expect(setData.mock.calls[0][0]).toBe("b");
  });
});

describe("POST /api/team-settings — legacy team-code mode", () => {
  it("lets any code holder save settings without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE }, headers: { cookie: "site_auth=code" } }));
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect(setData.mock.calls[0][1].team.parentsSee).toMatchObject({ planBeforeKickoff: true, liveScore: false });
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    expect((await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/team-settings — parentsSee", () => {
  it("saves the sanitised flags, keeps other team keys and echoes only what was saved", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({
      body: { parentsSee: { planBeforeKickoff: "yes", liveScore: 0, ownChildMinutes: 1, secretKey: true } }
    }));
    expect(res.status).toBe(200);
    const expected = { planBeforeKickoff: true, liveScore: false, liveLineup: true, ownChildMinutes: true, everyoneMinutes: false };
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.team.parentsSee).toEqual(expected);
    expect(saved.team.parentsSee).not.toHaveProperty("secretKey");
    // Every other team key survives untouched.
    const original = DATA();
    expect(saved.team).toEqual({ ...original.team, parentsSee: expected });
    expectRestUntouched(saved, original);
    // Response echoes exactly the saved value, and nothing the client didn't send.
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.team).toEqual({ parentsSee: expected });
  });

  it("coerces a non-object parentsSee to the defaults rather than failing", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: "everything" } }));
    expect(res.status).toBe(200);
    expect(setData.mock.calls[0][1].team.parentsSee).toEqual({
      planBeforeKickoff: false, liveScore: true, liveLineup: true, ownChildMinutes: false, everyoneMinutes: false
    });
  });
});

describe("POST /api/team-settings — matchFormat", () => {
  it("saves the sanitised format on top of the age-group default; a bad formation falls back", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    // U8 => 7-a-side with a keeper => 6 outfield. "9-9-9" can't fit, so the
    // planner's default shape for 6 comes back; the numeric string is coerced
    // and the out-of-range period count is clamped.
    const res = await POST(fakeRequest({ body: { matchFormat: { gameLength: "50", periods: 9, formation: "9-9-9", bogus: "x" } } }));
    expect(res.status).toBe(200);
    const expected = { gameLength: 50, periods: 4, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };
    const saved = setData.mock.calls[0][1];
    expect(saved.team.matchFormat).toEqual(expected);
    const original = DATA();
    expect(saved.team).toEqual({ ...original.team, matchFormat: expected });
    expectRestUntouched(saved, original);
    expect((await res.json()).team).toEqual({ matchFormat: expected });
  });

  it("keeps a formation that fits the outfield count", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { matchFormat: { playersOnField: 9, hasGK: true, formation: "4-3-1" } } }));
    expect(res.status).toBe(200);
    expect(setData.mock.calls[0][1].team.matchFormat).toMatchObject({ playersOnField: 9, hasGK: true, formation: "4-3-1" });
  });

  it("uses the team's own age group for the defaults", async () => {
    coachSession();
    const data = DATA();
    data.team.ageGroup = "U6";
    getData.mockResolvedValue(data);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { matchFormat: { gameLength: 30 } } }));
    expect(res.status).toBe(200);
    // U6: 4-a-side, no keeper, 2-2.
    expect(setData.mock.calls[0][1].team.matchFormat).toEqual({ gameLength: 30, periods: 2, playersOnField: 4, hasGK: false, formation: "2-2", subInterval: 10 });
  });
});

describe("POST /api/team-settings — rules", () => {
  it("forces built-in text, keeps custom rules in order and re-seeds missing built-ins", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({
      body: {
        rules: [
          { id: "r_custom1", text: "  Sam always starts in goal  ", builtin: true, createdAt: 1700000000000 },
          { id: "bi-period", text: "hacked text", builtin: false, off: true },
          { id: "bi-weak-wide", text: "also hacked" }
        ]
      }
    }));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.team.rules).toEqual([
      { id: "r_custom1", text: "Sam always starts in goal", builtin: false, createdAt: 1700000000000 },
      { id: "bi-period", text: "Everyone available plays in both halves", builtin: true, off: true },
      { id: "bi-weak-wide", text: "Less confident players start out wide, not through the middle", builtin: true },
      { id: "bi-gk-break", text: "Keeper changes only at the break", builtin: true },
      { id: "bi-rating-zero", text: "Nobody plays a spot they're rated 0 in", builtin: true }
    ]);
    const original = DATA();
    expect(saved.team).toEqual({ ...original.team, rules: saved.team.rules });
    expectRestUntouched(saved, original);
    expect((await res.json()).team).toEqual({ rules: saved.team.rules });
  });

  it("falls back to the default rule set when rules isn't an array", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { rules: "none" } }));
    expect(res.status).toBe(200);
    expect(setData.mock.calls[0][1].team.rules.map((r) => r.id)).toEqual(["bi-period", "bi-gk-break", "bi-rating-zero"]);
  });
});

describe("POST /api/team-settings — narrow write", () => {
  it("saves several settings in one request and echoes each", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({
      body: { parentsSee: PARENTS_SEE, matchFormat: { subInterval: 8 }, rules: [] }
    }));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    const json = await res.json();
    expect(Object.keys(json.team).sort()).toEqual(["matchFormat", "parentsSee", "rules"]);
    expect(json.team.parentsSee).toEqual(saved.team.parentsSee);
    expect(json.team.matchFormat).toEqual(saved.team.matchFormat);
    expect(json.team.rules).toEqual(saved.team.rules);
    expect(saved.team.matchFormat.subInterval).toBe(8);
    expect(saved.team).toMatchObject({ name: "A", ageGroup: "U8", logo: "data:image/png;base64,abc" });
    expectRestUntouched(saved, DATA());
  });

  it("never touches players, fixtures or sessions, whichever setting is saved", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const bodies = [{ parentsSee: PARENTS_SEE }, { matchFormat: { periods: 1 } }, { rules: [] }];
    for (const body of bodies) {
      setData.mockClear();
      const res = await POST(fakeRequest({ body }));
      expect(res.status).toBe(200);
      const saved = setData.mock.calls[0][1];
      expectRestUntouched(saved, DATA());
      // Coach-only fields and the fixture's plan/RSVPs ride along by reference.
      expect(saved.players[0].coach).toEqual({ ratings: { GK: 3, DEF: null, MID: 4, FWD: 2 }, note: "Left footed" });
      expect(saved.fixtures[0]).toMatchObject({ us: 3, them: 1, gk: "p1", plan: { subTimes: [10, 30] } });
    }
  });

  it("creates data.team when the document has none", async () => {
    coachSession();
    getData.mockResolvedValue({ players: [], fixtures: [{ id: "f1" }] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: PARENTS_SEE } }));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.team.parentsSee).toMatchObject({ planBeforeKickoff: true, liveScore: false });
    expect(saved.fixtures).toEqual([{ id: "f1" }]);
  });

  it("keeps an RSVP that landed after the coach loaded the settings screen", async () => {
    coachSession();
    // What the coach's browser loaded: no reply from Ava yet.
    const stale = DATA();
    expect(stale.fixtures[0].availability.p2).toBeUndefined();
    // What's actually in the store by the time the coach hits save: Ava's mum
    // has marked her out. The client never sent this; only the server has it.
    const fresh = DATA();
    const rsvp = { status: "out", reason: "Sick", by: "mum@a.com", at: 1720000000000 };
    fresh.fixtures[0].availability.p2 = rsvp;
    getData.mockResolvedValue(fresh);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { parentsSee: { planBeforeKickoff: true } } }));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    // The setting went through...
    expect(saved.team.parentsSee).toEqual({ planBeforeKickoff: true, liveScore: true, liveLineup: true, ownChildMinutes: false, everyoneMinutes: false });
    // ...and the late RSVP is still there, unchanged, alongside the earlier one.
    expect(saved.fixtures[0].availability.p2).toEqual(rsvp);
    expect(saved.fixtures[0].availability.p1).toEqual({ status: "in", by: "coach@a.com", at: 1 });
    expect(JSON.stringify(saved.fixtures)).toBe(JSON.stringify(fresh.fixtures));
    expect(JSON.stringify(saved.players)).toBe(JSON.stringify(fresh.players));
    expect(JSON.stringify(saved.sessions)).toBe(JSON.stringify(fresh.sessions));
  });
});
