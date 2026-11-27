import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { READ_ONLY_MESSAGE, PICK_TEAM_MESSAGE } from "@/lib/viewer";

// /api/dribl is the Dribl half of the fixture sync. Dribl answers browsers but
// not servers, so a coach's browser fetches a competition's draw and posts the
// games here. GET says what to fetch (only to someone who may post the
// result); POST checks every record and applies each draw to its competition
// exactly as a Squadi draw is applied. The route sits on the REAL lib/viewer,
// lib/hats, lib/competitions, lib/dribl and lib/applyDraws, over a mocked
// store; applySync is the real one too, so what is saved is what a sync saves.
const { auth, getData, setData, getMeta, setMeta, teamBySlug, teamFromCookieHeader, getTeams, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(), getMeta: vi.fn(), setMeta: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(), getTeams: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData, getMeta, setMeta }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader, getTeams }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=S1&competition=C1&league=L1&club=CL1&tenant=T1&timezone=Australia%2FBrisbane";
const REQUEST_2 = REQUEST.replace("league=L1", "league=L2");
// The team's registry entry: a season on Squadi, one competition on Squadi,
// two on Dribl (one with the team's name given) and one named ahead of its draw.
const WINTER = { id: "cwinter", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } };
const PREMIER = { id: "cprem", name: "Premier Invitational", dribl: { url: REQUEST } };
const CUP = { id: "ccup", name: "Cup", dribl: { url: REQUEST_2, team: "Olympic FC U9 White" } };
const LATER = { id: "clater", name: "Not published" };
const TEAM = (slug = "a", competitions = [WINTER, PREMIER, CUP, LATER]) => ({ slug, name: "Team " + slug, squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 }, competitions });

// Pin "now": applySync decides played / upcoming from the date.
const NOW = new Date("2027-03-01T02:00:00Z");
// Game n is n weeks after Saturday 6 March 2027: 13 March, 20 March, and so on.
const weekOf = (n) => new Date(Date.UTC(2027, 2, 6 + n * 7)).toISOString().slice(0, 10);
const game = (n, over = {}) => ({ squadiId: "dribl:g" + n, round: n, dateISO: weekOf(n), time: "09:00", opponent: "Opponent " + n, homeAway: "H", venue: "Lions Park – Field " + n, opponentLogo: "", ourLogo: "", ...over });
const DATA = (extra = {}) => ({
  team: { name: "A", coachPin: "4321" },
  players: [{ id: "p1", name: "Sam", coach: { note: "Left footed" } }],
  fixtures: [
    { id: "f1", round: 1, dateISO: "2027-03-06", time: "08:00", opponent: "Wests", venue: "Perry Park", homeAway: "H", status: "upcoming", squadiId: 555, availability: { p1: { status: "in", by: "Mum", at: 1 } } }
  ],
  sessions: [], isSample: false, ...extra
});

let savedSecret, savedResend, savedNotify;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  savedSecret = process.env.AUTH_SECRET; savedResend = process.env.RESEND_API_KEY; savedNotify = process.env.NOTIFY_EMAILS;
  delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAILS;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
  getMeta.mockResolvedValue({});
  setMeta.mockResolvedValue();
  viewingAs.mockReturnValue(null);
  teamBySlug.mockImplementation((slug) => TEAM(slug));
  teamFromCookieHeader.mockReturnValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  const put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  put("AUTH_SECRET", savedSecret); put("RESEND_API_KEY", savedResend); put("NOTIFY_EMAILS", savedNotify);
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/dribl/route");
}
function session(email, memberships) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships });
}
const coachSession = () => session("coach@a.com", [{ teamSlug: "a", role: "coach" }]);
const parentSession = () => session("mum@a.com", [{ teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }]);
const viewerSession = () => session("td@club.com", [{ teamSlug: "a", role: "viewer", clubAdmin: true }]);
const coachParentSession = () => session("coach@a.com", [{ teamSlug: "a", role: "coach" }, { teamSlug: "a", role: "parent", playerId: "p1", playerName: "Sam" }]);
const twoTeamCoach = () => session("coach@a.com", [{ teamSlug: "a", role: "coach" }, { teamSlug: "b", role: "coach" }]);

