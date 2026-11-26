import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { READ_ONLY_MESSAGE, PICK_TEAM_MESSAGE } from "@/lib/viewer";

// /api/competition-squad reads and writes ONLY data.competitionSquads: the coach's pick of who is in
// each competition's squad (lib/competitions.js). GET is open to every member
// and lists the team's competitions, each with its squad or null for everyone.
// POST is the coach hat's alone in account mode (any code holder in legacy
// mode), refused while a super admin is viewing as someone, takes one
// competition's squad at a time and replaces just that entry on a freshly
// read document. The route sits on the REAL lib/viewer, lib/hats and
// lib/competitions; AUTH_ON is module-load state, so each test re-imports it.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

// The team's registry entry: its season plus two other competitions, one with
// its draw in and one named ahead of its draw.
const WINTER = { id: "cwinter", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } };
const PREMIER = { id: "cprem", name: "Premier Invitational" };
const TEAM = (slug = "a", competitions = [WINTER, PREMIER]) => ({ slug, name: "Team " + slug, squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 }, competitions });

// A team document with something in every part a squad must never touch.
const DATA = (extra = {}) => ({
  team: { name: "A", ageGroup: "U8", coachPin: "4321", parentsSee: { liveScore: true }, rules: [{ id: "bi-period", builtin: true }] },
  players: [
    { id: "p1", name: "Sam", number: 7, coach: { ratings: { GK: 3, DEF: null, MID: 4, FWD: 2 }, note: "Left footed" } },
    { id: "p2", name: "Ava", number: 9 },
    { id: "p3", name: "Kim", number: 4 }
  ],
  fixtures: [
    {
      id: "f1", round: 1, us: 3, them: 1, gk: "p1", fruit: "p2",
      availability: { p1: { status: "in", by: "Coach", at: 1 } },
      plan: { subTimes: [10, 30], assignments: [{ GK: "p1" }], updatedAt: 1 }
    },
    { id: "w1", round: 1, comp: "cwinter", compName: "Winterfest", availability: { p2: { status: "out", reason: "Away", by: "Mum", at: 2 } } }
  ],
  sessions: [{ id: "s1", kind: "training", weekday: 2, time: "17:00", availability: { "2026-09-08": { p1: { status: "in" } } } }],
  squadi: { mode: "url", url: "https://registration.squadi.com/liveScoreSeasonFixture?x=1", org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" },
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
  // clearAllMocks keeps return values and implementations: reset what individual tests change.
  viewingAs.mockReturnValue(null);
  teamBySlug.mockImplementation((slug) => TEAM(slug));
  teamFromCookieHeader.mockReturnValue(null);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/competition-squad/route");
}

// The worn hat decides what a login may do (real lib/viewer + lib/hats over
// the mocked directory), so a session's intent lives in its membership roles.
function session(email, memberships) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships });
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
const pick = (playerIds, comp = "cwinter") => ({ comp, playerIds });

// Everything but squads must come back byte-identical.
function expectRestUntouched(saved, original) {
  const { competitionSquads: _a, ...rest } = saved;
  const { competitionSquads: _b, ...before } = original;
  expect(JSON.stringify(rest)).toBe(JSON.stringify(before));
}

