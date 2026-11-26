import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM, DRIBL_NOT_SYNCED } from "@/lib/feedLinks";

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

  it("a Dribl link is read without asking Dribl anything, and says plainly that it is not synced", async () => {
    const POST = await loadRoute();
    const res = await post(POST, { link: DRIBL });
    expect(res).toEqual({ status: 200, body: {
      ok: true, provider: "dribl", link: DRIBL, synced: false, note: DRIBL_NOT_SYNCED,
      dribl: { link: DRIBL, site: "winterleague", season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468" }
    } });
    expect(lookupSquadiLink).not.toHaveBeenCalled();
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
