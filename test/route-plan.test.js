import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/plan writes ONE fixture's game plan and nothing else. Coach-gated in
// account mode; any code holder in legacy mode. AUTH_ON is module-load state,
// so each block re-imports the route.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, isCoachForTeam, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isCoachForTeam, viewingAs }));

const PLAN = { subTimes: [10, 30], assignments: [{ GK: "p1" }], updatedAt: 1 };
const DATA = () => ({
  team: { name: "A" },
  players: [{ id: "p1", name: "Sam" }],
  fixtures: [
    { id: "f1", round: 1, us: 3, them: 1, availability: { p1: { status: "in" } } },
    { id: "f2", round: 2 }
  ]
});

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  getData.mockResolvedValue(DATA());
  setData.mockResolvedValue();
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/plan/route");
}

function coachSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
  isCoachForTeam.mockResolvedValue(true);
}

describe("POST /api/plan — validation", () => {
  it("400s on malformed JSON, a missing fixtureId or a non-object plan", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({}))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { plan: PLAN } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { fixtureId: "f1", plan: "junk" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { fixtureId: "f1", plan: { assignments: "junk" } } }))).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s for an unknown fixture", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { fixtureId: "ghost", plan: PLAN } }));
    expect(res.status).toBe(404);
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/plan — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN } }))).status).toBe(401);
  });

  it("403s a parent (non-coach)", async () => {
    coachSession();
    isCoachForTeam.mockResolvedValue(false);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("writes only the target fixture's plan, preserving everything else", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN } }));
    expect(res.status).toBe(200);
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    const f1 = saved.fixtures.find((f) => f.id === "f1");
    // Plan attached; scores and RSVPs on the same fixture untouched.
    expect(f1.plan).toEqual(PLAN);
    expect(f1).toMatchObject({ us: 3, them: 1, availability: { p1: { status: "in" } } });
    // The other fixture and the rest of the document are untouched.
    expect(saved.fixtures.find((f) => f.id === "f2")).toEqual({ id: "f2", round: 2 });
    expect(saved.team).toEqual({ name: "A" });
    expect(saved.players).toHaveLength(1);
  });
});

describe("POST /api/plan — legacy team-code mode", () => {
  it("lets a code holder save a plan without any session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN }, headers: { cookie: "site_auth=code" } }));
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(setData.mock.calls[0][1].fixtures[0].plan).toEqual(PLAN);
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    expect((await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN } }))).status).toBe(401);
  });
});

describe("account mode — view as blocks plan saves", () => {
  it("403s a write while impersonating", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { fixtureId: "f1", plan: PLAN } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});
