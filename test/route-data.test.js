import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/data: GET is any-member read; POST is the coach/admin-only whole-object
// write in account mode. In legacy team-code mode the site_auth cookie maps to
// one team and everyone with the code can read AND write (the original access
// model). AUTH_ON is read at module load, so each block re-imports the route
// with the right env.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, isCoachForTeam, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isCoachForTeam, viewingAs }));

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
  return import("@/app/api/data/route");
}

function signedIn({ email = "mum@a.com", slug = "a" } = {}) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: slug, role: "parent" }] });
  teamBySlug.mockReturnValue({ slug });
}

describe("account mode (AUTH_SECRET set)", () => {
  describe("GET /api/data", () => {
    it("401s when not signed in", async () => {
      auth.mockResolvedValue(null);
      const { GET } = await loadRoute({ authOn: true });
      expect((await GET(fakeRequest())).status).toBe(401);
    });

    it("401s when the caller has no memberships", async () => {
      auth.mockResolvedValue({ user: { email: "x@y.com" } });
      membershipsForEmail.mockResolvedValue({ memberships: [] });
      const { GET } = await loadRoute({ authOn: true });
      expect((await GET(fakeRequest())).status).toBe(401);
    });

    it("returns the team data to any member", async () => {
      signedIn();
      getData.mockResolvedValue({ team: { name: "A" } });
      const { GET } = await loadRoute({ authOn: true });
      const res = await GET(fakeRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ team: { name: "A" } });
      expect(getData).toHaveBeenCalledWith("a");
    });

    it("resolves the team from the validated team_slug cookie", async () => {
      auth.mockResolvedValue({ user: { email: "mum@x.com" } });
      membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a" }, { teamSlug: "b" }] });
      teamBySlug.mockReturnValue({ slug: "b" });
      getData.mockResolvedValue({});
      const { GET } = await loadRoute({ authOn: true });
      await GET(fakeRequest({ cookies: { team_slug: "b" } }));
      expect(teamBySlug).toHaveBeenCalledWith("b");
    });
  });

  describe("POST /api/data", () => {
    it("403s for a non-coach member", async () => {
      signedIn();
      isCoachForTeam.mockResolvedValue(false);
      const { POST } = await loadRoute({ authOn: true });
      const res = await POST(fakeRequest({ body: { team: { name: "hacked" } } }));
      expect(res.status).toBe(403);
      expect(setData).not.toHaveBeenCalled();
    });

    it("writes the whole document for a coach", async () => {
      signedIn({ email: "coach@a.com" });
      isCoachForTeam.mockResolvedValue(true);
      setData.mockResolvedValue();
      const { POST } = await loadRoute({ authOn: true });
      const body = { team: { name: "A" }, fixtures: [] };
      const res = await POST(fakeRequest({ body }));
      expect(res.status).toBe(200);
      expect(setData).toHaveBeenCalledWith("a", body);
    });

    it("400s a coach on malformed JSON without writing", async () => {
      signedIn({ email: "coach@a.com" });
      isCoachForTeam.mockResolvedValue(true);
      const { POST } = await loadRoute({ authOn: true });
      const res = await POST(fakeRequest({})); // json() throws
      expect(res.status).toBe(400);
      expect(setData).not.toHaveBeenCalled();
    });
  });
});

describe("legacy team-code mode (no AUTH_SECRET)", () => {
  it("GET resolves the team from the site_auth cookie without a session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    getData.mockResolvedValue({ team: { name: "A" } });
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=team-code" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ team: { name: "A" } });
    expect(auth).not.toHaveBeenCalled(); // never touches the session machinery
  });

  it("GET 401s when the cookie matches no team", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { GET } = await loadRoute({ authOn: false });
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("POST lets anyone with the team code write, with no coach check", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    setData.mockResolvedValue();
    const { POST } = await loadRoute({ authOn: false });
    const body = { team: { name: "A" }, fixtures: [] };
    const res = await POST(fakeRequest({ body, headers: { cookie: "site_auth=team-code" } }));
    expect(res.status).toBe(200);
    expect(setData).toHaveBeenCalledWith("a", body);
    expect(isCoachForTeam).not.toHaveBeenCalled();
  });

  it("POST 401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: {} }));
    expect(res.status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("account mode — view as (impersonation)", () => {
  it("GET reads as the impersonated user", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent" }] });
    teamBySlug.mockReturnValue({ slug: "a" });
    getData.mockResolvedValue({ team: { name: "A" } });
    const { GET } = await loadRoute({ authOn: true });
    expect((await GET(fakeRequest())).status).toBe(200);
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
  });

  it("POST is refused while viewing as someone (read-only impersonation)", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { team: { name: "X" } } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/read only/i);
    expect(setData).not.toHaveBeenCalled();
  });
});
