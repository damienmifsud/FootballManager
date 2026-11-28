import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/club-logos: the super admin's Logos section. The store, the team list,
// the session and Squadi are stand-ins; the library (lib/clubLogos,
// lib/clubLogoStore), the registry and Dribl's checks are real. Every name,
// number and address here is made up.
const { auth, isAdminEmail, viewingAs, getData, getClubLogos, setClubLogos, takeLock, dropLock, getTeams, fetchSquadi } = vi.hoisted(() => ({
  auth: vi.fn(), isAdminEmail: vi.fn(), viewingAs: vi.fn(), getData: vi.fn(), getClubLogos: vi.fn(), setClubLogos: vi.fn(),
  takeLock: vi.fn(), dropLock: vi.fn(), getTeams: vi.fn(), fetchSquadi: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, viewingAs }));
vi.mock("@/lib/store", () => ({ getData, getClubLogos, setClubLogos, takeLock, dropLock }));
vi.mock("@/lib/teams", () => ({ getTeams }));
vi.mock("@/lib/squadiSync", () => ({ fetchSquadi }));

const BUCKET = "https://storage.googleapis.com/download/storage/v1/b/squadi-prod.appspot.com/o/";
const orgLogo = (org) => `${BUCKET}organisation%2Flogo_org_${org}_1700000001.jpg?generation=1700000002&alt=media`;
const compLogo = `${BUCKET}competitions%2Flogo_comp_0a1b2c3d_1700000003.blob?generation=1&alt=media`;
const game = (n, opponent, id, logo) => ({ id: "f" + n, squadiId: 900000 + n, opponent, opponentRef: `squadi:team:${id}`, opponentLogo: logo, dateISO: "2026-05-02" });
const DRIBL_REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&league=L1&tenant=T1&timezone=Australia%2FBrisbane";
const TEAMS = [
  { slug: "u10", name: "Under 10s", squadi: { competitionId: "700", divisionId: "800", teamId: "900" },
    competitions: [{ id: "cwf", name: "Winter Cup", squadi: { competitionId: "701", divisionId: "All", teamId: "901" } }, { id: "cinv", name: "Invitational", dribl: { url: DRIBL_REQUEST, team: "Us FC" } }] },
  { slug: "u9", name: "Under 9s" }
];
const DOCS = {
  u10: { fixtures: [game(1, "Lions FC U10 Blue", 500005, orgLogo(57)), game(2, "Riverside FC U10 Blue", 500001, orgLogo(41)), game(3, "Seaside FC U10", 500009, compLogo)] },
  u9: { fixtures: [game(4, "Riverside FC U9", 500002, orgLogo(41))] }
};

let stored;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
  stored = {};
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  isAdminEmail.mockImplementation((e) => e === "owner@example.com");
  viewingAs.mockReturnValue(null);
  getData.mockImplementation(async (slug) => DOCS[slug] || null);
  getClubLogos.mockImplementation(async () => stored);
  setClubLogos.mockImplementation(async (v) => { stored = v; });
  takeLock.mockResolvedValue(true);
  dropLock.mockResolvedValue(undefined);
  getTeams.mockResolvedValue(TEAMS);
  fetchSquadi.mockImplementation(async (cfg) => (cfg.teamId === "900"
    ? [game(1, "Lions FC U10 Blue", 500005, orgLogo(57)), game(2, "Riverside FC U10 Blue", 500001, orgLogo(41))]
    : [game(3, "Seaside FC U10", 500009, compLogo)]));
});

async function route() {
  vi.resetModules();
  return import("@/app/api/club-logos/route");
}
const get = async (r) => r.GET(fakeRequest({ url: "http://localhost/api/club-logos" }));
const post = async (r, body) => r.POST(fakeRequest({ url: "http://localhost/api/club-logos", body }));

