import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/me tells the dashboard who the caller is and what they may do, so the
// UI can show the right controls (the server still enforces every write).
const { auth, teamFromCookieHeader, membershipsForEmail, isAdminEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), teamFromCookieHeader: vi.fn(), membershipsForEmail: vi.fn(), isAdminEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isAdminEmail, viewingAs }));

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
  return import("@/app/api/me/route");
}

describe("legacy team-code mode", () => {
  it("returns mode 'code' with the cookie's team", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A" });
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=code" } }));
    expect(await res.json()).toEqual({ mode: "code", teamSlug: "a", teamName: "Team A" });
  });

  it("401s without a valid cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { GET } = await loadRoute({ authOn: false });
    expect((await GET(fakeRequest())).status).toBe(401);
  });
});

describe("account mode", () => {
  it("returns the role for the team selected by the validated cookie", async () => {
    auth.mockResolvedValue({ user: { email: "mum@x.com" } });
    isAdminEmail.mockReturnValue(false);
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" }
    ] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    const body = await res.json();
    expect(body).toMatchObject({ mode: "account", email: "mum@x.com", admin: false, teamSlug: "b", role: "parent" });
    expect(body.memberships).toHaveLength(2);
  });

  it("falls back to the first membership when the cookie doesn't match", async () => {
    auth.mockResolvedValue({ user: { email: "td@club.com" } });
    isAdminEmail.mockReturnValue(false);
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "viewer" }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest({ cookies: { team_slug: "forged" } }))).json();
    expect(body).toMatchObject({ teamSlug: "a", role: "viewer" });
  });

  it("401s an unauthenticated or membership-less caller", async () => {
    const { GET } = await loadRoute({ authOn: true });
    auth.mockResolvedValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await GET(fakeRequest())).status).toBe(401);
  });
});

describe("account mode — view as (super admin impersonation)", () => {
  it("resolves everything as the impersonated user and flags it", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@x.com");
    isAdminEmail.mockReturnValue(true);
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest())).json();
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@x.com");
    expect(body).toMatchObject({ email: "mum@x.com", role: "parent", viewingAs: "mum@x.com", realAdmin: true, admin: false });
  });

  it("explains instead of 401ing when the impersonated user has no teams", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("ghost@x.com");
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ viewingAs: "ghost@x.com", realAdmin: true, memberships: [] });
  });
});
