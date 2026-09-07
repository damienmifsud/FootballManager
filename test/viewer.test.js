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
