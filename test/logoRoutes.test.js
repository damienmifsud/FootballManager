import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// The found logos on their way to a browser: /api/data puts the club logo
// library's choice on each game it sends and takes it off again before a
// save; the family view carries it; the browser's Dribl sync posts Dribl's
// club list with the draws. Every name, number and address here is made up.
const { auth, getData, setData, getClubLogos, setClubLogos, takeLock, dropLock, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(), getClubLogos: vi.fn(), setClubLogos: vi.fn(), takeLock: vi.fn(), dropLock: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData, getClubLogos, setClubLogos, takeLock, dropLock }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));
import { familyItems } from "@/lib/familyWeek";
import { syncDribl } from "@/lib/driblSync";

const FOUND = "https://cdn.dribl.com/clubs/zebras.png";
const LIB = { clubs: { "dribl:club:C1": { names: ["Zebras FC"], logo: FOUND } }, teams: { "dribl:team:T1": { name: "Zebras FC", club: "dribl:club:C1" } } };
const DOC = {
  team: { name: "Test FC", season: { startISO: "2026-01-01", endISO: "2026-12-31" } },
  players: [{ id: "p1", name: "Sam" }],
  fixtures: [
    { id: "f1", squadiId: "dribl:g1", opponent: "Zebras FC", opponentRef: "dribl:team:T1", opponentLogo: "", dateISO: "2026-06-13", time: "09:00", homeAway: "H", venue: "Park", status: "upcoming", availability: {} },
    { id: "f2", squadiId: 900002, opponent: "Lions FC U10 Blue", opponentLogo: "", dateISO: "2026-06-20", time: "09:00", homeAway: "A", venue: "Lion Park", status: "upcoming", availability: {} }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
  auth.mockResolvedValue({ user: { email: "coach@example.com" } });
  viewingAs.mockReturnValue(null);
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Test FC", role: "coach" }] });
  teamBySlug.mockResolvedValue({ slug: "a", name: "Test FC" });
  getData.mockResolvedValue(JSON.parse(JSON.stringify(DOC)));
  getClubLogos.mockResolvedValue(LIB);
  setData.mockResolvedValue(undefined);
});

async function dataRoute() {
  vi.resetModules();
  return import("@/app/api/data/route");
}
const req = (body) => fakeRequest({ url: "http://localhost/api/data", cookies: { team_slug: "a" }, ...(body ? { body } : {}) });

describe("/api/data and the club logo library", () => {
  it("sends each game with the library's crest, and none on a game the built-in crests cover", async () => {
    const { GET } = await dataRoute();
    const j = await (await GET(req())).json();
    expect(j.fixtures[0].opponentCrest).toBe(FOUND);
    expect("opponentCrest" in j.fixtures[1]).toBe(false);
  });
  it("sends the document as stored when the library cannot be read", async () => {
    getClubLogos.mockRejectedValue(new Error("store down"));
    const { GET } = await dataRoute();
    const j = await (await GET(req())).json();
    expect(j.fixtures.some((f) => "opponentCrest" in f)).toBe(false);
  });
  it("never saves the crests a read added", async () => {
    const { GET, POST } = await dataRoute();
    const got = await (await GET(req())).json();
    got.fixtures[0].notes = "Bring water";
    expect((await POST(req(got))).status).toBe(200);
    const saved = setData.mock.calls[0][1];
    expect(saved.fixtures.some((f) => "opponentCrest" in f)).toBe(false);
    expect(saved.fixtures[0].notes).toBe("Bring water");
  });
});

describe("the family view carries the crest a read added", () => {
  it("puts it on each game, and on no session", () => {
    const team = { teamSlug: "a", teamName: "Test FC", players: [{ id: "p1", name: "Sam" }] };
    const doc = { ...DOC, fixtures: [{ ...DOC.fixtures[0], opponentCrest: FOUND }, { ...DOC.fixtures[1] }] };
    const items = familyItems(team, doc, "2026-06-12");
    expect(items.map((i) => [i.opponent, i.opponentCrest])).toEqual([["Zebras FC", FOUND], ["Lions FC U10 Blue", undefined]]);
    expect("opponentCrest" in items[1]).toBe(false);
  });
});

describe("the browser's Dribl sync posts Dribl's club list with the draws", () => {
  const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&league=L1&tenant=T1&timezone=Australia%2FBrisbane";
  const answer = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
  const game = { hash_id: "g1", attributes: { date: "2026-06-13T23:00:00.000000Z", round: "R1", home_team_name: "Us FC", away_team_name: "Zebras FC", away_logo: FOUND, away_team_hash_id: "T1", bye_flag: false } };
  const sources = [{ comp: "c1", name: "Invitational", url: REQUEST, team: "Us FC" }, { comp: "c2", name: "Cup", url: REQUEST.replace("L1", "L2"), team: "Us FC" }];
  const make = (clubsAnswer) => {
    const posted = [], asked = [];
    const fetchImpl = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      asked.push(u);
      if (u === "/api/dribl" && opts.method === "POST") { posted.push(JSON.parse(opts.body)); return answer({ ok: true, changes: [], created: 1 }); }
      if (u === "/api/dribl") return answer({ sources, due: true });
      if (u.startsWith("https://mc-api.dribl.com/api/list/clubs")) return clubsAnswer();
      if (u.startsWith("https://mc-api.dribl.com/api/fixtures")) return answer({ data: [game] });
      throw new Error("unexpected " + u);
    });
    return { fetchImpl, posted, asked };
  };
  it("reads the club list once for the match centre the draws share, and posts it beside them", async () => {
    const d = make(() => answer({ data: [{ id: "C1", attributes: { name: "Zebras FC", logo: FOUND } }] }));
    expect(await syncDribl({ fetchImpl: d.fetchImpl })).toMatchObject({ synced: 2, failed: [] });
    expect(d.asked.filter((u) => u.includes("/api/list/clubs"))).toEqual(["https://mc-api.dribl.com/api/list/clubs?tenant=T1"]);
    expect(d.posted).toHaveLength(1);
    expect(d.posted[0].clubs).toEqual([{ id: "C1", name: "Zebras FC", logo: FOUND }]);
    expect(d.posted[0].draws[0].records[0]).toMatchObject({ opponent: "Zebras FC", opponentLogo: FOUND, opponentRef: "dribl:team:T1" });
  });
  it("posts the draws just the same when the club list cannot be read", async () => {
    const d = make(() => answer({}, 404));
    expect(await syncDribl({ fetchImpl: d.fetchImpl })).toMatchObject({ synced: 2 });
    expect(d.posted).toHaveLength(1);
    expect(d.posted[0]).not.toHaveProperty("clubs");
  });
});

describe("/api/family puts the library's crest on each game too", () => {
  it("as the team page has it", async () => {
    const { brisbaneTodayISO } = await import("@/lib/visibility");
    const today = brisbaneTodayISO();
    const inDays = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Test FC", role: "parent", playerId: "p1", playerName: "Sam" }] });
    getData.mockResolvedValue({ ...JSON.parse(JSON.stringify(DOC)), fixtures: DOC.fixtures.map((f, i) => ({ ...f, dateISO: inDays(i + 1) })) });
    vi.resetModules();
    const { GET } = await import("@/app/api/family/route");
    const j = await (await GET(fakeRequest({ url: "http://localhost/api/family" }))).json();
    const games = j.items.filter((i) => i.kind === "game");
    expect(games.map((g) => [g.opponent, g.opponentCrest])).toEqual([["Zebras FC", FOUND], ["Lions FC U10 Blue", undefined]]);
  });
});
