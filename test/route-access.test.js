import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/access is the super-admin management surface for the role hierarchy.
// It only exists in account mode. isAdminEmail/OVERRIDE_ROLES come from the
// real directory module (driven by ADMIN_EMAILS), teams from the real teams
// module (driven by TEAMS); the store and session are mocked.
const { auth, getClubAccess, setClubAccess, getData, getStoredTeams } = vi.hoisted(() => ({  auth: vi.fn(), getClubAccess: vi.fn(), setClubAccess: vi.fn(), getData: vi.fn(), getStoredTeams: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getClubAccess, setClubAccess, getData, getStoredTeams }));

const KEYS = ["AUTH_SECRET", "ADMIN_EMAILS", "CLUB_ADMIN_EMAILS", "TEAMS"];
let saved;
beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.TEAMS = JSON.stringify([
    { slug: "a", name: "Team A", password: "pa", coachEmails: ["coach@a.com"] },
    { slug: "b", name: "Team B", password: "pb" }
  ]);
  getClubAccess.mockResolvedValue({});
  setClubAccess.mockResolvedValue();
  getStoredTeams.mockResolvedValue([]);
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function loadRoute({ authOn = true, admin = "boss@dam.fund" } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  if (admin) process.env.ADMIN_EMAILS = admin;
  vi.resetModules();
  return import("@/app/api/access/route");
}

describe("gates", () => {
  it("400s in legacy team-code mode (roles need identities)", async () => {
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/account login/i);
  });

  it("401s when not signed in, 403s a non-admin", async () => {
    const { GET } = await loadRoute();
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    expect((await GET()).status).toBe(403);
  });
});

describe("GET", () => {
  it("returns teams, stored + env club admins, overrides and the role set", async () => {
    process.env.CLUB_ADMIN_EMAILS = "env-td@club.com";
    const { GET } = await loadRoute();
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    getClubAccess.mockResolvedValue({ clubAdmins: ["td@club.com"], overrides: { "x@y.com": { a: "viewer" } } });
    const body = await (await GET()).json();
    expect(body.teams).toEqual([
      { slug: "a", name: "Team A", coachEmails: ["coach@a.com"] },
      { slug: "b", name: "Team B", coachEmails: [] }
    ]);
    expect(body.clubAdmins).toEqual(["td@club.com"]);
    expect(body.envClubAdmins).toEqual(["env-td@club.com"]);
    expect(body.overrides).toEqual({ "x@y.com": { a: "viewer" } });
    expect(body.roles).toContain("blocked");
  });
});

describe("POST", () => {
  const asAdmin = async () => {
    const route = await loadRoute();
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    return route;
  };

  it("sets and clears a per-team override", async () => {
    const { POST } = await asAdmin();
    let res = await POST(fakeRequest({ body: { action: "setOverride", email: "Coach@A.com", teamSlug: "b", role: "parent" } }));
    expect(res.status).toBe(200);
    expect(setClubAccess).toHaveBeenCalledWith({ clubAdmins: [], overrides: { "coach@a.com": { b: "parent" } } });

    getClubAccess.mockResolvedValue({ overrides: { "coach@a.com": { b: "parent" } } });
    res = await POST(fakeRequest({ body: { action: "setOverride", email: "coach@a.com", teamSlug: "b", role: null } }));
    expect(res.status).toBe(200);
    expect(setClubAccess).toHaveBeenLastCalledWith({ clubAdmins: [], overrides: {} });
  });

  it("rejects bad roles, unknown teams, bad emails and overriding the super admin", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { action: "setOverride", email: "x@y.com", teamSlug: "a", role: "king" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { action: "setOverride", email: "x@y.com", teamSlug: "ghost", role: "viewer" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { action: "setOverride", email: "not-an-email", teamSlug: "a", role: "viewer" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { action: "setOverride", email: "boss@dam.fund", teamSlug: "a", role: "viewer" } }))).status).toBe(400);
    expect(setClubAccess).not.toHaveBeenCalled();
  });

  it("adds and removes stored club admins (normalised, deduped)", async () => {
    const { POST } = await asAdmin();
    await POST(fakeRequest({ body: { action: "addClubAdmin", email: " TD@Club.com " } }));
    expect(setClubAccess).toHaveBeenCalledWith({ clubAdmins: ["td@club.com"], overrides: {} });

    getClubAccess.mockResolvedValue({ clubAdmins: ["td@club.com"] });
    await POST(fakeRequest({ body: { action: "addClubAdmin", email: "td@club.com" } }));
    expect(setClubAccess).toHaveBeenLastCalledWith({ clubAdmins: ["td@club.com"], overrides: {} });

    await POST(fakeRequest({ body: { action: "removeClubAdmin", email: "td@club.com" } }));
    expect(setClubAccess).toHaveBeenLastCalledWith({ clubAdmins: [], overrides: {} });
  });

  it("rejects an unknown action", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { action: "explode", email: "x@y.com" } }))).status).toBe(400);
  });
});

describe("POST — view as", () => {
  const asAdmin = async () => {
    const route = await loadRoute();
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    return route;
  };

  it("sets a session view_as cookie for a target email", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: { action: "viewAs", email: "Mum@A.com" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).viewingAs).toBe("mum@a.com");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("view_as="));
    expect(cookie).toContain("view_as=mum%40a.com");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("Max-Age"); // session-lived
  });

  it("refuses to view as the super admin themself and clears on request", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { action: "viewAs", email: "boss@dam.fund" } }))).status).toBe(400);
    const res = await POST(fakeRequest({ body: { action: "clearViewAs" } }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("view_as="))).toContain("Max-Age=0");
  });

  it("GET reports the active impersonation", async () => {
    const { GET } = await asAdmin();
    const body = await (await GET(fakeRequest({ cookies: { view_as: "mum@a.com" } }))).json();
    expect(body.viewingAs).toBe("mum@a.com");
  });
});
