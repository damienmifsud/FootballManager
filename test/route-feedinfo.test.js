import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/feedinfo returns the team's calendar subscribe URL. Legacy mode
// resolves the team from the site_auth cookie; account mode from the
// session's memberships via the real lib/viewer (any hat — viewers can
// subscribe too). AUTH_ON is module-load state, so each block re-imports
// the route.
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
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/feedinfo/route");
}

describe("legacy team-code mode", () => {
  it("401s when the cookie resolves to no team", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { GET } = await loadRoute({ authOn: false });
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("500s when the team has no calendar key configured", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "" });
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/no calendar key/);
  });

  it("builds the feed URL from the forwarded host and proto", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { "x-forwarded-host": "team.example.com", "x-forwarded-proto": "https" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).feedUrl).toBe("https://team.example.com/api/calendar?key=key-a");
  });

  it("falls back to the host header and https when forwarded headers are absent", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { host: "localhost:3000" } }));
    expect((await res.json()).feedUrl).toBe("https://localhost:3000/api/calendar?key=key-a");
  });
});

describe("account mode", () => {
  it("resolves the team from the session's memberships (any role)", async () => {
    auth.mockResolvedValue({ user: { email: "td@club.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "viewer" }] });
    teamBySlug.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ headers: { host: "x.test" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).feedUrl).toBe("https://x.test/api/calendar?key=key-a");
    expect(teamFromCookieHeader).not.toHaveBeenCalled();
  });

  it("401s when not signed in or without memberships", async () => {
    const { GET } = await loadRoute({ authOn: true });
    auth.mockResolvedValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("honours the team_slug cookie for a member of several teams", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p2", playerName: "Leo" }
    ] });
    teamBySlug.mockImplementation((slug) => ({ slug, calendarKey: "key-" + slug }));
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ headers: { host: "x.test" }, cookies: { team_slug: "b" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).feedUrl).toBe("https://x.test/api/calendar?key=key-b");
  });

  it("409s (pick a team) for a member of several teams with no team chosen", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p2", playerName: "Leo" }
    ] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ headers: { host: "x.test" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pick a team/i);
  });

  it("resolves the team as the impersonated user while viewing as (a read)", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }] });
    teamBySlug.mockReturnValue({ slug: "a", calendarKey: "key-a" });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ headers: { host: "x.test" } }));
    expect(res.status).toBe(200);
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
  });
});
