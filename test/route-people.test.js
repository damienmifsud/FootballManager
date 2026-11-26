import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// GET /api/people: the people page's data. Super admin only, by the REAL
// session; account mode only. The directory itself is tested with
// lib/directory.js: here it is the gate and the shape that matter.
const { auth, isAdminEmail, clubPeople } = vi.hoisted(() => ({ auth: vi.fn(), isAdminEmail: vi.fn(), clubPeople: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, clubPeople }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  isAdminEmail.mockImplementation((e) => e === "owner@example.com");
  clubPeople.mockResolvedValue({ teams: [], people: [] });
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

// AUTH_ON is module-load state, so set the env and reload the route.
async function loadRoute({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/people/route");
}

describe("GET /api/people — who may ask", () => {
  it("is refused in team-code mode, where there are no logins to list", async () => {
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/account login/);
    expect(auth).not.toHaveBeenCalled();
    expect(clubPeople).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    auth.mockResolvedValue(null);
    const { GET } = await loadRoute();
    expect((await GET()).status).toBe(401);
    expect(clubPeople).not.toHaveBeenCalled();
  });

  it("403s anyone who is not a super admin, a club admin and a coach included, before reading anything", async () => {
    const { GET } = await loadRoute();
    for (const email of ["td@example.com", "coach@example.com", "mum@example.com"]) {
      auth.mockResolvedValue({ user: { email } });
      const res = await GET();
      expect(res.status, email).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(clubPeople).not.toHaveBeenCalled();
  });
});

describe("GET /api/people — what it returns", () => {
  it("gives each person their teams in the same shape the rest of the app uses, and nothing it was not asked for", async () => {
    clubPeople.mockResolvedValue({
      teams: [{ slug: "a", name: "Team A" }, { slug: "b", name: "Team B" }],
      people: [
        { email: "sam@example.com", name: "Sam Kelly", superAdmin: false, clubAdmin: "stored", overrides: { b: "blocked" }, memberships: [
          { teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Assistant coach", clubAdmin: true },
          { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Leo K.", clubAdmin: true }
        ] },
        { email: "owner@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {}, memberships: [
          { teamSlug: "a", teamName: "Team A", role: "coach", admin: true, club: true },
          { teamSlug: "b", teamName: "Team B", role: "coach", admin: true, club: true }
        ] }
      ]
    });
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      teams: [{ slug: "a", name: "Team A" }, { slug: "b", name: "Team B" }],
      people: [
        { email: "sam@example.com", name: "Sam Kelly", superAdmin: false, clubAdmin: "stored", overrides: { b: "blocked" }, teams: [
          { teamSlug: "a", teamName: "Team A", mine: true, hats: [
            { role: "coach", playerIds: [], playerNames: [], staffRole: "Assistant coach" },
            { role: "parent", playerIds: ["p1"], playerNames: ["Leo K."] }
          ] }
        ] },
        { email: "owner@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {}, teams: [
          { teamSlug: "a", teamName: "Team A", mine: false, hats: [{ role: "coach", playerIds: [], playerNames: [], admin: true, club: true }] },
          { teamSlug: "b", teamName: "Team B", mine: false, hats: [{ role: "coach", playerIds: [], playerNames: [], admin: true, club: true }] }
        ] }
      ]
    });
  });

  it("the gate uses the real session, so viewing as someone changes nothing here", async () => {
    // No cookie is read at all: the route takes no request.
    const { GET } = await loadRoute();
    expect(GET.length).toBe(0);
    expect((await GET()).status).toBe(200);
    expect(isAdminEmail).toHaveBeenCalledWith("owner@example.com");
  });
});
