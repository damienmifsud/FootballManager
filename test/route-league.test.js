import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { READ_ONLY_MESSAGE, PICK_TEAM_MESSAGE } from "@/lib/viewer";
import { LEGACY_LEAGUE_SETUP, NOT_A_SQUADI_LINK } from "@/lib/leagueSetup";

// /api/league reads and writes ONLY data.squadi, the Squadi draw a team's
// league page embeds. GET is open to every member and returns the team's own
// set-up or nothing: only the original team (the legacy owner, lib/store
// legacyOwnerSlug) falls back to the old hard-coded default, so no other team
// is ever shown that team's draw. POST is the coach hat's alone in account
// mode (any code holder in legacy mode), refused while a super admin is
// viewing as someone, names the team it is for, and replaces just the one key
// on a freshly read document. The route sits on the REAL lib/viewer, lib/hats
// and lib/leagueSetup, and on the real legacyOwnerSlug (it reads TEAMS and
// SITE_PASSWORD, set per test); AUTH_ON is module-load state, so each test
// re-imports the route.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", async () => ({ getData, setData, legacyOwnerSlug: (await vi.importActual("@/lib/store")).legacyOwnerSlug }));
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

const ENV_KEYS = ["AUTH_SECRET", "TEAMS", "SITE_PASSWORD"];
let savedEnv;
beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Every test starts as a wizard-only club: no env-defined team, so no legacy owner.
  delete process.env.TEAMS;
  delete process.env.SITE_PASSWORD;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
  // clearAllMocks keeps return values: reset what individual tests change.
  viewingAs.mockReturnValue(null);
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