describe("GET /api/competition-squad — account mode", () => {
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

  it("lists the team's competitions for any member, everyone in each until a squad is picked", async () => {
    const { GET } = await loadRoute({ authOn: true });
    for (const signIn of [coachSession, parentSession, viewerSession]) {
      signIn();
      const res = await GET(fakeRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ competitions: [
        { id: "cwinter", name: "Winterfest", playerIds: null },
        { id: "cprem", name: "Premier Invitational", playerIds: null }
      ] });
    }
    expect(getData).toHaveBeenCalledWith("a");
  });

  it("returns each picked squad, and nothing else from the registry entry or the document", async () => {
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p3", "p1"] } }));
    const { GET } = await loadRoute({ authOn: true });
    for (const signIn of [coachSession, parentSession, viewerSession]) {
      signIn();
      const json = await (await GET(fakeRequest())).json();
      expect(json).toEqual({ competitions: [
        { id: "cwinter", name: "Winterfest", playerIds: ["p1", "p3"] }, // the team's own order
        { id: "cprem", name: "Premier Invitational", playerIds: null }
      ] });
      // No Squadi ids, names, ratings, PIN or replies ride along.
      expect(Object.keys(json)).toEqual(["competitions"]);
      expect(JSON.stringify(json)).not.toMatch(/Sam|Left footed|4321|availability|1750|300123|squadi/);
    }
  });

  it("a stored squad is read as the players still on the team; one with nobody left is everyone", async () => {
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p2", "left-the-team", "p2"], cprem: ["gone", "also-gone"] } }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect((await (await GET(fakeRequest())).json()).competitions.map((c) => c.playerIds)).toEqual([["p2"], null]);
    // Stored junk is never served as a squad.
    for (const competitionSquads of [{ cwinter: "p1" }, { cwinter: { p1: true } }, "junk", ["p1"], null]) {
      getData.mockResolvedValue(DATA({ competitionSquads }));
      expect((await (await GET(fakeRequest())).json()).competitions.map((c) => c.playerIds)).toEqual([null, null]);
    }
  });

  it("a competition that only survives on the team's games is listed too, after the registry's", async () => {
    // Winterfest was removed in the wizard; its game, and its squad, are still on the document.
    teamBySlug.mockImplementation((slug) => TEAM(slug, [PREMIER]));
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p1"] } }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ competitions: [
      { id: "cprem", name: "Premier Invitational", playerIds: null },
      { id: "cwinter", name: "Winterfest", playerIds: ["p1"] }
    ] });
  });

  it("a team with only its season has no competitions to list, whatever squads are stored", async () => {
    teamBySlug.mockImplementation((slug) => ({ slug, squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 } }));
    getData.mockResolvedValue(DATA({ fixtures: [{ id: "f1", round: 1 }], competitionSquads: { cwinter: ["p1"] } }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ competitions: [] });
  });

  it("a team with no document yet still lists its competitions, with everyone in each", async () => {
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    for (const nothing of [null, [], "junk"]) {
      getData.mockResolvedValue(nothing);
      const res = await GET(fakeRequest());
      expect(res.status).toBe(200);
      expect((await res.json()).competitions.map((c) => [c.id, c.playerIds])).toEqual([["cwinter", null], ["cprem", null]]);
    }
  });

  it("honours the team_slug cookie: one team's competitions are never listed for another", async () => {
    twoTeamCoach();
    teamBySlug.mockImplementation((slug) => (slug === "b" ? TEAM("b", [{ id: "cbcup", name: "B Cup" }]) : TEAM(slug)));
    const { GET } = await loadRoute({ authOn: true });
    getData.mockResolvedValue(DATA({ fixtures: [] }));
    const res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(await res.json()).toEqual({ competitions: [{ id: "cbcup", name: "B Cup", playerIds: null }] });
    expect(getData).toHaveBeenLastCalledWith("b");
  });

  it("a super admin viewing as someone reads as that person (reads are allowed)", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent", playerId: "p1" }] });
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p1"] } }));
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
    expect((await res.json()).competitions[0]).toEqual({ id: "cwinter", name: "Winterfest", playerIds: ["p1"] });
  });

  it("never writes", async () => {
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p2", "left-the-team"] } }));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    await GET(fakeRequest());
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("GET /api/competition-squad — legacy team-code mode", () => {
  it("resolves the team from the site_auth cookie without a session", async () => {
    teamFromCookieHeader.mockReturnValue(TEAM("a"));
    getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p1"] } }));
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }));
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect((await res.json()).competitions.map((c) => [c.id, c.playerIds])).toEqual([["cwinter", ["p1"]], ["cprem", null]]);
  });

  it("401s when the cookie matches no team", async () => {
    const { GET } = await loadRoute({ authOn: false });
    expect((await GET(fakeRequest())).status).toBe(401);
    expect(getData).not.toHaveBeenCalled();
  });
});

