import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// lib/viewer.js is the one resolver every API route uses: session -> hats ->
// team -> chosen hat. AUTH_ON is module-load state, so each block re-imports.
const { auth, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  viewingAs.mockReturnValue(null);
  teamBySlug.mockImplementation((slug) => ({ slug, name: "Team " + slug.toUpperCase() }));
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function load({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/lib/viewer");
}

const COACH_PARENT = [
  { teamSlug: "a", teamName: "Team A", role: "coach" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Alex" }
];
const TWO_TEAMS = [
  { teamSlug: "a", teamName: "Team A", role: "coach" },
  { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p9", playerName: "Leo" }
];

describe("legacy team-code mode", () => {
  it("resolves the team from the code cookie as an unconditional coach hat", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A" });
    const { resolveViewer } = await load({ authOn: false });
    const v = await resolveViewer(fakeRequest({ headers: { cookie: "site_auth=code" } }));
    expect(v).toMatchObject({ mode: "code", team: { slug: "a" }, hat: { role: "coach", playerIds: [] } });
    expect(auth).not.toHaveBeenCalled();
  });

  it("401s without a valid code", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { resolveViewer } = await load({ authOn: false });
    expect(await resolveViewer(fakeRequest())).toEqual({ error: 401, message: "unauthorized" });
  });
});

describe("account mode — team selection", () => {
  it("401s when signed out or without memberships", async () => {
    const { resolveViewer } = await load({ authOn: true });
    auth.mockResolvedValue(null);
    expect((await resolveViewer(fakeRequest())).error).toBe(401);
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await resolveViewer(fakeRequest())).error).toBe(401);
  });

  it("auto-selects the only team when the cookie is missing or forged", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [COACH_PARENT[1]] });
    const { resolveViewer } = await load({ authOn: true });
    expect((await resolveViewer(fakeRequest())).team.slug).toBe("a");
    expect((await resolveViewer(fakeRequest({ cookies: { team_slug: "forged" } }))).team.slug).toBe("a");
  });

  it("uses a valid team_slug cookie across several teams", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: TWO_TEAMS });
    const { resolveViewer } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(v.team.slug).toBe("b");
    expect(v.hat).toMatchObject({ role: "parent", playerIds: ["p9"] });
  });

  it("409s (pick a team) with several teams and no usable cookie, instead of guessing the first", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: TWO_TEAMS });
    const { resolveViewer, viewerError } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest({ cookies: { team_slug: "gone" } }));
    expect(v).toMatchObject({ error: 409 });
    const res = viewerError(v);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pick a team/i);
    expect(teamBySlug).not.toHaveBeenCalled();
  });

  it("a super admin with one team of their own among many they can only open: theirs without a cookie, any of them with one", async () => {
    const OWNER = [
      { teamSlug: "a", teamName: "Team A", role: "coach", admin: true, club: true },
      { teamSlug: "b", teamName: "Team B", role: "coach", admin: true, club: true },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" },
      { teamSlug: "c", teamName: "Team C", role: "coach", admin: true, club: true }
    ];
    const { resolveViewer } = await load({ authOn: true });
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: OWNER });
    const own = await resolveViewer(fakeRequest());
    expect(own).toMatchObject({ mode: "account", team: { slug: "b" }, hat: { role: "coach", admin: true, club: true } });
    // Opened from club admin: the cookie names a team they hold no role on.
    const opened = await resolveViewer(fakeRequest({ cookies: { team_slug: "c" } }));
    expect(opened).toMatchObject({ team: { slug: "c" }, hat: { role: "coach", admin: true, club: true } });
  });

  it("a club admin on no team themselves is asked to pick, and reads a team they open as view only", async () => {
    const CLUB = [
      { teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true, club: true },
      { teamSlug: "b", teamName: "Team B", role: "viewer", clubAdmin: true, club: true }
    ];
    const { resolveViewer, PICK_TEAM_MESSAGE } = await load({ authOn: true });
    auth.mockResolvedValue({ user: { email: "td@example.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: CLUB });
    expect(await resolveViewer(fakeRequest())).toEqual({ error: 409, message: PICK_TEAM_MESSAGE });
    const opened = await resolveViewer(fakeRequest({ cookies: { team_slug: "b", act_as: "coach" } }));
    expect(opened).toMatchObject({ team: { slug: "b" }, hat: { role: "viewer", clubAdmin: true } });
  });

  it("401s when the memberships give no recognised hat on the chosen team", async () => {
    auth.mockResolvedValue({ user: { email: "odd@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "mystery" }] });
    const { resolveViewer } = await load({ authOn: true });
    expect((await resolveViewer(fakeRequest())).error).toBe(401);
  });

  it("401s when the registry no longer has the team", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [COACH_PARENT[1]] });
    teamBySlug.mockReturnValue(null);
    const { resolveViewer } = await load({ authOn: true });
    expect((await resolveViewer(fakeRequest())).error).toBe(401);
  });
});

describe("account mode — hats", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: COACH_PARENT });
  });

  it("wears the strongest hat when act_as is missing", async () => {
    const { resolveViewer, isCoachHat } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest());
    expect(v.hat.role).toBe("coach");
    expect(isCoachHat(v)).toBe(true);
    expect(v.memberships).toBe(COACH_PARENT);
  });

  it("act_as=parent lets a coach-parent act as the parent of their own kids", async () => {
    const { resolveViewer, isCoachHat } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest({ cookies: { act_as: "parent" } }));
    expect(v.hat).toEqual({ role: "parent", playerIds: ["p1", "p2"], playerNames: ["Sam", "Alex"] });
    expect(isCoachHat(v)).toBe(false);
  });

  it("act_as can only narrow: a plain parent asking for coach stays a parent", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [COACH_PARENT[1]] });
    const { resolveViewer } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest({ cookies: { act_as: "coach" } }));
    expect(v.hat.role).toBe("parent");
  });

  it("ignores junk act_as values", async () => {
    const { resolveViewer } = await load({ authOn: true });
    expect((await resolveViewer(fakeRequest({ cookies: { act_as: "admin" } }))).hat.role).toBe("coach");
    expect((await resolveViewer(fakeRequest({ cookies: { act_as: "" } }))).hat.role).toBe("coach");
  });
});