// The legacy owner is the first env-defined team (lib/store legacyOwnerSlug).
const envTeams = (...slugs) => { process.env.TEAMS = JSON.stringify(slugs.map((slug, i) => ({ slug, name: slug, password: "code-" + i }))); };
// The original team's Squadi sync ids, as the registry holds them.
const ORIGINAL_SYNC = { competitionId: "1439", divisionId: "10661", teamId: 110013 };

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
// What the page sends: the team it loaded its set-up for, and the set-up.
const save = (squadi, teamSlug = "a") => ({ teamSlug, squadi });

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
      expect(await res.json()).toEqual({ teamSlug: "a", squadi: null, saved: false, draws: [] });
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
      expect(json).toEqual({ teamSlug: "a", squadi: SAVED, saved: true, draws: [] });
      // Not the team document: no players, fixtures, ratings or PIN ride along.
      expect(Object.keys(json).sort()).toEqual(["draws", "saved", "squadi", "teamSlug"]);
      expect(JSON.stringify(json)).not.toMatch(/Sam|Left footed|4321|availability/);
    }
    expect(getData).toHaveBeenCalledWith("a");
  });

  it("only the legacy owner falls back to the old default; every other team gets nothing", async () => {
    envTeams("a", "b");
    twoTeamCoach();
    const { GET } = await loadRoute({ authOn: true });
    // Team a is the first env-defined team, the legacy owner: its page keeps the draw it always showed.
    let res = await GET(fakeRequest({ cookies: { team_slug: "a" } }));
    expect(await res.json()).toEqual({ teamSlug: "a", squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false, draws: [] });
    expect(getData).toHaveBeenLastCalledWith("a");
    // Team b (say, an over-35s side made in the wizard) has saved nothing:
    // the same login, on the same site, must not be handed team a's draw.
    res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(await res.json()).toEqual({ teamSlug: "b", squadi: null, saved: false, draws: [] });
    expect(getData).toHaveBeenLastCalledWith("b");
  });

  it("a club with no legacy owner (wizard-only) has no default for anyone", async () => {
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: null, saved: false, draws: [] });
  });

  it("the original team is also known by its own Squadi sync ids, under any slug; no other team's sync ids qualify", async () => {
    envTeams("someone-else", "a", "b");
    twoTeamCoach();
    // Team a's registry entry syncs the original team's Squadi team; team b syncs its own.
    teamBySlug.mockImplementation((slug) => (slug === "a"
      ? { slug, squadi: ORIGINAL_SYNC }
      : { slug, squadi: { competitionId: "1251", divisionId: "9000", teamId: 120000 } }));
    const { GET } = await loadRoute({ authOn: true });
    let res = await GET(fakeRequest({ cookies: { team_slug: "a" } }));
    expect(await res.json()).toEqual({ teamSlug: "a", squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false, draws: [] });
    res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(await res.json()).toEqual({ teamSlug: "b", squadi: null, saved: false, draws: [] });
  });

  it("the original team's own saved set-up wins over the default", async () => {
    envTeams("a");
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: SAVED, saved: true, draws: [] });
  });

  it("another team that saved the old default under the old page is not shown the original team's draw", async () => {
    envTeams("kangaroos-white", "a");
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    // Saved unchanged: treated as never set up.
    getData.mockResolvedValue(DATA({ squadi: { ...LEGACY_LEAGUE_SETUP } }));
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: null, saved: false, draws: [] });
    // Saved with the coach's own link pasted: the link stays, the original team's ids beside it go.
    getData.mockResolvedValue(DATA({ squadi: { ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK } }));
    expect(await (await GET(fakeRequest())).json()).toEqual({
      teamSlug: "a", saved: true, draws: [],
      squadi: { ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK, comp: "", divisionId: "", teamId: "" }
    });
    // Reading never rewrites the document.
    expect(setData).not.toHaveBeenCalled();
    // The original team's own copy of those ids is its own: served as saved.
    envTeams("a");
    getData.mockResolvedValue(DATA({ squadi: { ...LEGACY_LEAGUE_SETUP } }));
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: { ...LEGACY_LEAGUE_SETUP }, saved: true, draws: [] });
  });

  it("a team with no document yet reads as nothing saved (the legacy owner still gets its default)", async () => {
    getData.mockResolvedValue(null);
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: null, saved: false, draws: [] });
    envTeams("a");
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false, draws: [] });
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
    expect(await res.json()).toEqual({ teamSlug: "a", squadi: SAVED, saved: true, draws: [] });
  });

  it("never writes", async () => {
    envTeams("a");
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
    expect(await res.json()).toEqual({ teamSlug: "a", squadi: SAVED, saved: true, draws: [] });
  });

  it("single-team mode: 'default' is the legacy owner and keeps its draw; another code's team does not get it", async () => {
    process.env.SITE_PASSWORD = "the-code";
    const { GET } = await loadRoute({ authOn: false });
    teamFromCookieHeader.mockReturnValue({ slug: "default" });
    expect(await (await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }))).json()).toEqual({ teamSlug: "default", squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false, draws: [] });
    teamFromCookieHeader.mockReturnValue({ slug: "over-35s" });
    expect(await (await GET(fakeRequest({ headers: { cookie: "site_auth=other" } }))).json()).toEqual({ teamSlug: "over-35s", squadi: null, saved: false, draws: [] });
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

  it("400s when the body carries no squadi object or does not name its team (a bare set-up or a whole team document included)", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const bodies = [
      null, "junk", 42, [], {},
      { teamSlug: "a" }, { teamSlug: "a", squadi: null }, { teamSlug: "a", squadi: "builder" }, { teamSlug: "a", squadi: [SAVED] },
      { squadi: SAVED }, { teamSlug: "", squadi: SAVED }, { teamSlug: 7, squadi: SAVED }, { teamSlug: ["a"], squadi: SAVED },
      SAVED, { team: { name: "X" }, players: [], fixtures: [] }
    ];
    for (const body of bodies) {
      const res = await post(POST, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s a link that is not a Squadi link, with a reason the page can show, and writes nothing", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const url of ["https://evil.example/liveScoreSeasonFixture", "javascript:alert(1)", "http://registration.squadi.com/x", "not a link"]) {
      const res = await post(POST, save({ ...SAVED, url }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_A_SQUADI_LINK });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s, with a sentence, when the team has no usable document yet (it never creates one)", async () => {
    coachSession();
    const { POST, NO_TEAM_DATA } = await loadRoute({ authOn: true });
    for (const nothing of [null, [], "junk"]) {
      getData.mockResolvedValue(nothing);
      const res = await post(POST, save(SAVED));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: NO_TEAM_DATA });
    }
    expect(NO_TEAM_DATA).toBe("This team has no data yet. Open the team hub once, then set up the league page.");
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/league — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, save(SAVED))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s a signed-in account with no memberships", async () => {
    session("stranger@x.com", []);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, save(SAVED))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent, with the sentence the page shows", async () => {
    parentSession();
    const { POST, COACH_ONLY } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: COACH_ONLY });
    expect(COACH_ONLY).toBe("Only coaches can change the league setup.");
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a club admin (view-only on the team)", async () => {
    viewerSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only coaches can change the league setup.");
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a coach-parent who is acting as the parent (the worn hat decides)", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED), { cookies: { act_as: "parent" } });
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
    // Without the act_as cookie the same login wears the coach hat and may save.
    expect((await post(POST, save(SAVED))).status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it("403s a save while a super admin is viewing as someone, before anything else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE });
    // Refused before the impersonated coach's memberships are even looked up.
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("who may save is settled before what was sent: a refusal never reads as a problem with the link or the team", async () => {
    const bad = save({ mode: "url", url: "https://evil.example/x" }, "some-other-team");
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
    const res = await post(POST, save(SAVED));
    expect(res.status).toBe(409);
    expect(setData).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie: the set-up lands on the chosen team and no other", async () => {
    twoTeamCoach();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED, "b"), { cookies: { team_slug: "b" } });
    expect(res.status).toBe(200);
    expect(teamBySlug).toHaveBeenCalledWith("b");
    expect(getData).toHaveBeenCalledWith("b");
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0][0]).toBe("b");
  });

  it("412s a save from a page opened for one team once another team has been chosen, and writes to neither", async () => {
    envTeams("a", "b");
    twoTeamCoach();
    const { POST, GET, WRONG_TEAM } = await loadRoute({ authOn: true });
    // The page was opened on team a (the legacy owner: its form is filled with the old default)...
    const loaded = await (await GET(fakeRequest({ cookies: { team_slug: "a" } }))).json();
    expect(loaded.teamSlug).toBe("a");
    // ...the coach then switched to team b in another tab, and presses save in the first.
    const res = await post(POST, { teamSlug: loaded.teamSlug, squadi: loaded.squadi }, { cookies: { team_slug: "b" } });
    expect(res.status).toBe(412);
    expect(await res.json()).toEqual({ error: WRONG_TEAM });
    expect(WRONG_TEAM).toBe("This page was opened for another team. Reload it, then save again.");
    expect(setData).not.toHaveBeenCalled();
    // With the cookie back on team a, the same save goes through, to team a.
    expect((await post(POST, { teamSlug: loaded.teamSlug, squadi: loaded.squadi }, { cookies: { team_slug: "a" } })).status).toBe(200);
    expect(setData.mock.calls[0][0]).toBe("a");
  });
});