describe("GET /api/club-logos", () => {
  it("is for the super admin only", async () => {
    const r = await route();
    isAdminEmail.mockReturnValue(false);
    expect((await get(r)).status).toBe(403);
    auth.mockResolvedValue(null);
    expect((await get(r)).status).toBe(401);
  });
  it("says what is shown for every opposition team of every team, and lists the Dribl draws for this browser to read", async () => {
    const r = await route();
    const res = await get(r);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.counts).toEqual({ opponents: 4, builtIn: 1, found: 2, missing: 1, hidden: 0, newClubs: 1, newLogos: 1, duplicatesAvoided: 1 });
    expect(j.opponents.map((o) => [o.name, o.shown])).toEqual([["Lions FC U10 Blue", "built-in"], ["Riverside FC U10 Blue", "found"], ["Riverside FC U9", "found"], ["Seaside FC U10", "missing"]]);
    expect(j.dribl).toEqual([{ team: "u10", teamName: "Under 10s", comp: "cinv", name: "Invitational", url: DRIBL_REQUEST, ourTeam: "Us FC" }]);
  });
});

describe("POST /api/club-logos", () => {
  it("refresh reads every team's Squadi draws again for their logos, and changes no game", async () => {
    const r = await route();
    const res = await post(r, { action: "refresh" });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect([j.read, j.failed, j.saved]).toEqual([2, 0, true]);
    expect(fetchSquadi.mock.calls.map((c) => c[0].teamId)).toEqual(["900", "901"]);
    expect(stored.clubs["squadi:org:41"].logo).toBe(orgLogo(41));
    expect(getData).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
  it("counts a draw Squadi will not give and goes on with the rest", async () => {
    fetchSquadi.mockImplementationOnce(async () => { throw new Error("Squadi responded 500"); });
    const j = await (await post(await route(), { action: "refresh" })).json();
    expect([j.read, j.failed]).toEqual([1, 1]);
  });
  it("takes what the admin's browser read from Dribl, checked as a coach's post is", async () => {
    const r = await route();
    const res = await post(r, {
      action: "dribl",
      draws: [{ records: [{ squadiId: "dribl:g1", round: 1, dateISO: "2026-06-06", time: "09:00", opponent: "Hilltop SC U10", opponentRef: "dribl:team:T1", opponentLogo: "https://cdn.dribl.com/hilltop.png", homeAway: "H", venue: "" }, { squadiId: "nope" }] }],
      clubs: [{ id: "C1", name: "Hilltop SC", logo: "https://cdn.dribl.com/hilltop.png" }, { id: "bad id", name: "X" }]
    });
    const j = await res.json();
    expect([res.status, j.read, j.clubs]).toEqual([200, 1, 1]);
    expect(stored.teams["dribl:team:T1"]).toEqual(expect.objectContaining({ club: "dribl:club:C1" }));
  });
  it("hides a club's logo for all its teams, and shows it again", async () => {
    const r = await route();
    await post(r, { action: "refresh" });
    let j = await (await post(r, { action: "hide", ref: "squadi:team:500001", club: "squadi:org:41", kind: "club" })).json();
    expect(stored.manual).toEqual({ "squadi:org:41": { hidden: true } });
    expect(j.counts).toMatchObject({ found: 0, hidden: 2 });
    j = await (await post(r, { action: "show", ref: "squadi:team:500001", club: "squadi:org:41" })).json();
    expect(stored.manual).toEqual({});
    expect(j.counts).toMatchObject({ found: 2, hidden: 0 });
  });
  it("hides a team's own logo for that team only", async () => {
    const r = await route();
    await post(r, { action: "hide", ref: "squadi:team:500009", kind: "game" });
    expect(stored.manual).toEqual({ "squadi:team:500009": { hidden: true } });
  });
  it("refuses a bad reference, an unknown action, a view-as session and anyone but the super admin", async () => {
    const r = await route();
    expect((await post(r, { action: "hide", ref: "not a ref" })).status).toBe(400);
    expect((await post(r, { action: "hide", ref: "squadi:team:1", club: "nope" })).status).toBe(400);
    expect((await post(r, { action: "drop-everything" })).status).toBe(400);
    viewingAs.mockReturnValue("parent@example.com");
    expect((await post(r, { action: "refresh" })).status).toBe(403);
    viewingAs.mockReturnValue(null);
    isAdminEmail.mockReturnValue(false);
    expect((await post(r, { action: "refresh" })).status).toBe(403);
    expect(setClubLogos).not.toHaveBeenCalled();
  });
});