describe("account mode — view as (impersonation)", () => {
  it("resolves as the impersonated user and their hats", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [COACH_PARENT[1]] });
    const { resolveViewer } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest());
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
    expect(v).toMatchObject({ email: "mum@a.com", realEmail: "boss@dam.fund", impersonating: "mum@a.com", hat: { role: "parent" } });
  });

  it("refuses writes while impersonating, before touching the store", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    const { resolveViewer, viewerError, READ_ONLY_MESSAGE } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest(), { write: true });
    expect(v).toEqual({ error: 403, message: READ_ONLY_MESSAGE });
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(viewerError(v).status).toBe(403);
  });

  it("reads are fine while impersonating", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("coach@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [COACH_PARENT[0]] });
    const { resolveViewer } = await load({ authOn: true });
    expect((await resolveViewer(fakeRequest())).hat.role).toBe("coach");
  });
});

// The combined family view names the team each reply is for, and always acts
// as the family there. Neither option may reach past what the login holds.
describe("a request that names its team and its role", () => {
  const FAMILY = [
    { teamSlug: "a", teamName: "Team A", role: "coach" },
    { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
    { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p9", playerName: "Leo" },
    { teamSlug: "c", teamName: "Team C", role: "coach" },
    { teamSlug: "d", teamName: "Team D", role: "viewer", clubAdmin: true, club: true }
  ];
  const signIn = (memberships = FAMILY) => {
    auth.mockResolvedValue({ user: { email: "sam@example.com" } });
    membershipsForEmail.mockResolvedValue({ memberships });
  };

  it("a named team wins over the cookie, and there is no asking to pick one", async () => {
    signIn();
    const { resolveViewer } = await load({ authOn: true });
    const v = await resolveViewer(fakeRequest({ cookies: { team_slug: "a" } }), { team: "b" });
    expect(v).toMatchObject({ mode: "account", team: { slug: "b" }, hat: { role: "parent", playerIds: ["p9"] } });
    // With no cookie at all a login on several teams is normally told to pick (409).
    expect((await resolveViewer(fakeRequest())).error).toBe(409);
    expect((await resolveViewer(fakeRequest(), { team: "a" })).team.slug).toBe("a");
  });

  it("a team the login is not on is refused, never swapped for one it is on", async () => {
    signIn();
    const { resolveViewer } = await load({ authOn: true });
    for (const team of ["zzz", "", "A", null]) {
      expect(await resolveViewer(fakeRequest({ cookies: { team_slug: "a" } }), { team }), String(team)).toEqual({ error: 403, message: "forbidden" });
    }
    // Even someone on exactly one team: a wrong name is not corrected to it.
    signIn([{ teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p9", playerName: "Leo" }]);
    expect(await resolveViewer(fakeRequest(), { team: "a" })).toEqual({ error: 403, message: "forbidden" });
    expect(teamBySlug).not.toHaveBeenCalled(); // refused before the team is even looked up
  });

  it("a pinned role is worn whatever the act_as cookie says", async () => {
    signIn();
    const { resolveViewer } = await load({ authOn: true });
    // On Team A this login is coach and parent: the cookie says coach, the request says family.
    const v = await resolveViewer(fakeRequest({ cookies: { act_as: "coach" } }), { team: "a", as: "parent" });
    expect(v.hat).toEqual({ role: "parent", playerIds: ["p1"], playerNames: ["Sam"] });
    // Without a named team the cookie's team is used, and the pin still holds.
    const w = await resolveViewer(fakeRequest({ cookies: { team_slug: "a" } }), { as: "parent" });
    expect(w).toMatchObject({ team: { slug: "a" }, hat: { role: "parent" } });
  });

  it("a pinned role the login does not hold on that team is refused: no falling back to a stronger one", async () => {
    signIn();
    const { resolveViewer } = await load({ authOn: true });
    expect(await resolveViewer(fakeRequest(), { team: "c", as: "parent" })).toEqual({ error: 403, message: "forbidden" }); // coach only
    expect(await resolveViewer(fakeRequest(), { team: "d", as: "parent" })).toEqual({ error: 403, message: "forbidden" }); // view only
    expect(await resolveViewer(fakeRequest(), { team: "b", as: "coach" })).toEqual({ error: 403, message: "forbidden" });  // cannot pin up
    expect(await resolveViewer(fakeRequest(), { team: "a", as: "admin" })).toEqual({ error: 403, message: "forbidden" });  // not a hat
  });

  it("impersonation stays read only, and reads as the person viewed", async () => {
    signIn();
    viewingAs.mockReturnValue("leo.parent@example.com");
    const { resolveViewer, READ_ONLY_MESSAGE } = await load({ authOn: true });
    expect(await resolveViewer(fakeRequest(), { write: true, team: "b", as: "parent" })).toEqual({ error: 403, message: READ_ONLY_MESSAGE });
    expect(membershipsForEmail).not.toHaveBeenCalled();
    const v = await resolveViewer(fakeRequest(), { team: "b", as: "parent" });
    expect(membershipsForEmail).toHaveBeenCalledWith("leo.parent@example.com");
    expect(v).toMatchObject({ impersonating: "leo.parent@example.com", team: { slug: "b" } });
  });

  it("team-code mode has one team per code: naming it is fine, naming another is refused", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A" });
    const { resolveViewer } = await load({ authOn: false });
    expect((await resolveViewer(fakeRequest({ headers: { cookie: "site_auth=code" } }), { team: "a", as: "parent" })).team.slug).toBe("a");
    expect(await resolveViewer(fakeRequest({ headers: { cookie: "site_auth=code" } }), { team: "b" })).toEqual({ error: 403, message: "forbidden" });
  });
});