describe("POST /api/league — legacy team-code mode", () => {
  it("lets any code holder save without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await post(POST, save(SAVED), { headers: { cookie: "site_auth=code" } });
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect(setData.mock.calls[0][0]).toBe("a");
    expect(setData.mock.calls[0][1].squadi).toEqual(SAVED);
  });

  it("412s a save for a team other than the one this code opens", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "b" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await post(POST, save(SAVED, "a"), { headers: { cookie: "site_auth=other-code" } });
    expect(res.status).toBe(412);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    expect((await post(POST, save(SAVED))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/league — narrow write", () => {
  it("adds squadi to a document that had none and leaves every other byte alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(SAVED));
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
    const res = await post(POST, save({ mode: "url", url: LINK_2 }));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual({ ...BLANK, mode: "url", url: LINK_2 });
    expectRestUntouched(saved, DATA({ squadi: SAVED }));
  });

  it("stores the sanitised set-up: known keys only, ids trimmed, the link normalised", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, save(
      { mode: "builder", url: "  " + LINK + "  ", org: " org-key ", yearId: 8, comp: " comp-key ", divisionId: "All", teamId: 110, secret: "x", team: { name: "smuggled" } }
    ));
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
    const res = await post(POST, { ...stale, ...save(SAVED) });
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual(SAVED);
    expectRestUntouched(saved, DATA());
    expect(saved.team.name).toBe("A");
    expect(saved.fixtures).toHaveLength(2);
    expect(saved.players).toHaveLength(2);
    expect("teamSlug" in saved).toBe(false);
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
    const res = await post(POST, save(SAVED));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.squadi).toEqual(SAVED);
    expect(saved.fixtures[1]).toEqual({ id: "f2", round: 2, us: 4, them: 0, status: "played" });
    expect(saved.fixtures[0].availability.p2).toEqual(rsvp);
    expectRestUntouched(saved, fresh);
  });

  it("the legacy owner's save stores what was sent, and from then on that is what its page gets", async () => {
    envTeams("a");
    coachSession();
    const { POST, GET } = await loadRoute({ authOn: true });
    const res = await post(POST, save({ mode: "url", url: LINK_2 }));
    expect(res.status).toBe(200);
    const stored = setData.mock.calls[0][1];
    // Nothing of the old default is written into the document.
    expect(stored.squadi).toEqual({ ...BLANK, mode: "url", url: LINK_2 });
    getData.mockResolvedValue(stored);
    expect(await (await GET(fakeRequest())).json()).toEqual({ teamSlug: "a", squadi: { ...BLANK, mode: "url", url: LINK_2 }, saved: true, draws: [] });
  });

  it("a team cleaned up on read is stored clean by its next save", async () => {
    envTeams("kangaroos-white", "a");
    coachSession();
    const before = DATA({ squadi: { ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK } });
    getData.mockResolvedValue(before);
    const { POST, GET } = await loadRoute({ authOn: true });
    // The page loads the cleaned set-up and posts it back as it is.
    const loaded = await (await GET(fakeRequest())).json();
    const res = await post(POST, { teamSlug: loaded.teamSlug, squadi: loaded.squadi });
    expect(res.status).toBe(200);
    const stored = setData.mock.calls[0][1];
    expect(stored.squadi).toEqual({ ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK, comp: "", divisionId: "", teamId: "" });
    expect(JSON.stringify(stored.squadi)).not.toMatch(/110013|10661|58ec2bda/);
    expectRestUntouched(stored, before);
  });

  it("never mutates the document it read", async () => {
    coachSession();
    const doc = DATA({ squadi: SAVED });
    const before = JSON.stringify(doc);
    getData.mockResolvedValue(doc);
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, save({ mode: "url", url: LINK_2 }));
    expect(JSON.stringify(doc)).toBe(before);
    expect(setData.mock.calls[0][1]).not.toBe(doc);
  });
});

