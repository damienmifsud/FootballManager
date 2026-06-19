import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/data: GET is any-member read; POST is the coach/admin-only whole-object
// write. The forged-cookie guard (team_slug validated against memberships) is
// the isolation property under test.
const { auth, getData, setData, teamBySlug, membershipsForEmail, isCoachForTeam } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isCoachForTeam }));

import { GET, POST } from "@/app/api/data/route";

beforeEach(() => { vi.clearAllMocks(); });

function signedIn({ email = "mum@a.com", slug = "a" } = {}) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: slug, role: "parent" }] });
  teamBySlug.mockReturnValue({ slug });
}

describe("GET /api/data", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("401s when the caller has no memberships", async () => {
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await GET(fakeRequest())).status).toBe(401);
  });

  it("returns the team data to any member", async () => {
    signedIn();
    getData.mockResolvedValue({ team: { name: "A" } });
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
    await GET(fakeRequest({ cookies: { team_slug: "b" } }));
    expect(teamBySlug).toHaveBeenCalledWith("b");
  });
});

describe("POST /api/data", () => {
  it("403s for a non-coach member", async () => {
    signedIn();
    isCoachForTeam.mockResolvedValue(false);
    const res = await POST(fakeRequest({ body: { team: { name: "hacked" } } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("writes the whole document for a coach", async () => {
    signedIn({ email: "coach@a.com" });
    isCoachForTeam.mockResolvedValue(true);
    setData.mockResolvedValue();
    const body = { team: { name: "A" }, fixtures: [] };
    const res = await POST(fakeRequest({ body }));
    expect(res.status).toBe(200);
    expect(setData).toHaveBeenCalledWith("a", body);
  });

  it("400s a coach on malformed JSON without writing", async () => {
    signedIn({ email: "coach@a.com" });
    isCoachForTeam.mockResolvedValue(true);
    const res = await POST(fakeRequest({})); // json() throws
    expect(res.status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });
});