const post = (POST, body, extra = {}) => POST(fakeRequest({ body, ...extra }));
const draws = (records = [game(1), game(2)], comp = "cprem") => ({ draws: [{ comp, records }] });
const SOURCES = [
  { comp: "cprem", name: "Premier Invitational", url: REQUEST, team: "" },
  { comp: "ccup", name: "Cup", url: REQUEST_2, team: "Olympic FC U9 White" }
];

describe("GET /api/dribl — what this browser should fetch", () => {
  it("401s when not signed in, and 409s when several teams and none is chosen", async () => {
    auth.mockResolvedValue(null);
    const { GET } = await loadRoute({ authOn: true });
    expect((await GET(fakeRequest())).status).toBe(401);
    twoTeamCoach();
    const res = await GET(fakeRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: PICK_TEAM_MESSAGE });
  });

  it("gives a coach the team's Dribl draws, and only those: not Squadi's, not one with no source yet", async () => {
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sources: SOURCES, due: true });
    expect(getMeta).toHaveBeenCalledWith("a");
  });

  it("gives nobody else anything to fetch: a parent, a club admin, a coach wearing the parent hat", async () => {
    const { GET } = await loadRoute({ authOn: true });
    for (const [signIn, extra] of [[parentSession, {}], [viewerSession, {}], [coachParentSession, { cookies: { act_as: "parent" } }]]) {
      signIn();
      const res = await GET(fakeRequest(extra));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sources: [], due: false });
    }
    // Nothing about the draws is read for them, not even when one last ran.
    expect(getMeta).not.toHaveBeenCalled();
  });

  it("is refused while a super admin is viewing as someone: that browser must not sync either", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE });
  });

  it("a sync is owed only when none ran in the last 15 minutes", async () => {
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    const due = async () => (await (await GET(fakeRequest())).json()).due;
    getMeta.mockResolvedValue({ lastDriblSyncAt: NOW.getTime() - 14 * 60 * 1000 });
    expect(await due()).toBe(false);
    getMeta.mockResolvedValue({ lastDriblSyncAt: NOW.getTime() - 15 * 60 * 1000 });
    expect(await due()).toBe(true);
    // The Squadi sync's own clock has no say.
    getMeta.mockResolvedValue({ lastSyncAt: NOW.getTime() });
    expect(await due()).toBe(true);
    getMeta.mockResolvedValue(null);
    expect(await due()).toBe(true);
  });

  it("a team with no draw on Dribl has nothing to fetch, and never writes", async () => {
    teamBySlug.mockImplementation((slug) => TEAM(slug, [WINTER, LATER]));
    coachSession();
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest())).json()).toEqual({ sources: [], due: false });
    teamBySlug.mockImplementation((slug) => ({ slug }));
    expect(await (await GET(fakeRequest())).json()).toEqual({ sources: [], due: false });
    expect(setData).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie, and never hands out a stored link that is not a Dribl request", async () => {
    twoTeamCoach();
    teamBySlug.mockImplementation((slug) => (slug === "b"
      ? TEAM("b", [{ id: "cb", name: "B Cup", dribl: { url: REQUEST_2 } }, { id: "cbad", name: "Tampered", dribl: { url: "https://evil.example/api/fixtures?tenant=T1" } }])
      : TEAM(slug)));
    const { GET } = await loadRoute({ authOn: true });
    const json = await (await GET(fakeRequest({ cookies: { team_slug: "b" } }))).json();
    expect(json.sources).toEqual([{ comp: "cb", name: "B Cup", url: REQUEST_2, team: "" }]);
    expect(getMeta).toHaveBeenLastCalledWith("b");
  });

  it("legacy team-code mode: anyone holding the code may sync, as with the other writes", async () => {
    teamFromCookieHeader.mockReturnValue(TEAM("a"));
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }));
    expect(await res.json()).toEqual({ sources: SOURCES, due: true });
    expect(auth).not.toHaveBeenCalled();
    teamFromCookieHeader.mockReturnValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
  });
});

