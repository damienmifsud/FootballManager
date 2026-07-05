import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/sync has three auth lanes: a cron/pinger secret (syncs every team), a
// signed-in coach in account mode (syncs only their team; parents refused),
// and — in legacy team-code mode — anyone holding the code (drives the
// sync-on-visit and the /league Sync button). The Squadi fetch/apply is
// mocked so no network is touched. AUTH_ON is read at module load, so each
// test re-imports the route with the right env.
const m = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(), getMeta: vi.fn(), setMeta: vi.fn(),
  fetchSquadi: vi.fn(), applySync: vi.fn(), getTeams: vi.fn(), teamBySlug: vi.fn(),
  teamFromCookieHeader: vi.fn(), membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn()
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/store", () => ({ getData: m.getData, setData: m.setData, getMeta: m.getMeta, setMeta: m.setMeta }));
vi.mock("@/lib/squadiSync", () => ({ fetchSquadi: m.fetchSquadi, applySync: m.applySync }));
vi.mock("@/lib/teams", () => ({ getTeams: m.getTeams, teamBySlug: m.teamBySlug, teamFromCookieHeader: m.teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail: m.membershipsForEmail, isCoachForTeam: m.isCoachForTeam }));

const TEAM = { slug: "a", name: "Team A", squadi: { competitionId: "1", divisionId: "2", teamId: 3 } };
let savedSecret, savedAuthSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.CRON_SECRET;
  savedAuthSecret = process.env.AUTH_SECRET;
  process.env.CRON_SECRET = "s3cret";
  // Default successful, no-op sync.
  m.getData.mockResolvedValue({ fixtures: [] });
  m.getMeta.mockResolvedValue({});
  m.setMeta.mockResolvedValue();
  m.setData.mockResolvedValue();
  m.fetchSquadi.mockResolvedValue([]);
  m.applySync.mockReturnValue({ data: { fixtures: [] }, changes: [], created: 0, mutated: false });
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
  if (savedAuthSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedAuthSecret;
});

async function loadRoute({ authOn }) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return import("@/app/api/sync/route");
}

describe("cron / pinger lane", () => {
  it("authorises via the Authorization: Bearer header and syncs every team", async () => {
    m.getTeams.mockReturnValue([TEAM]);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).results).toHaveLength(1);
    expect(m.fetchSquadi).toHaveBeenCalledWith(TEAM.squadi);
    expect(m.auth).not.toHaveBeenCalled(); // never falls through to the session lane
  });

  it("authorises via the ?key= query parameter", async () => {
    m.getTeams.mockReturnValue([TEAM]);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync?key=s3cret" }));
    expect(res.status).toBe(200);
  });

  it("captures a per-team error without failing the whole run", async () => {
    m.getTeams.mockReturnValue([TEAM]);
    m.fetchSquadi.mockRejectedValue(new Error("Squadi responded 503"));
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }));
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ team: "a", ok: false });
    expect(body.results[0].error).toContain("503");
  });

  it("does not treat a wrong secret as cron-authorised", async () => {
    m.auth.mockResolvedValue(null);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync?key=wrong" }));
    expect(res.status).toBe(401); // falls through to the session lane, unauthenticated
  });
});

describe("account mode — signed-in lane", () => {
  beforeEach(() => { m.getTeams.mockReturnValue([TEAM]); });

  it("401s an unauthenticated request with no cron secret", async () => {
    m.auth.mockResolvedValue(null);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(401);
  });

  it("401s a signed-in user with no memberships", async () => {
    m.auth.mockResolvedValue({ user: { email: "x@y.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(401);
  });

  it("403s a parent (non-coach) trying to trigger a sync", async () => {
    m.auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "parent" }] });
    m.teamBySlug.mockReturnValue(TEAM);
    m.isCoachForTeam.mockResolvedValue(false);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(403);
    expect(m.fetchSquadi).not.toHaveBeenCalled();
  });

  it("syncs just the coach's own team", async () => {
    m.auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
    m.teamBySlug.mockReturnValue(TEAM);
    m.isCoachForTeam.mockResolvedValue(true);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, team: "a" });
  });
});

describe("legacy team-code mode", () => {
  it("lets a code holder sync their own team", async () => {
    m.teamFromCookieHeader.mockReturnValue(TEAM);
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync?ifStale=1", headers: { cookie: "site_auth=team-code" } }));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, team: "a" });
    expect(m.auth).not.toHaveBeenCalled();
  });

  it("401s without a valid team-code cookie", async () => {
    m.teamFromCookieHeader.mockReturnValue(null);
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(401);
  });
});
