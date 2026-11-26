import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { READ_ONLY_MESSAGE, PICK_TEAM_MESSAGE } from "@/lib/viewer";
import { LEGACY_LEAGUE_SETUP, NOT_A_SQUADI_LINK } from "@/lib/leagueSetup";

// /api/league reads and writes ONLY data.squadi, the Squadi draw a team's
// league page embeds. GET is open to every member and returns the team's own
// set-up or nothing: only the legacy owner (lib/store legacyOwnerSlug) falls
// back to the old hard-coded default, so no other team is ever shown that
// team's draw. POST is the coach hat's alone in account mode (any code holder
// in legacy mode), refused while a super admin is viewing as someone, and
// replaces just the one key on a freshly read document. The route sits on the
// REAL lib/viewer, lib/hats and lib/leagueSetup; AUTH_ON is module-load state,
// so each test re-imports the route.
const { auth, getData, setData, legacyOwnerSlug, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(), legacyOwnerSlug: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData, legacyOwnerSlug }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

const LINK = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=o&yearId=8&competitionUniqueKey=c&divisionId=1&teamId=2";
const LINK_2 = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=o&yearId=8&competitionUniqueKey=c2&divisionId=3&teamId=4";
const SAVED = { mode: "url", url: LINK, org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" };
const BLANK = { mode: "builder", url: "", org: "", yearId: "", comp: "", divisionId: "", teamId: "" };

// A team document with something in every part the league set-up must never touch.
const DATA = (extra = {}) => ({
  team: { name: "A", ageGroup: "O35", coachPin: "4321", parentsSee: { liveScore: true }, rules: [{ id: "bi-period", builtin: true }] },
  players: [
    { id: "p1", name: "Sam", number: 7, coach: { ratings: { GK: 3, DEF: null, MID: 4, FWD: 2 }, note: "Left footed" } },
    { id: "p2", name: "Ava", number: 9 }
  ],
  fixtures: [
    {
      id: "f1", round: 1, us: 3, them: 1, gk: "p1", fruit: "p2",
      availability: { p1: { status: "in", by: "Coach", at: 1 } },
      plan: { subTimes: [10, 30], assignments: [{ GK: "p1" }], updatedAt: 1 }
    },
    { id: "f2", round: 2 }
  ],
  sessions: [{ id: "s1", kind: "training", weekday: 2, time: "17:00", availability: { "2026-09-08": { p1: { status: "in" } } } }],
  knowledge: [{ id: "k1", title: "Competition rules" }],
  isSample: false,
  ...extra
});

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
  // clearAllMocks keeps return values: reset what individual tests change.
  viewingAs.mockReturnValue(null);
  legacyOwnerSlug.mockReturnValue(null);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/league/route");
}

// The worn hat decides what a login may do (real lib/viewer + lib/hats over
// the mocked directory), so a session's intent lives in its membership roles.
function session(email, memberships) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships });
  teamBySlug.mockImplementation((slug) => ({ slug }));
}
const coachSession = () => session("coach@a.com", [{ teamSlug: "a", role: "coach" }]);
const parentSession = () => session("mum@a.com", [{ teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }]);
// A club admin: view-only on the team.
const viewerSession = () => session("td@club.com", [{ teamSlug: "a", role: "viewer", clubAdmin: true }]);
// A coach whose child plays on the same team: two hats, act_as picks one.
const coachParentSession = () => session("coach@a.com", [
  { teamSlug: "a", role: "coach" },
  { teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }
]);
// One login coaching two teams: the team_slug cookie picks.
const twoTeamCoach = () => session("coach@a.com", [{ teamSlug: "a", role: "coach" }, { teamSlug: "b", role: "coach" }]);

const post = (POST, body, extra = {}) => POST(fakeRequest({ body, ...extra }));

// Everything but squadi must come back byte-identical.
function expectRestUntouched(saved, original) {
  const { squadi: _a, ...rest } = saved;
  const { squadi: _b, ...before } = original;
  expect(JSON.stringify(rest)).toBe(JSON.stringify(before));
}