describe("POST /api/dribl — validation", () => {
  it("400s on malformed JSON", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
  });

  it("400s unless the body is a list of draws, each naming its competition", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const bodies = [
      null, "junk", 7, [], {}, { draws: null }, { draws: {} }, { draws: [] }, { draws: "cprem" },
      { draws: [null] }, { draws: ["cprem"] }, { draws: [[game(1)]] }, { draws: [{ records: [game(1)] }] },
      { draws: [{ comp: "", records: [] }] }, { draws: [{ comp: 7, records: [] }] },
      { comp: "cprem", records: [game(1)] },                       // one draw, not in a list
      { team: { name: "X" }, players: [], fixtures: [game(1)] }    // a whole team document
    ];
    for (const body of bodies) {
      const res = await post(POST, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s when a draw's records are not a list", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    for (const records of [undefined, null, "x", { 0: game(1) }, 3]) {
      const res = await post(POST, { draws: [{ comp: "cprem", records }] });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad request" });
    }
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s, with a sentence, a draw for anything that is not one of this team's Dribl competitions", async () => {
    coachSession();
    const { POST, NOT_A_DRIBL_COMPETITION } = await loadRoute({ authOn: true });
    // A competition on Squadi, one with no source, the season, another team's, a made-up one.
    for (const comp of ["cwinter", "clater", "season", "cb", "nope", "__proto__", "constructor"]) {
      const res = await post(POST, draws([game(1)], comp));
      expect(res.status, comp).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_A_DRIBL_COMPETITION });
    }
    expect(NOT_A_DRIBL_COMPETITION).toBe("That competition does not take its draw from Dribl.");
    // One bad draw refuses the lot: nothing of the good one is written.
    const res = await post(POST, { draws: [{ comp: "cprem", records: [game(1)] }, { comp: "cwinter", records: [game(2)] }] });
    expect(res.status).toBe(400);
    // The same competition twice is refused too.
    expect((await post(POST, { draws: [{ comp: "cprem", records: [game(1)] }, { comp: "cprem", records: [game(2)] }] })).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });

  it("404s when the team has no document yet (a sync never creates one)", async () => {
    coachSession();
    getData.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no data" });
    expect(setData).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });
});

