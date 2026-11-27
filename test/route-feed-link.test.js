import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { COMP as MAJESTRI_COMP, TEAM_PAGE as MAJESTRI_TEAM_PAGE, PAGE as MAJESTRI_PAGE } from "./helpers/majestriPage";
import { NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM, DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";

// POST /api/feed-link: reads a fixtures link pasted into the team wizard and
// says what it found. The link reader is real; the session, the directory and
// the Squadi lookup are mocked. Every key and id is made up.
const { auth, isAdminEmail, isClubAdminEmail, lookupSquadiLink } = vi.hoisted(() => ({
  auth: vi.fn(), isAdminEmail: vi.fn(), isClubAdminEmail: vi.fn(), lookupSquadiLink: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, isClubAdminEmail }));
vi.mock("@/lib/squadiLookup", () => ({ lookupSquadiLink }));

const SQUADI = "https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=11111111-2222-4333-8444-555555555555&divisionId=20001&teamId=300001";
const DRIBL = "https://winterleague.dribl.com/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FBrisbane";
const FOUND = { provider: "squadi", link: SQUADI, squadi: { competitionId: "777", divisionId: "20001", teamId: 300001 }, found: { competition: "Winter League", division: "Under 8", team: "Riverside FC U8 Blues", games: 14 } };

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  isAdminEmail.mockImplementation((e) => e === "owner@example.com");
  isClubAdminEmail.mockResolvedValue(false);
  lookupSquadiLink.mockResolvedValue(FOUND);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return (await import("@/app/api/feed-link/route")).POST;
}
const post = async (POST, body) => { const res = await POST(fakeRequest({ body })); return { status: res.status, body: await res.json() }; };