describe("POST /api/competition-squad — validation", () => {
  it("400s on malformed JSON", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s unless the body names a competition and carries playerIds as a list or null (a whole team document included)", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const bodies = [
      null, "junk", 42, [], {},
      { comp: "cwinter" }, // leaving playerIds out is not a way to say everyone
      { playerIds: ["p1"] }, { comp: "", playerIds: ["p1"] }, { comp: 7, playerIds: ["p1"] }, { comp: ["cwinter"], playerIds: ["p1"] }, { comp: null, playerIds: null },
      { comp: "cwinter", playerIds: "p1" }, { comp: "cwinter", playerIds: "everyone" }, { comp: "cwinter", playerIds: 0 }, { comp: "cwinter", playerIds: true },
      { comp: "cwinter", playerIds: { p1: true } }, { comp: "cwinter", playerIds: { length: 1, 0: "p1" } },
      [{ comp: "cwinter", playerIds: ["p1"] }],
      { team: { name: "X" }, players: [], fixtures: [], competitionSquads: { cwinter: ["p1"] } }
    ];
    for (const body of bodies) {
      const res = await post(POST, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s, with a sentence, a competition that is not one of this team's, and writes nothing", async () => {
    coachSession();
    const { POST, NO_SUCH_COMPETITION } = await loadRoute({ authOn: true });
    // Another team's competition, the season (it has no id and is always everyone), names instead of ids, and object keys that are not competitions.
    for (const comp of ["cbcup", "season", "Winterfest", "CWINTER", " cwinter", "undefined", "null", "__proto__", "constructor", "toString"]) {
      const res = await post(POST, pick(["p1"], comp));
      expect(res.status, comp).toBe(400);
      expect(await res.json()).toEqual({ error: NO_SUCH_COMPETITION });
    }
    expect(NO_SUCH_COMPETITION).toBe("That competition is not one of this team's.");
    expect(setData).not.toHaveBeenCalled();
  });

  it("a team with only its season has nothing a squad can be picked for", async () => {
    teamBySlug.mockImplementation((slug) => ({ slug }));
    getData.mockResolvedValue(DATA({ fixtures: [{ id: "f1", round: 1 }] }));
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p1"]))).status).toBe(400);
    expect((await post(POST, pick(null))).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s when the team has no usable document yet (it never creates one)", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const nothing of [null, [], "junk"]) {
      getData.mockResolvedValue(nothing);
      const res = await post(POST, pick(["p1"]));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "no data" });
    }
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/competition-squad — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p1"]))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s a signed-in account with no memberships", async () => {
    session("stranger@x.com", []);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p1"]))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent, with the sentence the card shows: a family cannot put its own child in or out", async () => {
    parentSession();
    const { POST, COACH_ONLY } = await loadRoute({ authOn: true });
    for (const playerIds of [["p1"], ["p2", "p3"], null]) {
      const res = await post(POST, pick(playerIds));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: COACH_ONLY });
    }
    expect(COACH_ONLY).toBe("Only coaches can pick a squad.");
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a club admin (view-only on the team)", async () => {
    viewerSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p1"]));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only coaches can pick a squad.");
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a coach-parent who is acting as the parent (the worn hat decides)", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p1"]), { cookies: { act_as: "parent" } });
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
    // Without the act_as cookie the same login wears the coach hat and may save.
    expect((await post(POST, pick(["p1"]))).status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it("403s a save while a super admin is viewing as someone, before anything else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p1"]));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE });
    // Refused before the impersonated coach's memberships are even looked up.
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("who may save is settled before which competition was named", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p1"], "not-a-competition"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only coaches can pick a squad.");
    expect(setData).not.toHaveBeenCalled();
  });

  it("409s when the coach has several teams and none is chosen", async () => {
    twoTeamCoach();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p1"]))).status).toBe(409);
    expect(setData).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie: the squad lands on the chosen team, and one team's competition cannot be used on another", async () => {
    twoTeamCoach();
    teamBySlug.mockImplementation((slug) => (slug === "b" ? TEAM("b", [{ id: "cbcup", name: "B Cup" }]) : TEAM(slug)));
    getData.mockResolvedValue(DATA({ fixtures: [] }));
    const { POST } = await loadRoute({ authOn: true });
    let res = await post(POST, pick(["p1"], "cbcup"), { cookies: { team_slug: "b" } });
    expect(res.status).toBe(200);
    expect(getData).toHaveBeenLastCalledWith("b");
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0][0]).toBe("b");
    expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cbcup: ["p1"] });
    // A dashboard left open on team a, after the coach switched to team b in
    // another tab: team a's Winterfest is not one of team b's, so nothing is written.
    setData.mockClear();
    res = await post(POST, pick(["p1"], "cwinter"), { cookies: { team_slug: "b" } });
    expect(res.status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/competition-squad — legacy team-code mode", () => {
  it("lets any code holder save without a session", async () => {
    teamFromCookieHeader.mockReturnValue(TEAM("a"));
    const { POST } = await loadRoute({ authOn: false });
    const res = await post(POST, pick(["p1"]), { headers: { cookie: "site_auth=code" } });
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    expect(setData.mock.calls[0][0]).toBe("a");
    expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cwinter: ["p1"] });
  });

  it("401s without a valid team-code cookie", async () => {
    const { POST } = await loadRoute({ authOn: false });
    expect((await post(POST, pick(["p1"]))).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/competition-squad — narrow write", () => {
  it("adds squads to a document that had none and leaves every other byte alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p1", "p3"]));
    expect(res.status).toBe(200);
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.competitionSquads).toEqual({ cwinter: ["p1", "p3"] });
    expectRestUntouched(saved, DATA());
    expect(Object.keys(saved).sort()).toEqual([...Object.keys(DATA()), "competitionSquads"].sort());
    // The response echoes exactly what was stored.
    expect(await res.json()).toEqual({ ok: true, comp: "cwinter", playerIds: ["p1", "p3"] });
  });

  it("replaces that one competition's squad outright and leaves every other squad alone", async () => {
    coachSession();
    const before = DATA({ competitionSquads: { cwinter: ["p1", "p2"], cprem: ["p3"] } });
    getData.mockResolvedValue(before);
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p3"]));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.competitionSquads).toEqual({ cwinter: ["p3"], cprem: ["p3"] });
    expectRestUntouched(saved, before);
    // The stored document that was read is not edited in place.
    expect(before.competitionSquads).toEqual({ cwinter: ["p1", "p2"], cprem: ["p3"] });
  });

  it("stores the sanitised squad: this team's players only, each once, in the team's order", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(["p3", "another-teams-player", "p1", "p3", 7, null, { id: "p2" }]));
    expect(res.status).toBe(200);
    expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cwinter: ["p1", "p3"] });
    expect(await res.json()).toEqual({ ok: true, comp: "cwinter", playerIds: ["p1", "p3"] });
  });

  it("null puts everyone back: the entry is removed, not stored as null", async () => {
    coachSession();
    const before = DATA({ competitionSquads: { cwinter: ["p1"], cprem: ["p3"] } });
    getData.mockResolvedValue(before);
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, pick(null));
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.competitionSquads).toEqual({ cprem: ["p3"] });
    expect("cwinter" in saved.competitionSquads).toBe(false);
    expectRestUntouched(saved, before);
    expect(await res.json()).toEqual({ ok: true, comp: "cwinter", playerIds: null });
  });

  it("a list that leaves nobody is everyone too: a competition is never stored as for no one", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const playerIds of [[], ["another-teams-player"], [7, null]]) {
      setData.mockClear();
      getData.mockResolvedValue(DATA({ competitionSquads: { cwinter: ["p1"] } }));
      const res = await post(POST, pick(playerIds));
      expect(res.status).toBe(200);
      expect(setData.mock.calls[0][1].competitionSquads).toEqual({});
      expect(await res.json()).toEqual({ ok: true, comp: "cwinter", playerIds: null });
    }
  });

  it("a squad can be picked before the competition's draw is out, and for one that only survives on the team's games", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    // Premier Invitational is named in the wizard but has no draw and no games yet.
    expect((await post(POST, pick(["p2"], "cprem"))).status).toBe(200);
    expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cprem: ["p2"] });
    // Winterfest removed in the wizard: its game is still on the document, so its squad can still be changed.
    setData.mockClear();
    teamBySlug.mockImplementation((slug) => TEAM(slug, []));
    expect((await post(POST, pick(["p2"], "cwinter"))).status).toBe(200);
    expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cwinter: ["p2"] });
    // Premier Invitational is now on neither.
    setData.mockClear();
    expect((await post(POST, pick(["p2"], "cprem"))).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });

  it("writes nothing but squads, whatever else the body carries", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    // A stale whole document with a squad on it.
    const stale = DATA();
    stale.team.name = "Renamed by a stale tab";
    stale.fixtures = [];
    stale.players = [];
    const res = await post(POST, { ...stale, competitionSquads: { cprem: ["p1"] }, ...pick(["p2"]) });
    expect(res.status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.competitionSquads).toEqual({ cwinter: ["p2"] }); // the body's own "competitionSquads" is not read
    expectRestUntouched(saved, DATA());
    expect(saved.team.name).toBe("A");
    expect(saved.fixtures).toHaveLength(2);
    expect(saved.players).toHaveLength(3);
    expect("comp" in saved).toBe(false);
    expect("playerIds" in saved).toBe(false);
  });

  it("keeps a score and a reply that landed after the coach opened Team settings", async () => {
    coachSession();
    // What is in the store by the time the coach flips a switch: another coach
    // has entered a score and Kim's dad has replied. The card never had
    // either, and never sends them.
    const fresh = DATA();
    fresh.fixtures[0] = { ...fresh.fixtures[0], us: 5, them: 2, status: "played" };
    const rsvp = { status: "in", by: "Dad", at: 1720000000000 };
    fresh.fixtures[1].availability.p3 = rsvp;
    getData.mockResolvedValue(fresh);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p1"]))).status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.competitionSquads).toEqual({ cwinter: ["p1"] });
    expect(saved.fixtures[0]).toMatchObject({ us: 5, them: 2, status: "played" });
    expect(saved.fixtures[1].availability.p3).toEqual(rsvp);
    expectRestUntouched(saved, fresh);
  });

  it("leaving the squad never deletes a reply already given: availability is not touched", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    // Ava replied "out" for the Winterfest game; the coach then picks a squad without her.
    expect((await post(POST, pick(["p1", "p3"]))).status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.fixtures[1].availability).toEqual({ p2: { status: "out", reason: "Away", by: "Mum", at: 2 } });
  });

  it("stored squads that are not an object are replaced by a clean one", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const competitionSquads of ["junk", ["p1"], null, 7]) {
      setData.mockClear();
      getData.mockResolvedValue(DATA({ competitionSquads }));
      expect((await post(POST, pick(["p1"]))).status).toBe(200);
      expect(setData.mock.calls[0][1].competitionSquads).toEqual({ cwinter: ["p1"] });
    }
  });

  it("what was picked is what the next read returns", async () => {
    coachSession();
    const { POST, GET } = await loadRoute({ authOn: true });
    expect((await post(POST, pick(["p3", "p1"]))).status).toBe(200);
    getData.mockResolvedValue(setData.mock.calls[0][1]);
    expect((await (await GET(fakeRequest())).json()).competitions).toEqual([
      { id: "cwinter", name: "Winterfest", playerIds: ["p1", "p3"] },
      { id: "cprem", name: "Premier Invitational", playerIds: null }
    ]);
  });

  it("a failed store write surfaces as a failure, not a quiet success", async () => {
    coachSession();
    setData.mockRejectedValue(new Error("store down"));
    const { POST } = await loadRoute({ authOn: true });
    await expect(post(POST, pick(["p1"]))).rejects.toThrow("store down");
  });
});