describe("GET /api/league — account mode", () => {
  it("401s when not signed in, and when the account has no memberships", async () => {
    auth.mockResolvedValue(null);
    const { GET } = await loadRoute({ authOn: true });
    expect((await GET(fakeRequest())).status).toBe(401);
    session("stranger@x.com", []);
    expect((await GET(fakeRequest())).status).toBe(401);
    expect(getData).not.toHaveBeenCalled();
  });

  it("409s (pick a team) when the caller has several teams and none is chosen", async () => {
    twoTeamCoach();
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: PICK_TEAM_MESSAGE });
    expect(getData).not.toHaveBeenCalled();
  });

  it("a team with nothing saved gets no draw at all, whoever asks", async () => {
    const { GET } = await loadRoute({ authOn: true });
    for (const signIn of [coachSession, parentSession, viewerSession]) {
      signIn();
      const res = await GET(fakeRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ squadi: null, saved: false });
    }
  });

  it("returns the team's own saved set-up to any member, and nothing else from the document", async () => {
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    const { GET } = await loadRoute({ authOn: true });
    for (const signIn of [coachSession, parentSession, viewerSession]) {
      signIn();
      const res = await GET(fakeRequest());
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ squadi: SAVED, saved: true });
      // Not the team document: no players, fixtures, ratings or PIN ride along.
      expect(Object.keys(json).sort()).toEqual(["saved", "squadi"]);
      expect(JSON.stringify(json)).not.toMatch(/Sam|Left footed|4321|availability/);
    }
    expect(getData).toHaveBeenCalledWith("a");
  });

  it("only the legacy owner falls back to the old default; every other team gets nothing", async () => {
    legacyOwnerSlug.mockReturnValue("a");
    twoTeamCoach();
    const { GET } = await loadRoute({ authOn: true });
    // Team a is the legacy owner: its page keeps the draw it always showed.
    let res = await GET(fakeRequest({ cookies: { team_slug: "a" } }));
    expect(await res.json()).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    expect(getData).toHaveBeenLastCalledWith("a");
    // Team b (say, an over-35s side made in the wizard) has saved nothing:
    // the same login, on the same site, must not be handed team a's draw.
    res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(await res.json()).toEqual({ squadi: null, saved: false });
    expect(getData).toHaveBeenLastCalledWith("b");
  });

  it("a club with no legacy owner (wizard-only) has no default for anyone", async () => {
    legacyOwnerSlug.mockReturnValue(null);
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ squadi: null, saved: false });
  });

  it("the legacy owner's own saved set-up wins over the default", async () => {
    legacyOwnerSlug.mockReturnValue("a");
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ squadi: SAVED, saved: true });
  });

  it("a team with no document yet reads as nothing saved (the legacy owner still gets its default)", async () => {
    getData.mockResolvedValue(null);
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ squadi: null, saved: false });
    legacyOwnerSlug.mockReturnValue("a");
    expect(await (await GET(fakeRequest())).json()).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
  });

  it("a super admin viewing as someone reads as that person (reads are allowed)", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent", playerId: "p1" }] });
    teamBySlug.mockImplementation((slug) => ({ slug }));
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
    expect(await res.json()).toEqual({ squadi: SAVED, saved: true });
  });

  it("never writes", async () => {
    legacyOwnerSlug.mockReturnValue("a");
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    await GET(fakeRequest());
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("GET /api/league — legacy team-code mode", () => {
  it("resolves the team from the site_auth cookie without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }));
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect(await res.json()).toEqual({ squadi: SAVED, saved: true });
  });

  it("single-team mode: 'default' is the legacy owner and keeps its draw; another code's team does not get it", async () => {
    legacyOwnerSlug.mockReturnValue("default");
    const { GET } = await loadRoute({ authOn: false });
    teamFromCookieHeader.mockReturnValue({ slug: "default" });
    expect(await (await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }))).json()).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    teamFromCookieHeader.mockReturnValue({ slug: "over-35s" });
    expect(await (await GET(fakeRequest({ headers: { cookie: "site_auth=other" } }))).json()).toEqual({ squadi: null, saved: false });
  });

  it("401s when the cookie matches no team", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { GET } = await loadRoute({ authOn: false });
    expect((await GET(fakeRequest())).status).toBe(401);
    expect(getData).not.toHaveBeenCalled();
  });
});

describe("POST /api/league — validation", () => {
  it("400s on malformed JSON", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s when the body carries no squadi object (a bare set-up or a whole team document included)", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const bodies = [null, "junk", 42, [], {}, { squadi: null }, { squadi: "builder" }, { squadi: [SAVED] }, SAVED, { team: { name: "X" }, players: [], fixtures: [] }];
    for (const body of bodies) {
      const res = await post(POST, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s a link that is not a Squadi link, with a reason the page can show, and writes nothing", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const url of ["https://evil.example/liveScoreSeasonFixture", "javascript:alert(1)", "http://registration.squadi.com/x", "not a link"]) {
      const res = await post(POST, { squadi: { ...SAVED, url } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_A_SQUADI_LINK });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s, with a sentence, when the team has no document yet (it never creates one)", async () => {
    coachSession();
    getData.mockResolvedValue(null);
    const { POST, NO_TEAM_DATA } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: NO_TEAM_DATA });
    expect(NO_TEAM_DATA).toBe("This team has no data yet. Open the team hub once, then set up the league page.");
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/league — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { squadi: SAVED })).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s a signed-in account with no memberships", async () => {
    session("stranger@x.com", []);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, { squadi: SAVED })).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent, with the sentence the page shows", async () => {
    parentSession();
    const { POST, COACH_ONLY } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: COACH_ONLY });
    expect(COACH_ONLY).toBe("Only coaches can change the league setup.");
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a club admin (view-only on the team)", async () => {
    viewerSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only coaches can change the league setup.");
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a coach-parent who is acting as the parent (the worn hat decides)", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED }, { cookies: { act_as: "parent" } });
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
    // Without the act_as cookie the same login wears the coach hat and may save.
    expect((await post(POST, { squadi: SAVED })).status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it("403s a save while a super admin is viewing as someone, before anything else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE });
    // Refused before the impersonated coach's memberships are even looked up.
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("who may save is settled before what was sent: a refusal never reads as a problem with the link", async () => {
    const bad = { squadi: { mode: "url", url: "https://evil.example/x" } };
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    let res = await post(POST, bad);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only coaches can change the league setup.");
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    res = await post(POST, bad);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(READ_ONLY_MESSAGE);
    expect(setData).not.toHaveBeenCalled();
  });

  it("409s when the coach has several teams and none is chosen", async () => {
    twoTeamCoach();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(409);
    expect(setData).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie: the set-up lands on the chosen team and no other", async () => {
    twoTeamCoach();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED }, { cookies: { team_slug: "b" } });
    expect(res.status).toBe(200);
    expect(teamBySlug).toHaveBeenCalledWith("b");
    expect(getData).toHaveBeenCalledWith("b");
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0][0]).toBe("b");
  });
});

