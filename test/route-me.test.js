import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/me tells the dashboard who the caller is and what they may do, so the
// UI can show the right controls (the server still enforces every write).
// The route sits on the REAL lib/viewer and lib/hats; only the session, the
// team lookup and the directory are mocked.
const { auth, teamFromCookieHeader, teamBySlug, membershipsForEmail, isAdminEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), teamFromCookieHeader: vi.fn(), teamBySlug: vi.fn(), membershipsForEmail: vi.fn(), isAdminEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader, teamBySlug }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isAdminEmail, viewingAs }));

const NAMES = { a: "Team A", b: "Team B" };

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  // clearAllMocks keeps implementations, so reset the ones tests override.
  viewingAs.mockReturnValue(null);
  isAdminEmail.mockReturnValue(false);
  teamBySlug.mockImplementation(async (slug) => (slug in NAMES ? { slug, name: NAMES[slug] } : null));
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
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("account mode", () => {
  it("returns the hat for the team selected by the validated cookie", async () => {
    auth.mockResolvedValue({ user: { email: "mum@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" }
    ] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    const body = await res.json();
    expect(body).toMatchObject({
      mode: "account", email: "mum@x.com", admin: false,
      teamSlug: "b", teamName: "Team B", role: "parent", playerIds: ["p1"], playerNames: ["Sam"]
    });
    expect(body.hats).toEqual([{ role: "parent", playerIds: ["p1"], playerNames: ["Sam"] }]);
    expect(body.teams).toEqual([
      { teamSlug: "a", teamName: "Team A", hats: [{ role: "coach", playerIds: [], playerNames: [] }] },
      { teamSlug: "b", teamName: "Team B", hats: [{ role: "parent", playerIds: ["p1"], playerNames: ["Sam"] }] }
    ]);
    expect(body.canSwitch).toBe(true);
    expect(body.memberships).toEqual([
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" }
    ]);
    expect("viewingAs" in body).toBe(false);
  });

  it("ignores a forged team_slug cookie when there is only one team to be on", async () => {
    auth.mockResolvedValue({ user: { email: "td@club.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "viewer" }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest({ cookies: { team_slug: "forged" } }))).json();
    expect(body).toMatchObject({ teamSlug: "a", teamName: "Team A", role: "viewer", playerIds: [], canSwitch: false });
    expect(body.hats).toEqual([{ role: "viewer", playerIds: [], playerNames: [] }]);
  });

  it("409s (pick a team) when the caller has several teams and no usable team_slug cookie", async () => {
    auth.mockResolvedValue({ user: { email: "mum@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" }
    ] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pick a team/i);
    expect((await GET(fakeRequest({ cookies: { team_slug: "forged" } }))).status).toBe(409);
  });

  it("carries the coach's staffRole on the hat and on the raw membership row", async () => {
    auth.mockResolvedValue({ user: { email: "coach@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Manager" }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest())).json();
    expect(body).toMatchObject({ role: "coach", staffRole: "Manager", playerIds: [], playerNames: [] });
    expect(body.hats).toEqual([{ role: "coach", playerIds: [], playerNames: [], staffRole: "Manager" }]);
    expect(body.memberships).toEqual([{ teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Manager" }]);
  });

  it("flags club admins so the dashboard can offer the team wizard", async () => {
    auth.mockResolvedValue({ user: { email: "td@club.com" } });
    isAdminEmail.mockReturnValue(false);
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest())).json();
    expect(body).toMatchObject({ role: "viewer", admin: false, clubAdmin: true });

    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }] });
    expect((await (await GET(fakeRequest())).json()).clubAdmin).toBe(false);
  });

  it("401s an unauthenticated caller or a plain account with no memberships", async () => {
    const { GET } = await loadRoute({ authOn: true });
    auth.mockResolvedValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("gives a super admin in an empty club a 200 admin payload instead of a 401", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    isAdminEmail.mockReturnValue(true);
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "account", email: "boss@dam.fund", admin: true, role: null,
      teamSlug: null, teamName: null, hats: [], teams: [], memberships: [], canSwitch: false, clubAdmin: false
    });
  });
});

describe("account mode — hats (one login, several roles on one team)", () => {
  const coachParent = () => {
    auth.mockResolvedValue({ user: { email: "coach@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Head coach" },
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Ava" }
    ] });
  };

  it("wears the strongest hat (coach) by default and lists both hats", async () => {
    coachParent();
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest())).json();
    expect(body).toMatchObject({ teamSlug: "a", role: "coach", staffRole: "Head coach", playerIds: [], playerNames: [], canSwitch: true });
    expect(body.hats).toEqual([
      { role: "coach", playerIds: [], playerNames: [], staffRole: "Head coach" },
      { role: "parent", playerIds: ["p1", "p2"], playerNames: ["Sam", "Ava"] }
    ]);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].hats).toEqual(body.hats);
  });

  it("reports the parent hat with the children when act_as=parent", async () => {
    coachParent();
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest({ cookies: { act_as: "parent" } }))).json();
    expect(body).toMatchObject({ role: "parent", playerIds: ["p1", "p2"], playerNames: ["Sam", "Ava"], canSwitch: true });
    expect("staffRole" in body).toBe(false);
    // The hat list itself does not change with the cookie.
    expect(body.hats.map((h) => h.role)).toEqual(["coach", "parent"]);
  });

  it("never lets a forged act_as widen a plain parent into a coach", async () => {
    auth.mockResolvedValue({ user: { email: "mum@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await GET(fakeRequest({ cookies: { act_as: "coach" } }))).json();
    expect(body).toMatchObject({ role: "parent", playerIds: ["p1"], canSwitch: false });
    expect(body.hats).toEqual([{ role: "parent", playerIds: ["p1"], playerNames: ["Sam"] }]);
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
    expect(body).toMatchObject({ email: "mum@x.com", role: "parent", playerIds: ["p1"], viewingAs: "mum@x.com", realAdmin: true, admin: false });
  });

  it("explains instead of 401ing when the impersonated user has no teams", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("ghost@x.com");
    isAdminEmail.mockReturnValue(true);
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      mode: "account", email: "ghost@x.com", viewingAs: "ghost@x.com", realAdmin: true, admin: false,
      role: null, memberships: [], hats: [], teams: [], canSwitch: false
    });
  });
});
