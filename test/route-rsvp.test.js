import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// The RSVP route is the narrow, parent-facing write path. In account mode its
// job is permission enforcement (parent → own child only; coach → anyone); in
// legacy team-code mode anyone with the code may write and the whoami cookie
// attributes the entry. Both modes do a surgical single-entry merge. AUTH_ON
// is read at module load, so each block re-imports the route.
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
  return import("@/app/api/rsvp/route");
}

const PLAYER = { id: "p1", name: "Sam", parentEmails: ["mum@a.com"] };
const TEAM_DATA = () => ({ fixtures: [{ id: "f1", availability: {} }], sessions: [{ id: "s1", availability: {} }], players: [PLAYER] });

function happyPath({ email = "mum@a.com", coach = false } = {}) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: coach ? "coach" : "parent" }] });
  teamBySlug.mockReturnValue({ slug: "a", name: "Team A" });
  getData.mockResolvedValue(TEAM_DATA());
  isCoachForTeam.mockResolvedValue(coach);
  setData.mockResolvedValue();
}

describe("account mode — request validation", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(401);
  });

  it("400s on malformed JSON", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({})); // no body → json() throws
    expect(res.status).toBe(400);
  });

  it("400s on an invalid kind or missing ids", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ body: { kind: "nope", id: "f1", playerId: "p1", status: "in" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { kind: "game", playerId: "p1", status: "in" } }))).status).toBe(400);
  });

  it("400s on an invalid status", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "maybe" } }));
    expect(res.status).toBe(400);
  });

  it("400s for a session RSVP with no occurrence date", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "session", id: "s1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(400);
  });
});

describe("account mode — team resolution", () => {
  it("401s when the caller has no memberships", async () => {
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(401);
  });

  it("ignores a team_slug cookie for a team the caller is not in", async () => {
    happyPath();
    teamBySlug.mockReturnValue({ slug: "a", name: "Team A" });
    const { POST } = await loadRoute({ authOn: true });
    await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" }, cookies: { team_slug: "other" } }));
    // Falls back to the first membership ("a"), never resolving "other".
    expect(teamBySlug).toHaveBeenCalledWith("a");
  });

  it("404s when the player is not on the roster", async () => {
    happyPath();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "ghost", status: "in" } }));
    expect(res.status).toBe(404);
  });
});

describe("account mode — permissions", () => {
  it("lets a parent set their own child and writes a single availability entry", async () => {
    happyPath({ coach: false });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "in", by: "Sam" });
  });

  it("forbids a parent from setting another family's child", async () => {
    happyPath({ coach: false });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: {} }], players: [{ id: "p1", name: "Other", parentEmails: ["someone@else.com"] }] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("lets a coach set anyone and stamps the entry as Coach", async () => {
    happyPath({ email: "coach@a.com", coach: true });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: {} }], players: [{ id: "p1", name: "Other", parentEmails: ["someone@else.com"] }] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "out", reason: "injured" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "out", reason: "injured", by: "Coach" });
  });

  it("clears a response when status is null (deletes the entry)", async () => {
    happyPath({ coach: false });
    getData.mockResolvedValue({ fixtures: [{ id: "f1", availability: { p1: { status: "in" } } }], players: [PLAYER] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: null } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability).not.toHaveProperty("p1");
  });

  it("merges a session RSVP into the per-occurrence map", async () => {
    happyPath({ coach: false });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "session", id: "s1", occ: "2026-07-01", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.sessions[0].availability["2026-07-01"].p1).toMatchObject({ status: "in" });
  });
});

describe("legacy team-code mode", () => {
  beforeEach(() => {
    teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A" });
    getData.mockResolvedValue(TEAM_DATA());
    setData.mockResolvedValue();
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(401);
  });

  it("lets a code holder write, attributed to the child when whoami matches", async () => {
    const { POST } = await loadRoute({ authOn: false });
    const who = encodeURIComponent(JSON.stringify({ kind: "parent", pid: "p1", label: "Sam" }));
    const res = await POST(fakeRequest({
      body: { kind: "game", id: "f1", playerId: "p1", status: "in" },
      cookies: { whoami_a: who },
      headers: { cookie: "site_auth=team-code" }
    }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "in", by: "Sam" });
    expect(auth).not.toHaveBeenCalled();
  });

  it("attributes to Coach when the whoami identity is someone else (or absent)", async () => {
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "out" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "out", reason: "Away", by: "Coach" });
  });
});

describe("account mode — view as blocks RSVPs", () => {
  it("403s a write while impersonating", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" } }));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});