describe("POST /api/league — legacy team-code mode", () => {
  it("lets any code holder save without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await post(POST, { squadi: SAVED }, { headers: { cookie: "site_auth=code" } });
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect(setData.mock.calls[0][0]).toBe("a");
    expect(setData.mock.calls[0][1].squadi).toEqual(SAVED);
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    expect((await post(POST, { squadi: SAVED })).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/league — narrow write", () => {
  it("adds squadi to a document that had none and leaves every other byte alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(200);
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.squadi).toEqual(SAVED);
    expectRestUntouched(saved, DATA());
    expect(Object.keys(saved).sort()).toEqual([...Object.keys(DATA()), "squadi"].sort());
    // The response echoes exactly what was stored.
    expect(await res.json()).toEqual({ ok: true, squadi: SAVED });
  });

  it("replaces an existing set-up outright: nothing of the old one lingers", async () => {
    coachSession();
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: { mode: "url", url: LINK_2 } });
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual({ ...BLANK, mode: "url", url: LINK_2 });
    expectRestUntouched(saved, DATA({ squadi: SAVED }));
  });

  it("stores the sanitised set-up: known keys only, ids trimmed, the link normalised", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, {
      squadi: { mode: "builder", url: "  " + LINK + "  ", org: " org-key ", yearId: 8, comp: " comp-key ", divisionId: "All", teamId: 110, secret: "x", team: { name: "smuggled" } }
    });
    expect(res.status).toBe(200);
    const expected = { mode: "builder", url: LINK, org: "org-key", yearId: "8", comp: "comp-key", divisionId: "All", teamId: "110" };
    expect(setData.mock.calls[0][1].squadi).toEqual(expected);
    expect(await res.json()).toEqual({ ok: true, squadi: expected });
  });

  it("writes nothing but squadi, whatever else the body carries", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    // A stale whole document with the set-up changed: what the page used to post.
    const stale = DATA();
    stale.team.name = "Renamed by a stale tab";
    stale.fixtures = [];
    stale.players = [];
    const res = await post(POST, { ...stale, squadi: SAVED });
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual(SAVED);
    expectRestUntouched(saved, DATA());
    expect(saved.team.name).toBe("A");
    expect(saved.fixtures).toHaveLength(2);
    expect(saved.players).toHaveLength(2);
  });

  it("keeps a score and a reply that landed after the coach opened the league page", async () => {
    coachSession();
    // What is in the store by the time the coach presses save: another coach
    // has entered round 2's score and Ava's mum has replied. The league page
    // never had either, and never sends them.
    const fresh = DATA();
    fresh.fixtures[1] = { id: "f2", round: 2, us: 4, them: 0, status: "played" };
    const rsvp = { status: "out", reason: "Sick", by: "Ava", at: 1720000000000 };
    fresh.fixtures[0].availability.p2 = rsvp;
    getData.mockResolvedValue(fresh);
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: SAVED });
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual(SAVED);
    expect(saved.fixtures[1]).toEqual({ id: "f2", round: 2, us: 4, them: 0, status: "played" });
    expect(saved.fixtures[0].availability.p2).toEqual(rsvp);
    expectRestUntouched(saved, fresh);
  });

  it("the legacy owner's save stores what was sent, and from then on that is what its page gets", async () => {
    legacyOwnerSlug.mockReturnValue("a");
    coachSession();
    const { POST, GET } = await loadRoute({ authOn: true });
    const res = await post(POST, { squadi: { mode: "url", url: LINK_2 } });
    expect(res.status).toBe(200);
    const stored = setData.mock.calls[0][1];
    // Nothing of the old default is written into the document.
    expect(stored.squadi).toEqual({ ...BLANK, mode: "url", url: LINK_2 });
    getData.mockResolvedValue(stored);
    expect(await (await GET(fakeRequest())).json()).toEqual({ squadi: { ...BLANK, mode: "url", url: LINK_2 }, saved: true });
  });

  it("never mutates the document it read", async () => {
    coachSession();
    const doc = DATA({ squadi: SAVED });
    const before = JSON.stringify(doc);
    getData.mockResolvedValue(doc);
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, { squadi: { mode: "url", url: LINK_2 } });
    expect(JSON.stringify(doc)).toBe(before);
    expect(setData.mock.calls[0][1]).not.toBe(doc);
  });
});
