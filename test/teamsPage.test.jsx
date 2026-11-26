import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// app/teams/page.jsx is an async server component: call the default export
// and inspect what it returns. It resolves the signed-in login (or the person
// a super admin is viewing as) to its teams and hands them to MyTeams.
const { auth, membershipsForEmail, isAdminEmail, isClubAdminEmail, redirect, cookieJar } = vi.hoisted(() => ({
  auth: vi.fn(), membershipsForEmail: vi.fn(), isAdminEmail: vi.fn(), isClubAdminEmail: vi.fn(), redirect: vi.fn(), cookieJar: { values: {} }
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isAdminEmail, isClubAdminEmail }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name) => (name in cookieJar.values ? { name, value: cookieJar.values[name] } : undefined) })
}));
function MyTeamsStub() { return null; }
vi.mock("@/components/MyTeams", () => ({ default: MyTeamsStub }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  cookieJar.values = {};
  auth.mockResolvedValue({ user: { email: "sam@example.com" } });
  isAdminEmail.mockReturnValue(false);
  isClubAdminEmail.mockResolvedValue(false);
  // next/navigation's redirect() throws to stop rendering; the page returns it, so a marker is enough here.
  redirect.mockImplementation((to) => ({ redirectedTo: to }));
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

// AUTH_ON is module-load state, so set the env and reload the page module.
async function loadPage({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return (await import("@/app/teams/page")).default;
}

const A_COACH = { teamSlug: "a", teamName: "Team A", role: "coach" };
const B_PARENT = { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Leo" };
const C_CLUB = { teamSlug: "c", teamName: "Team C", role: "coach", admin: true, club: true };

describe("app/teams/page", () => {
  it("hands the login's teams to My teams, each marked as their own or not", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, B_PARENT] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(MyTeamsStub);
    expect(el.props).toEqual({
      email: "sam@example.com", admin: null, viewingAs: false, family: false, // a child in one team: nothing to put together
      teams: [
        { teamSlug: "a", teamName: "Team A", mine: true, hats: [{ role: "coach", playerIds: [], playerNames: [] }] },
        { teamSlug: "b", teamName: "Team B", mine: true, hats: [{ role: "parent", playerIds: ["p1"], playerNames: ["Leo"] }] }
      ]
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("says when the login has a family on two or more teams, which is who the combined view is for", async () => {
    const A_PARENT = { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Mia" };
    const A_PLAYER = { teamSlug: "a", teamName: "Team A", role: "player", playerId: "p7", playerName: "Sam" };
    const family = async (memberships) => {
      membershipsForEmail.mockResolvedValue({ memberships });
      const Page = await loadPage();
      return (await Page()).props.family;
    };
    expect(await family([A_PARENT, B_PARENT])).toBe(true);            // a child in each of two teams
    expect(await family([A_PLAYER, B_PARENT])).toBe(true);            // their own team and their child's
    expect(await family([A_COACH, A_PARENT, B_PARENT])).toBe(true);   // a coach is still a parent
    expect(await family([A_PARENT, { ...A_PARENT, playerId: "p3", playerName: "Ana" }])).toBe(false); // two children, one team
    expect(await family([A_COACH, B_PARENT, C_CLUB])).toBe(false);    // coaching or running a team is not family
  });

  it("the family being viewed as decides it, not the super admin viewing", async () => {
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    isAdminEmail.mockImplementation((e) => e === "owner@example.com");
    cookieJar.values = { view_as: encodeURIComponent("sam@example.com") };
    membershipsForEmail.mockImplementation(async (email) => ({
      memberships: email === "sam@example.com"
        ? [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Mia" }, B_PARENT]
        : [C_CLUB]
    }));
    const Page = await loadPage();
    const el = await Page();
    expect(el.props).toMatchObject({ family: true, viewingAs: true, admin: null });
  });

  it("a person with a single team can still open the page: it is where Switch team leads", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH] });
    const Page = await loadPage();
    expect((await Page()).type).toBe(MyTeamsStub);
  });

  it("a super admin gets the club section, and their club-level teams marked as not their own", async () => {
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    isAdminEmail.mockImplementation((e) => e === "owner@example.com");
    membershipsForEmail.mockResolvedValue({ memberships: [B_PARENT, C_CLUB] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.props.admin).toBe("super");
    expect(el.props.teams.map((t) => [t.teamSlug, t.mine])).toEqual([["b", true], ["c", false]]);
    expect(isClubAdminEmail).not.toHaveBeenCalled();
  });

  it("a club admin gets the club section too", async () => {
    isClubAdminEmail.mockResolvedValue(true);
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true, club: true }] });
    const Page = await loadPage();
    expect((await Page()).props.admin).toBe("club");
  });

  it("a super admin or club admin in an empty club still gets the page (it leads to club admin)", async () => {
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    isAdminEmail.mockImplementation((e) => e === "owner@example.com");
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(MyTeamsStub);
    expect(el.props).toMatchObject({ admin: "super", teams: [] });
  });

  it("someone with no team and nothing to run goes home, where the page says what to do", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const Page = await loadPage();
    expect(await Page()).toEqual({ redirectedTo: "/" });
  });

  it("viewing as someone: their teams, their email marked, and no club section", async () => {
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    isAdminEmail.mockImplementation((e) => e === "owner@example.com");
    cookieJar.values.view_as = encodeURIComponent("mum@example.com");
    membershipsForEmail.mockResolvedValue({ memberships: [B_PARENT] });
    const Page = await loadPage();
    const el = await Page();
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@example.com");
    expect(el.props).toMatchObject({ email: "mum@example.com (viewing as)", admin: null, viewingAs: true });
  });

  it("a view_as cookie means nothing unless the real session is the super admin's", async () => {
    cookieJar.values.view_as = "mum@example.com";
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH] });
    const Page = await loadPage();
    const el = await Page();
    expect(membershipsForEmail).toHaveBeenCalledWith("sam@example.com");
    expect(el.props).toMatchObject({ email: "sam@example.com", viewingAs: false });
  });

  it("no session -> /login", async () => {
    auth.mockResolvedValue(null);
    const Page = await loadPage();
    expect(await Page()).toEqual({ redirectedTo: "/login" });
    expect(membershipsForEmail).not.toHaveBeenCalled();
  });

  it("team-code mode has no accounts: straight back to the team hub", async () => {
    const Page = await loadPage({ authOn: false });
    expect(await Page()).toEqual({ redirectedTo: "/" });
    expect(auth).not.toHaveBeenCalled();
  });
});