describe("GET /api/league — the draws the club's set-up has a link for", () => {
  const KEY = "11111111-2222-4333-8444-555555555555";
  const SQ = `https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
  const DR = "https://winterleague.dribl.com/fixtures?season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468";
  const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FBrisbane";
  const REGISTRY = {
    slug: "a", name: "U8 Blues", password: "secret-team-code", calendarKey: "secret-calendar-key", coachEmails: ["coach@a.com"],
    squadi: { competitionId: "777", divisionId: "20001", teamId: 300001, link: SQ },
    competitions: [
      { id: "cdribl001", name: "Winter League", dribl: { url: REQUEST, team: "Riverside FC U8 Blues" }, link: DR },
      { id: "cnolink01", name: "Cup", squadi: { competitionId: "888", divisionId: "30001", teamId: 400001 } },
      { id: "csite0001", name: "Gala Day", link: "https://www.example.org/gala-day" }
    ]
  };

  it("lists the season's and each competition's, to any member, as links and names only", async () => {
    const { GET } = await loadRoute({ authOn: true });
    for (const signIn of [coachSession, parentSession, viewerSession]) {
      signIn();
      teamBySlug.mockImplementation(() => REGISTRY);
      const json = await (await GET(fakeRequest())).json();
      expect(json.draws).toEqual([
        { name: "Season", provider: "squadi", link: SQ, season: true },
        { name: "Winter League", provider: "dribl", link: DR },
        { name: "Gala Day", provider: "", link: "https://www.example.org/gala-day" }
      ]);
      // The team's code, its calendar key, its coaches, its sync ids, its Dribl
      // request and its team's name there stay on the server.
      expect(JSON.stringify(json)).not.toMatch(/secret-team-code|secret-calendar-key|coach@a\.com|competitionId|"777"|cdribl001|mc-api|Tn12345678|Riverside/);
    }
  });

  it("does not change what the team's own set-up says: the page decides what to show", async () => {
    getData.mockResolvedValue(DATA({ squadi: SAVED }));
    const { GET } = await loadRoute({ authOn: true });
    coachSession();
    teamBySlug.mockImplementation(() => REGISTRY);
    const json = await (await GET(fakeRequest())).json();
    expect(json).toMatchObject({ teamSlug: "a", squadi: SAVED, saved: true });
    expect(json.draws).toHaveLength(3);
  });
});