describe("POST /api/feed-link", () => {
  it("is for the people who set teams up: a super admin or a club admin, signed in", async () => {
    const off = await loadRoute({ authOn: false });
    expect((await post(off, { link: SQUADI })).status).toBe(400);
    expect(auth).not.toHaveBeenCalled();

    const POST = await loadRoute();
    auth.mockResolvedValue(null);
    expect(await post(POST, { link: SQUADI })).toEqual({ status: 401, body: { error: "unauthorized" } });
    auth.mockResolvedValue({ user: { email: "coach@example.com" } });
    expect(await post(POST, { link: SQUADI })).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(lookupSquadiLink).not.toHaveBeenCalled(); // a coach or a parent cannot make the server ask Squadi anything
    isClubAdminEmail.mockResolvedValue(true);
    expect((await post(POST, { link: SQUADI })).status).toBe(200);
  });

  it("a Squadi link is looked up, and the ids and what was found come back", async () => {
    const POST = await loadRoute();
    expect(await post(POST, { link: `  ${SQUADI}  ` })).toEqual({ status: 200, body: { ok: true, ...FOUND } });
    expect(lookupSquadiLink).toHaveBeenCalledWith(SQUADI); // the checked, normalised link
  });

  it("what the lookup could not do is passed on as it was said", async () => {
    const POST = await loadRoute();
    lookupSquadiLink.mockResolvedValue({ error: "Squadi could not be reached just now. Try again in a minute." });
    expect(await post(POST, { link: SQUADI })).toEqual({ status: 400, body: { error: "Squadi could not be reached just now. Try again in a minute." } });
  });

  it("a Dribl link is not read here: the browser reads it, and the server asks nobody anything", async () => {
    const POST = await loadRoute();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await post(POST, { link: DRIBL })).toEqual({ status: 400, body: { error: "A Dribl link is read by the browser, not by the server." } });
    // One that does not name a draw is told that, as it would be in the wizard.
    expect(await post(POST, { link: "https://winterleague.dribl.com/fixtures?date_range=all" })).toEqual({ status: 400, body: { error: DRIBL_NEEDS_COMPETITION } });
    expect(lookupSquadiLink).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("anything that is not a team's fixtures link is refused with what to do, and nothing is looked up", async () => {
    const POST = await loadRoute();
    for (const link of ["https://example.com/fixtures", "not a link", "", undefined, 7, { href: SQUADI }]) {
      expect(await post(POST, { link })).toEqual({ status: 400, body: { error: NOT_A_FEED_LINK } });
    }
    expect(await post(POST, { link: SQUADI.replace("&teamId=300001", "") })).toEqual({ status: 400, body: { error: SQUADI_NEEDS_TEAM } });
    expect(await post(POST, [SQUADI])).toEqual({ status: 400, body: { error: NOT_A_FEED_LINK } });
    expect(lookupSquadiLink).not.toHaveBeenCalled();
  });

  it("a body that is not JSON is a bad request", async () => {
    const POST = await loadRoute();
    const res = await POST(fakeRequest({})); // the stand-in request throws on json() when it has no body, as a real one does on bad JSON
    expect(res.status).toBe(400);
  });
});

// A Majestri link is read here, on the server: the competition's page is
// fetched (a stand-in serves a made-up one) and what it holds is said back.
describe("POST /api/feed-link — a Majestri link", () => {
  let realFetch;
  beforeEach(() => { realFetch = global.fetch; });
  afterEach(() => { global.fetch = realFetch; });

  it("reads the competition's page at its stored address and says back its names, teams and games", async () => {
    const asked = [];
    global.fetch = vi.fn(async (url) => { asked.push(String(url)); return { status: 200, ok: true, text: async () => MAJESTRI_PAGE }; });
    const POST = await loadRoute();
    const res = await post(POST, { link: `  ${MAJESTRI_TEAM_PAGE}  ` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true, provider: "majestri", link: MAJESTRI_TEAM_PAGE,
      majestri: { url: MAJESTRI_COMP, team: "Riverside Rockets", teamId: "7001" },
      found: { competition: "Winter Fives 2031", division: "Under 9 Mixed", season: "2031", teams: ["Riverside Rockets", "Hilltop Hawks", "Lakeside Lions & Co", "Valley Vipers", "Riverside Rovers"], games: 9, ours: "Riverside Rockets", ourGames: 5, ourResults: 1 }
    });
    expect(asked).toEqual([MAJESTRI_COMP]);
    expect(lookupSquadiLink).not.toHaveBeenCalled();
  });

  it("reads the page for the team the wizard already has, and says whether it is one of the page's teams", async () => {
    global.fetch = vi.fn(async () => ({ status: 200, ok: true, text: async () => MAJESTRI_PAGE }));
    const POST = await loadRoute();
    const vipers = await post(POST, { link: MAJESTRI_COMP, team: "  Valley Vipers " });
    expect([vipers.status, vipers.body.majestri, vipers.body.found.ours, vipers.body.found.ourGames]).toEqual([200, { url: MAJESTRI_COMP, team: "Valley Vipers", teamId: "7004" }, "Valley Vipers", 3]);
    const nobody = await post(POST, { link: MAJESTRI_COMP, team: "Mountain Goats" });
    expect([nobody.status, nobody.body.majestri, nobody.body.found.ours]).toEqual([200, { url: MAJESTRI_COMP }, ""]);
    // A team that is not text is no team.
    const odd = await post(POST, { link: MAJESTRI_COMP, team: ["Valley Vipers"] });
    expect([odd.status, odd.body.majestri]).toEqual([200, { url: MAJESTRI_COMP }]);
  });

  it("says what went wrong, as a sentence the wizard shows as it is", async () => {
    global.fetch = vi.fn(async () => ({ status: 404, ok: false, text: async () => "" }));
    const POST = await loadRoute();
    expect(await post(POST, { link: MAJESTRI_COMP })).toEqual({ status: 400, body: { error: "Majestri responded 404" } });
    expect(await post(POST, { link: "https://riversidefc.majestri.com.au/" })).toEqual({ status: 400, body: { error: "That Majestri link does not name a competition. Open the competition's page (its address has compID in it) and copy the address again." } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("is for the people who set teams up: nobody else can make the server ask Majestri anything", async () => {
    global.fetch = vi.fn();
    isAdminEmail.mockReturnValue(false);
    isClubAdminEmail.mockResolvedValue(false);
    const POST = await loadRoute();
    expect((await post(POST, { link: MAJESTRI_COMP })).status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