describe("POST /api/dribl — who may post", () => {
  it("401s when not signed in or with no memberships", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, draws())).status).toBe(401);
    session("stranger@x.com", []);
    expect((await post(POST, draws())).status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent and a club admin, with a sentence: a family cannot post games", async () => {
    const { POST, COACH_ONLY } = await loadRoute({ authOn: true });
    for (const signIn of [parentSession, viewerSession]) {
      signIn();
      const res = await post(POST, draws());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: COACH_ONLY });
    }
    expect(COACH_ONLY).toBe("Only coaches can sync a draw.");
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("the worn hat decides: a coach-parent acting as the parent is refused", async () => {
    coachParentSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, draws(), { cookies: { act_as: "parent" } })).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
    expect((await post(POST, draws())).status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
  });

  it("403s while a super admin is viewing as someone, before anything else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE });
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("who may post is settled before which competition was named", async () => {
    parentSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws([game(1)], "not-a-competition"));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("legacy team-code mode: anyone holding the code may post; nobody without it", async () => {
    teamFromCookieHeader.mockReturnValue(TEAM("a"));
    const { POST } = await loadRoute({ authOn: false });
    expect((await post(POST, draws(), { headers: { cookie: "site_auth=code" } })).status).toBe(200);
    expect(setData.mock.calls[0][0]).toBe("a");
    teamFromCookieHeader.mockReturnValue(null);
    expect((await post(POST, draws())).status).toBe(401);
  });

  it("honours the team_slug cookie: one team's competition cannot be posted to another", async () => {
    twoTeamCoach();
    teamBySlug.mockImplementation((slug) => (slug === "b" ? TEAM("b", [{ id: "cb", name: "B Cup", dribl: { url: REQUEST_2 } }]) : TEAM(slug)));
    const { POST } = await loadRoute({ authOn: true });
    expect((await post(POST, draws([game(1)], "cb"), { cookies: { team_slug: "b" } })).status).toBe(200);
    expect(setData.mock.calls[0][0]).toBe("b");
    setData.mockClear();
    expect((await post(POST, draws([game(1)], "cprem"), { cookies: { team_slug: "b" } })).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/dribl — applying a draw", () => {
  const saved = () => setData.mock.calls[0][1];
  const premier = (doc) => doc.fixtures.filter((f) => f.comp === "cprem");

  it("adds the draw's games to its competition, tagged with it, and leaves everything else alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws([game(1), game(2, { homeAway: "A" })]));
    expect(res.status).toBe(200);
    const doc = saved();
    expect(setData.mock.calls[0][0]).toBe("a");
    expect(premier(doc).map((f) => [f.squadiId, f.round, f.dateISO, f.time, f.opponent, f.homeAway, f.venue, f.compName, f.status]))
      .toEqual([
        ["dribl:g1", 1, "2027-03-13", "09:00", "Opponent 1", "H", "Lions Park – Field 1", "Premier Invitational", "upcoming"],
        ["dribl:g2", 2, "2027-03-20", "09:00", "Opponent 2", "A", "Lions Park – Field 2", "Premier Invitational", "upcoming"]
      ]);
    // The season game that was there is untouched, reply and all, and it is not retagged.
    expect(doc.fixtures[0]).toEqual(DATA().fixtures[0]);
    const { fixtures: _a, isSample: _b, ...rest } = doc;
    const { fixtures: _c, isSample: _d, ...before } = DATA();
    expect(JSON.stringify(rest)).toBe(JSON.stringify(before));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, matchesSeen: 2, created: 2 });
    expect(json.changes).toHaveLength(2);
    expect(json.changes[0]).toMatch(/^NEW — Premier Invitational Round 1 vs Opponent 1: /);
  });

  it("a game with no round (a final) is named by its competition alone", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws([game(1, { round: null, opponent: "Lions" })]));
    expect((await res.json()).changes[0]).toMatch(/^NEW — Premier Invitational vs Lions: /);
    expect(premier(saved())[0].round).toBeNull();
  });

  it("never matches a Dribl game to a season game of the same round, and a second post changes nothing", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, draws([game(1)]));       // the season has a round 1 too (f1)
    const first = saved();
    expect(first.fixtures).toHaveLength(2);
    expect(first.fixtures[0].comp).toBeUndefined();
    // The same draw again, onto what was saved: nothing to change, nothing saved.
    setData.mockClear();
    getData.mockResolvedValue(first);
    const res = await post(POST, draws([game(1)]));
    expect(await res.json()).toMatchObject({ ok: true, created: 0, changes: [], emailStatus: "no changes" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("a moved game is updated in place and reported, keeping what the team has added to it", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, draws([game(1)]));
    const first = saved();
    const mine = premier(first)[0];
    // Since then a reply and a duty have gone onto that game.
    const withReply = { ...first, fixtures: first.fixtures.map((f) => (f.id === mine.id ? { ...f, availability: { p1: { status: "in" } }, fruit: "p1" } : f)) };
    setData.mockClear();
    getData.mockResolvedValue(withReply);
    const res = await post(POST, draws([game(1, { time: "10:30", venue: "Perry Park – Field 3" })]));
    const json = await res.json();
    expect(json.created).toBe(0);
    expect(json.changes).toHaveLength(1);
    expect(json.changes[0]).toMatch(/^Premier Invitational Round 1 vs Opponent 1: time .* 10:30; venue /);
    const after = premier(saved())[0];
    expect(after).toMatchObject({ id: mine.id, time: "10:30", venue: "Perry Park – Field 3", availability: { p1: { status: "in" } }, fruit: "p1" });
    expect(after.schedChanges.map((c) => c.field)).toEqual(["New game", "Time", "Venue"]);
  });

  it("fills a played game's empty score from Dribl only for a competition set up to take its scores, and never changes one", async () => {
    coachSession();
    const PAST = { ...game(1), dateISO: "2027-02-27", score: { us: 3, them: 2 } };
    teamBySlug.mockImplementation((slug) => TEAM(slug, [WINTER, { ...PREMIER, scores: true }, CUP, LATER]));
    let { POST } = await loadRoute({ authOn: true });
    await post(POST, draws([PAST]));
    expect(premier(saved()).map((f) => [f.us, f.them, f.status, f.scoreFrom])).toEqual([[3, 2, "played", "Dribl"]]);
    // A score already there, typed in by a coach, stays as it is.
    setData.mockClear();
    getData.mockResolvedValue(DATA({ fixtures: [{ id: "f9", squadiId: "dribl:g1", comp: "cprem", compName: PREMIER.name, round: 1, dateISO: "2027-02-27", time: "09:00", opponent: "Opponent 1", venue: "Lions Park – Field 1", homeAway: "H", status: "played", us: 1, them: 1 }] }));
    await post(POST, draws([PAST]));
    expect(setData).not.toHaveBeenCalled();
    // Set up with its scores entered by hand, the competition takes none.
    setData.mockClear();
    getData.mockResolvedValue(DATA());
    teamBySlug.mockImplementation((slug) => TEAM(slug));
    ({ POST } = await loadRoute({ authOn: true }));
    await post(POST, draws([PAST]));
    expect(premier(saved()).map((f) => [f.us, f.them, f.scoreFrom])).toEqual([[null, null, undefined]]);
  });

  it("applies several competitions' draws in one save, each to its own competition", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { draws: [{ comp: "cprem", records: [game(1)] }, { comp: "ccup", records: [game(2), game(3)] }] });
    expect(res.status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(saved().fixtures.slice(1).map((f) => [f.squadiId, f.comp, f.compName])).toEqual([["dribl:g1", "cprem", "Premier Invitational"], ["dribl:g2", "ccup", "Cup"], ["dribl:g3", "ccup", "Cup"]]);
    expect(await res.json()).toMatchObject({ matchesSeen: 3, created: 3 });
  });

  it("the competition's name comes from the registry, never from what was posted", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, { draws: [{ comp: "cprem", name: "Hacked", compName: "Hacked", records: [game(1, { comp: "cwinter", compName: "Winterfest" })] }] });
    expect(premier(saved())).toHaveLength(1);
    expect(premier(saved())[0].compName).toBe("Premier Invitational");
  });

  it("checks every record: only real games get in, and nothing rides along on one", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const records = [
      game(1, { availability: { p1: { status: "in" } }, us: 9, them: 0, id: "f1", notes: "smuggled", status: "played" }),
      game(2, { squadiId: "555" }),                 // not a Dribl id: could be mistaken for the season's game
      game(3, { dateISO: "not a date" }),
      game(4, { opponent: "" }),
      "junk", null,
      game(5, { opponentLogo: "javascript:alert(1)", venue: "<b>x</b>".repeat(60) })
    ];
    const res = await post(POST, draws(records));
    expect(res.status).toBe(200);
    const got = premier(saved());
    expect(got.map((f) => f.squadiId)).toEqual(["dribl:g1", "dribl:g5"]);
    expect(got[0]).toMatchObject({ us: null, them: null, notes: "", status: "upcoming" });
    expect("availability" in got[0]).toBe(false);
    expect(got[0].id).not.toBe("f1");
    expect(got[1].opponentLogo).toBe("");
    expect(got[1].venue).toHaveLength(120);
    // The season's own game is exactly as it was.
    expect(saved().fixtures[0]).toEqual(DATA().fixtures[0]);
  });

  it("an empty draw (not published yet) changes nothing, and still counts as a sync that ran", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, draws([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matchesSeen: 0, created: 0, changes: [], emailStatus: "no changes" });
    expect(setData).not.toHaveBeenCalled();
    expect(setMeta).toHaveBeenCalledTimes(1);
  });

  it("stamps its own clock and leaves the Squadi sync's alone", async () => {
    coachSession();
    getMeta.mockResolvedValue({ lastSyncAt: 111, other: "kept" });
    const { POST } = await loadRoute({ authOn: true });
    await post(POST, draws());
    expect(setMeta).toHaveBeenCalledWith("a", { lastSyncAt: 111, other: "kept", lastDriblSyncAt: NOW.getTime() });
  });

  it("a draw's first import is not news; a later change is emailed as coming from Dribl", async () => {
    process.env.RESEND_API_KEY = "re_x"; process.env.NOTIFY_EMAILS = "coach@a.com";
    const sent = [];
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url, opts) => { sent.push({ url: String(url), body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; });
    try {
      coachSession();
      const { POST } = await loadRoute({ authOn: true });
      // Five new games at once: the draw arriving.
      let res = await post(POST, draws([1, 2, 3, 4, 5].map((n) => game(n))));
      expect((await res.json()).emailStatus).toBe("initial import — email skipped");
      expect(sent).toEqual([]);
      expect(premier(saved()).every((f) => f.schedChanges.length === 0)).toBe(true);
      // Then one of them moves.
      getData.mockResolvedValue(saved());
      setData.mockClear();
      res = await post(POST, draws([1, 2, 3, 4, 5].map((n) => game(n, n === 3 ? { time: "11:15" } : {}))));
      expect((await res.json()).emailStatus).toBe("emailed");
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe("https://api.resend.com/emails");
      expect(sent[0].body.text).toMatch(/^Fixture changes for Team a just came through from Dribl:/);
      expect(sent[0].body.text).toMatch(/Premier Invitational Round 3 vs Opponent 3: time /);
    } finally { global.fetch = realFetch; }
  });
});

