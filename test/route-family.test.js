import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { isoLocal, addDays } from "@/lib/dashboardData";

// GET /api/family: the next fortnight across every team where the signed-in
// person holds the family hat, with that family's own replies and nothing
// else. The builder (lib/familyWeek.js) and the date helper are real; the
// session, the directory and the store are mocked. Everyone is made up.
const { auth, getData, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  viewingAs.mockReturnValue(null);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  const [{ GET }, { brisbaneTodayISO }] = await Promise.all([import("@/app/api/family/route"), import("@/lib/visibility")]);
  return { GET, today: brisbaneTodayISO() };
}
const day = (today, n) => isoLocal(addDays(today, n));

const U9 = { teamSlug: "u9", teamName: "U9 Reds" };
const U11 = { teamSlug: "u11", teamName: "U11 Blues" };
const MEMBERSHIPS = [
  { ...U9, role: "coach", staffRole: "Assistant coach" },
  { ...U9, role: "parent", playerId: "p1", playerName: "Leo K." },
  { ...U11, role: "parent", playerId: "p3", playerName: "Mia K." },
  { teamSlug: "u13", teamName: "U13 Golds", role: "coach" } // coaches it, no child in it
];
const docs = (today) => ({
  u9: {
    team: { name: "U9 Reds", rules: [{ id: "r1" }], coachPin: "9999" },
    players: [{ id: "p1", name: "Leo K.", coach: { note: "Left foot only" } }, { id: "p8", name: "Team mate", parentEmails: ["other@example.com"] }],
    sessions: [],
    fixtures: [{ id: "f1", round: 7, status: "upcoming", dateISO: day(today, 3), time: "09:00", opponent: "Wests", venue: "Perry Park",
      availability: { p1: { status: "in", by: "Leo K." }, p8: { status: "out", reason: "Away" } }, plan: { assignments: [{ GK: "p8" }] } }]
  },
  u11: {
    team: { name: "U11 Blues" },
    players: [{ id: "p3", name: "Mia K." }],
    sessions: [],
    fixtures: [{ id: "g1", round: 2, status: "upcoming", dateISO: day(today, 1), time: "10:30", opponent: "Lions", venue: "Lion Park", availability: {} }]
  },
  u13: { team: { name: "U13 Golds" }, players: [{ id: "x", name: "Not theirs" }], sessions: [], fixtures: [{ id: "h1", status: "upcoming", dateISO: day(today, 2), time: "11:00", opponent: "Secret" }] }
});
const signIn = (today, memberships = MEMBERSHIPS) => {
  auth.mockResolvedValue({ user: { email: "sam@example.com" } });
  membershipsForEmail.mockResolvedValue({ memberships });
  const stored = docs(today);
  getData.mockImplementation(async (slug) => stored[slug] ?? null);
};

describe("GET /api/family", () => {
  it("needs account login, and a signed-in person", async () => {
    const off = await loadRoute({ authOn: false });
    const res = await off.GET(fakeRequest());
    expect(res.status).toBe(400);
    expect(auth).not.toHaveBeenCalled();
    const on = await loadRoute();
    auth.mockResolvedValue(null);
    expect((await on.GET(fakeRequest())).status).toBe(401);
    expect(membershipsForEmail).not.toHaveBeenCalled();
  });

  it("returns both children's teams in the order things happen, with only the family's own replies", async () => {
    const { GET, today } = await loadRoute();
    signIn(today);
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ todayISO: today, days: 14 });
    expect("readOnly" in body).toBe(false);
    expect(body.teams).toEqual([
      { teamSlug: "u9", teamName: "U9 Reds", players: [{ id: "p1", name: "Leo K." }] },
      { teamSlug: "u11", teamName: "U11 Blues", players: [{ id: "p3", name: "Mia K." }] }
    ]);
    expect(body.items).toEqual([
      { teamSlug: "u11", teamName: "U11 Blues", kind: "game", what: "game", id: "g1", dateISO: day(today, 1), time: "10:30", title: "vs Lions", place: "Lion Park", label: "Round 2",
        replies: [{ playerId: "p3", name: "Mia K.", status: null }] },
      { teamSlug: "u9", teamName: "U9 Reds", kind: "game", what: "game", id: "f1", dateISO: day(today, 3), time: "09:00", title: "vs Wests", place: "Perry Park", label: "Round 7",
        replies: [{ playerId: "p1", name: "Leo K.", status: "in" }] }
    ]);
  });

  it("never reads a team the family is not on, and passes on nothing else from the ones it is", async () => {
    const { GET, today } = await loadRoute();
    signIn(today);
    const raw = JSON.stringify(await (await GET(fakeRequest())).json());
    expect(getData.mock.calls.map((c) => c[0]).sort()).toEqual(["u11", "u9"]); // the team they only coach is not opened
    expect(raw).not.toMatch(/u13|Golds|Secret|Not theirs/);
    expect(raw).not.toMatch(/p8|Team mate|other@example|Left foot|9999|assignments|rules/);
  });

  it("is the family's view whatever the session is acting as, and whichever team it has open", async () => {
    const { GET, today } = await loadRoute();
    signIn(today);
    const body = await (await GET(fakeRequest({ cookies: { team_slug: "u13", act_as: "coach" } }))).json();
    expect(body.items.map((i) => i.teamSlug)).toEqual(["u11", "u9"]);
    expect(body.items.flatMap((i) => i.replies.map((r) => r.playerId))).toEqual(["p3", "p1"]);
  });

  it("someone with no family on any team gets an empty week, not an error", async () => {
    const { GET, today } = await loadRoute();
    signIn(today, [{ teamSlug: "u13", teamName: "U13 Golds", role: "coach" }, { ...U9, role: "viewer", clubAdmin: true, club: true }]);
    const body = await (await GET(fakeRequest())).json();
    expect(body).toMatchObject({ teams: [], items: [] });
    expect(getData).not.toHaveBeenCalled();
    signIn(today, []);
    expect(await (await GET(fakeRequest())).json()).toMatchObject({ teams: [], items: [] });
  });

  it("a team whose document cannot be read is left out rather than failing the page", async () => {
    const { GET, today } = await loadRoute();
    signIn(today);
    const stored = docs(today);
    getData.mockImplementation(async (slug) => { if (slug === "u9") throw new Error("store down"); return stored[slug]; });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teams.map((t) => t.teamSlug)).toEqual(["u9", "u11"]);
    expect(body.items.map((i) => i.teamSlug)).toEqual(["u11"]);
  });

  it("a super admin viewing as a family sees that family's week, marked read only", async () => {
    const { GET, today } = await loadRoute();
    signIn(today);
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    viewingAs.mockReturnValue("sam@example.com");
    const body = await (await GET(fakeRequest({ cookies: { view_as: "sam@example.com" } }))).json();
    expect(membershipsForEmail).toHaveBeenCalledWith("sam@example.com");
    expect(viewingAs.mock.calls[0][1]).toBe("owner@example.com"); // judged on the real session
    expect(body.readOnly).toBe(true);
    expect(body.items).toHaveLength(2);
  });
});