// The scheduled Dribl reader (scripts/dribl-sync.mjs) uses the same two calls
// with the scheduled-job key, CRON_SECRET, in the Authorization header. It is
// asked for every team's Dribl draws, and posts each team's draws by slug.
describe("/api/dribl — the scheduled reader", () => {
  const KEY = { authorization: "Bearer cr0n-key" };
  const OTHER = { id: "cother", name: "Shield", dribl: { url: REQUEST.replace("club=CL1", "club=CL2"), team: "Riverside FC U10" } };
  let savedCron;
  beforeEach(() => {
    savedCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cr0n-key";
    const club = [TEAM("a"), TEAM("b", [WINTER, LATER]), TEAM("c", [OTHER])];
    getTeams.mockResolvedValue(club);
    teamBySlug.mockImplementation((slug) => club.find((t) => t.slug === slug) || null);
  });
  afterEach(() => { if (savedCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedCron; });

  it("GET lists every team's Dribl draws, by slug, and skips a team with none", async () => {
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ headers: KEY }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ teams: [
      { team: "a", sources: SOURCES },
      { team: "c", sources: [{ comp: "cother", name: "Shield", url: OTHER.dribl.url, team: "Riverside FC U10" }] }
    ] });
    // Nobody signed in, and no team document or sync clock was read to answer.
    expect(auth).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(getMeta).not.toHaveBeenCalled();
  });

  it("GET with no Dribl draws anywhere is an empty list", async () => {
    getTeams.mockResolvedValue([TEAM("b", [WINTER, LATER])]);
    const { GET } = await loadRoute({ authOn: true });
    expect(await (await GET(fakeRequest({ headers: KEY }))).json()).toEqual({ teams: [] });
  });

  it("the key goes only in the Authorization header: a wrong one, ?key=, or none is treated as an ordinary visitor", async () => {
    auth.mockResolvedValue(null);
    const { GET, POST } = await loadRoute({ authOn: true });
    for (const extra of [{}, { headers: { authorization: "Bearer wrong" } }, { headers: { authorization: "cr0n-key" } }, { url: "https://x.test/api/dribl?key=cr0n-key" }]) {
      expect((await GET(fakeRequest(extra))).status, JSON.stringify(extra)).toBe(401);
      expect((await post(POST, { team: "a", ...draws() }, extra)).status, JSON.stringify(extra)).toBe(401);
    }
    expect(getTeams).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("with no CRON_SECRET set, nothing is the scheduled reader, whatever is sent", async () => {
    delete process.env.CRON_SECRET;
    auth.mockResolvedValue(null);
    const { GET, POST } = await loadRoute({ authOn: true });
    for (const headers of [{ authorization: "Bearer " }, { authorization: "Bearer undefined" }, KEY]) {
      expect((await GET(fakeRequest({ headers }))).status).toBe(401);
      expect((await post(POST, { team: "a", ...draws() }, { headers })).status).toBe(401);
    }
    expect(setData).not.toHaveBeenCalled();
  });

  it("POST applies one team's draws, named by slug, exactly as a coach's are", async () => {
    const { POST } = await loadRoute({ authOn: true });
    const res = await post(POST, { team: "a", ...draws() }, { headers: KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, matchesSeen: 2, created: 2 });
    expect(teamBySlug).toHaveBeenCalledWith("a");
    expect(auth).not.toHaveBeenCalled();
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    const added = saved.fixtures.filter((f) => f.comp === "cprem");
    expect(added.map((f) => [f.squadiId, f.compName, f.opponent])).toEqual([["dribl:g1", PREMIER.name, "Opponent 1"], ["dribl:g2", PREMIER.name, "Opponent 2"]]);
    // Everything the team had is still there, untouched.
    expect(saved.fixtures.find((f) => f.id === "f1").availability).toEqual({ p1: { status: "in", by: "Mum", at: 1 } });
    expect(saved.players).toEqual(DATA().players);
    expect(setMeta.mock.calls.at(-1)).toEqual(["a", { lastDriblSyncAt: NOW.getTime() }]);
  });

  it("POST checks a team's draws as a coach's are checked: only its own Dribl competitions, and only real games", async () => {
    const { POST, NOT_A_DRIBL_COMPETITION } = await loadRoute({ authOn: true });
    // Another team's competition, a Squadi competition, one named twice: refused with the sentence.
    for (const body of [{ team: "a", ...draws(undefined, "cother") }, { team: "a", ...draws(undefined, "cwinter") }, { team: "b", ...draws() },
      { team: "a", draws: [{ comp: "cprem", records: [game(1)] }, { comp: "cprem", records: [game(2)] }] }]) {
      const res = await post(POST, body, { headers: KEY });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_A_DRIBL_COMPETITION });
    }
    expect((await post(POST, { team: "a", draws: [{ comp: "cprem", records: "games" }] }, { headers: KEY })).status).toBe(400);
    // A record that is not a game is dropped, and nothing rides along on one that is.
    await post(POST, { team: "a", draws: [{ comp: "cprem", records: [game(1, { us: 9, notes: "x", availability: { p1: "out" } }), { squadiId: "dribl:x" }, "y"] }] }, { headers: KEY });
    const added = setData.mock.calls[0][1].fixtures.filter((f) => f.comp === "cprem");
    expect(added).toHaveLength(1);
    expect([added[0].us, added[0].notes, added[0].availability]).toEqual([null, "", undefined]);
  });

  it("POST to a slug that is no team is a 404 with a sentence; one with no document yet is a 404 too", async () => {
    teamBySlug.mockImplementation((slug) => (slug === "a" ? TEAM("a") : null));
    const { POST, NO_SUCH_TEAM } = await loadRoute({ authOn: true });
    expect(NO_SUCH_TEAM).toBe("There is no team with that slug.");
    for (const team of ["nope", "", undefined, 7, ["a"]]) {
      const res = await post(POST, { team, ...draws() }, { headers: KEY });
      expect(res.status, String(team)).toBe(404);
      expect(await res.json()).toEqual({ error: NO_SUCH_TEAM });
    }
    getData.mockResolvedValue(null);
    expect((await post(POST, { team: "a", ...draws() }, { headers: KEY })).status).toBe(404);
    expect(setData).not.toHaveBeenCalled();
  });

  it("a malformed body is refused before the key is looked at", async () => {
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ headers: KEY }))).status).toBe(400);
    for (const body of [[], { team: "a" }, { team: "a", draws: [] }, { team: "a", draws: [{ records: [] }] }]) {
      expect((await post(POST, body, { headers: KEY })).status).toBe(400);
    }
    expect(teamBySlug).not.toHaveBeenCalled();
  });

  it("works the same in legacy team-code mode: the key, not the code, decides", async () => {
    const { GET, POST } = await loadRoute({ authOn: false });
    expect((await (await GET(fakeRequest({ headers: KEY }))).json()).teams).toHaveLength(2);
    expect((await post(POST, { team: "a", ...draws() }, { headers: KEY })).status).toBe(200);
  });
});
