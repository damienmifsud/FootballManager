import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { COMP as MAJESTRI_COMP, PAGE as MAJESTRI_PAGE } from "./helpers/majestriPage";

// /api/sync has three auth lanes: a cron/pinger secret (syncs every team), a
// signed-in account (syncs only their team: the throttled ?ifStale=1
// sync-on-visit is open to any hat, a manual sync needs the WORN coach hat),
// and — in legacy team-code mode — anyone holding the code (drives the
// sync-on-visit and the /league Sync button). The Squadi fetch/apply is
// mocked so no network is touched. AUTH_ON is read at module load, so each
// test re-imports the route with the right env. lib/viewer is the real
// module — only its dependencies are mocked.
const m = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(), getMeta: vi.fn(), setMeta: vi.fn(),
  takeLock: vi.fn(async () => true), dropLock: vi.fn(async () => {}),
  fetchSquadi: vi.fn(), applySync: vi.fn(), getTeams: vi.fn(), teamBySlug: vi.fn(),
  teamFromCookieHeader: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/store", () => ({ getData: m.getData, setData: m.setData, getMeta: m.getMeta, setMeta: m.setMeta, takeLock: m.takeLock, dropLock: m.dropLock }));
vi.mock("@/lib/squadiSync", () => ({ fetchSquadi: m.fetchSquadi, applySync: m.applySync }));
// The route reads a team's draws (its season's one or two feeds, and its other
// competitions) through lib/competitions.js, which is the real, pure module.
vi.mock("@/lib/teams", () => ({ getTeams: m.getTeams, teamBySlug: m.teamBySlug, teamFromCookieHeader: m.teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail: m.membershipsForEmail, viewingAs: m.viewingAs }));

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
  // clearAllMocks keeps return values, so the view-as test would otherwise
  // leak its impersonation into every test that runs after it.
  m.viewingAs.mockReturnValue(null);
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

  const PARENT = { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" };
  const COACH = { teamSlug: "a", teamName: "Team A", role: "coach" };

  it("403s a parent (non-coach) trying to trigger a manual sync", async () => {
    m.auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [PARENT] });
    m.teamBySlug.mockReturnValue(TEAM);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(403);
    expect(m.fetchSquadi).not.toHaveBeenCalled();
  });

  it("lets a parent's visit run the throttled ifStale sync (keeps fixtures near-live for everyone)", async () => {
    m.auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [PARENT] });
    m.teamBySlug.mockReturnValue(TEAM);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync?ifStale=1" }));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, team: "a" });
    expect(m.fetchSquadi).toHaveBeenCalledWith(TEAM.squadi);
  });

  it("syncs just the coach's own team", async () => {
    m.auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [COACH] });
    m.teamBySlug.mockReturnValue(TEAM);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, team: "a" });
  });

  it("403s a coach-parent who has chosen to act as the parent (manual sync)", async () => {
    m.auth.mockResolvedValue({ user: { email: "both@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [COACH, PARENT] });
    m.teamBySlug.mockReturnValue(TEAM);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync", cookies: { act_as: "parent" } }));
    expect(res.status).toBe(403);
    expect(m.fetchSquadi).not.toHaveBeenCalled();
  });

  it("409s a member of several teams with no team chosen", async () => {
    m.auth.mockResolvedValue({ user: { email: "both@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [COACH, { teamSlug: "b", teamName: "Team B", role: "coach" }] });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(409);
    expect(m.fetchSquadi).not.toHaveBeenCalled();
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

describe("account mode — view as blocks any sync", () => {
  it("403s while impersonating (manual and sync-on-visit alike — a sync writes)", async () => {
    m.getTeams.mockReturnValue([TEAM]);
    m.auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    m.viewingAs.mockReturnValue("mum@a.com");
    const { GET } = await loadRoute({ authOn: true });
    expect((await GET(fakeRequest({ url: "https://x.test/api/sync" }))).status).toBe(403);
    expect((await GET(fakeRequest({ url: "https://x.test/api/sync?ifStale=1" }))).status).toBe(403);
    expect(m.fetchSquadi).not.toHaveBeenCalled();
  });
});

describe("two Squadi feeds on one squad", () => {
  const McKay = { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 };
  const McKain = { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 };
  const TWO = { slug: "a", name: "U9 Academy", squadi: [McKay, McKain] };
  const cron = async () => {
    m.getTeams.mockReturnValue([TWO]);
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }));
    return (await res.json()).results[0];
  };
  // applySync stand-in: appends one fixture per call, tagged with the side.
  const appending = () => m.applySync.mockImplementation((doc, squadi, { side } = {}) => ({
    data: { ...doc, fixtures: [...doc.fixtures, { id: side, side, schedChanges: [] }] },
    changes: [`NEW — ${side} · Round 1 vs X`], created: 1, mutated: true
  }));

  it("applies both feeds in order, threading the document, and saves once", async () => {
    appending();
    m.fetchSquadi.mockResolvedValue([{ squadiId: 1 }]);
    const r = await cron();
    expect(m.fetchSquadi.mock.calls.map((c) => c[0])).toEqual([McKay, McKain]);
    expect(m.applySync.mock.calls.map((c) => c[2])).toEqual([{ comp: null, side: "McKay" }, { comp: null, side: "McKain" }]); // both are season draws
    expect(m.applySync.mock.calls[1][0].fixtures.map((f) => f.id)).toEqual(["McKay"]); // second feed sees the first's result
    expect(m.setData).toHaveBeenCalledTimes(1);
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => f.side)).toEqual(["McKay", "McKain"]);
    expect(m.setMeta).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ team: "a", matchesSeen: 2, created: 2, changes: ["NEW — McKay · Round 1 vs X", "NEW — McKain · Round 1 vs X"] });
    expect("failed" in r).toBe(false);
  });

  it("a failing feed leaves the other applied and is named, by its side, under failed", async () => {
    appending();
    m.fetchSquadi.mockImplementation(async (feed) => { if (feed.label === "McKay") throw new Error("Squadi responded 503"); return [{ squadiId: 2 }]; });
    const r = await cron();
    expect(m.setData).toHaveBeenCalledTimes(1);
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => f.side)).toEqual(["McKain"]);
    expect(r.failed).toEqual([{ name: "McKay", side: "McKay", error: "Squadi responded 503" }]);
    expect(r).toMatchObject({ team: "a", created: 1, changes: ["NEW — McKain · Round 1 vs X"] });
    expect(m.setMeta).toHaveBeenCalledTimes(1);
  });

  it("when every feed fails it responds as a failed single feed does and writes nothing", async () => {
    m.fetchSquadi.mockRejectedValue(new Error("Unexpected Squadi response shape"));
    const r = await cron();
    expect(r).toMatchObject({ team: "a", ok: false });
    expect(r.error).toContain("Unexpected Squadi response shape");
    expect(m.setData).not.toHaveBeenCalled();
    expect(m.setMeta).not.toHaveBeenCalled();
  });

  it("judges the first-import email suppression per feed and keeps the other side's change banners", async () => {
    const news = (n, side) => Array.from({ length: n }, (_, i) => `NEW — ${side} · Round ${i + 1} vs X`);
    m.getData.mockResolvedValue({ fixtures: [{ id: "old", side: "McKay", schedChanges: [{ field: "Time" }] }] });
    m.applySync.mockImplementation((doc, squadi, { side }) => side === "McKay"
      ? { data: doc, changes: ["McKay · Round 3 vs X: time a → b"], created: 0, mutated: true }
      : { data: { ...doc, fixtures: [...doc.fixtures, ...[1, 2, 3, 4].map((n) => ({ id: "n" + n, side, schedChanges: [{ field: "New game" }] }))] }, changes: news(4, side), created: 4, mutated: true });
    const r = await cron();
    const saved = m.setData.mock.calls[0][1].fixtures;
    expect(saved.find((f) => f.id === "old").schedChanges).toHaveLength(1);
    expect(saved.filter((f) => f.id !== "old").every((f) => f.schedChanges.length === 0)).toBe(true);
    expect(r.changes).toHaveLength(5);
    expect(r.emailStatus).toBe("email not configured"); // the McKay change was sent on; the McKain import was not news
  });

  it("no changes on either feed: nothing saved, lastSyncAt set once, no errors", async () => {
    const r = await cron();
    expect(m.setData).not.toHaveBeenCalled();
    expect(m.setMeta).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ team: "a", changes: [], created: 0, emailStatus: "no changes" });
    expect("failed" in r).toBe(false);
  });

  it("a single-feed team is synced exactly as before: one fetch, no side", async () => {
    m.getTeams.mockReturnValue([TEAM]);
    m.applySync.mockReturnValue({ data: { fixtures: [{ id: "x", schedChanges: [] }] }, changes: ["Round 1 vs X: time a → b"], created: 0, mutated: true });
    const { GET } = await loadRoute({ authOn: true });
    const r = (await (await GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }))).json()).results[0];
    expect(m.fetchSquadi).toHaveBeenCalledTimes(1);
    expect(m.fetchSquadi).toHaveBeenCalledWith(TEAM.squadi);
    expect(m.applySync.mock.calls[0][2]).toEqual({ comp: null }); // the season, and no side
    expect(m.setData).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ team: "a", matchesSeen: 0, created: 0, changes: ["Round 1 vs X: time a → b"], emailStatus: "email not configured", checked: ["Squadi"] });
  });
});

// A team can have several Squadi draws: its season and any other competition
// on its registry entry whose ids are complete (lib/competitions.js, the real
// module). The route fetches every draw, applies each in turn and saves once.
describe("a team with more than one draw", () => {
  const SEASON_IDS = TEAM.squadi;
  const WINTER_IDS = { competitionId: "4", divisionId: "5", teamId: 6 };
  const MULTI = {
    ...TEAM,
    competitions: [
      { id: "cw", name: "Winterfest", squadi: WINTER_IDS },
      { id: "cp", name: "Premier Invitational" }, // draw not published yet: named, no ids
      { id: "ch", name: "Half filled", squadi: { competitionId: "7", divisionId: "", teamId: 0 } }
    ]
  };
  const cron = (GET) => GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }));
  // A stand-in applySync: each match in the draw becomes a fixture, tagged like the real one.
  const applyLikeReal = (data, squadi, opts) => {
    const fixtures = [...(data.fixtures || []), ...squadi.map((s) => ({ id: "f-" + s.squadiId, squadiId: s.squadiId, ...(opts?.comp ? { comp: opts.comp.id, compName: opts.comp.name } : {}), schedChanges: [{ field: "New game" }] }))];
    const label = opts?.comp ? opts.comp.name + " " : "";
    return { data: { ...data, fixtures }, changes: squadi.map((s) => `NEW — ${label}${s.squadiId}`), created: squadi.length, mutated: squadi.length > 0 };
  };

  let savedResend, savedNotify, realFetch;
  beforeEach(() => {
    savedResend = process.env.RESEND_API_KEY; savedNotify = process.env.NOTIFY_EMAILS; realFetch = global.fetch;
    delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAILS;
    m.getTeams.mockReturnValue([MULTI]);
    m.fetchSquadi.mockImplementation(async (ids) => (ids === SEASON_IDS ? [{ squadiId: "s1" }] : [{ squadiId: "w1" }, { squadiId: "w2" }]));
    m.applySync.mockImplementation(applyLikeReal);
  });
  afterEach(() => {
    if (savedResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedResend;
    if (savedNotify === undefined) delete process.env.NOTIFY_EMAILS; else process.env.NOTIFY_EMAILS = savedNotify;
    global.fetch = realFetch;
  });

  it("fetches the season and every competition whose ids are complete, and no other", async () => {
    const { GET } = await loadRoute({ authOn: true });
    const res = await cron(GET);
    expect(res.status).toBe(200);
    expect(m.fetchSquadi.mock.calls.map((c) => c[0])).toEqual([SEASON_IDS, WINTER_IDS]);
  });

  it("applies each draw with its own competition, the second on top of the first, and saves once", async () => {
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(m.applySync).toHaveBeenCalledTimes(2);
    expect(m.applySync.mock.calls[0][2]).toEqual({ comp: null });
    expect(m.applySync.mock.calls[1][2]).toEqual({ comp: { id: "cw", name: "Winterfest" } });
    // The Winterfest draw is applied to the document the season's draw produced.
    expect(m.applySync.mock.calls[1][0].fixtures.map((f) => f.squadiId)).toEqual(["s1"]);
    expect(m.setData).toHaveBeenCalledTimes(1);
    const [slug, saved] = m.setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.fixtures.map((f) => [f.squadiId, f.comp || "season"])).toEqual([["s1", "season"], ["w1", "cw"], ["w2", "cw"]]);
    expect(body.results[0]).toMatchObject({ team: "a", matchesSeen: 3, created: 3, changes: ["NEW — s1", "NEW — Winterfest w1", "NEW — Winterfest w2"] });
    expect("failed" in body.results[0]).toBe(false);
  });

  it("one draw failing does not stop the others: it is named under failed and the rest are saved", async () => {
    m.fetchSquadi.mockImplementation(async (ids) => { if (ids === WINTER_IDS) throw new Error("Squadi responded 404"); return [{ squadiId: "s1" }]; });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toMatchObject({ team: "a", created: 1, changes: ["NEW — s1"], failed: [{ name: "Winterfest", error: "Squadi responded 404" }] });
    expect(body.results[0].ok).toBeUndefined(); // not an error for the team
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => f.squadiId)).toEqual(["s1"]);
    // The other way round: the season's draw is down, Winterfest still comes in.
    m.setData.mockClear();
    m.fetchSquadi.mockImplementation(async (ids) => { if (ids === SEASON_IDS) throw new Error("Squadi responded 503"); return [{ squadiId: "w1" }]; });
    const again = await (await cron(GET)).json();
    expect(again.results[0]).toMatchObject({ created: 1, failed: [{ name: "Season", error: "Squadi responded 503" }] });
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => [f.squadiId, f.comp])).toEqual([["w1", "cw"]]);
    // A season with a name of its own is named by it.
    m.getTeams.mockReturnValue([{ ...MULTI, seasonName: "Academy League" }]);
    const named = await (await cron(GET)).json();
    expect(named.results[0].failed).toEqual([{ name: "Academy League", error: "Squadi responded 503" }]);
  });

  it("every draw failing is the team's error, as it was with one draw: nothing is saved", async () => {
    m.fetchSquadi.mockRejectedValue(new Error("Squadi responded 503"));
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toMatchObject({ team: "a", ok: false });
    expect(body.results[0].error).toContain("503");
    expect(m.applySync).not.toHaveBeenCalled();
    expect(m.setData).not.toHaveBeenCalled();
    // A coach pressing Sync now gets the same as a 502.
    m.auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "coach" }] });
    m.teamBySlug.mockReturnValue(MULTI);
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("503") });
  });

  it("another competition can be the only draw there is: the season's is not out yet", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", competitions: MULTI.competitions }]);
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(m.fetchSquadi.mock.calls.map((c) => c[0])).toEqual([WINTER_IDS]);
    expect(body.results[0]).toMatchObject({ team: "a", created: 2 });
    expect(m.setData.mock.calls[0][1].fixtures.every((f) => f.comp === "cw")).toBe(true);
  });

  it("a team whose draws are all still to come is skipped without a request", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", competitions: [{ id: "cp", name: "Premier Invitational" }] }]);
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toEqual({ team: "a", skipped: "no squadi config" });
    expect(m.fetchSquadi).not.toHaveBeenCalled();
    expect(m.setData).not.toHaveBeenCalled();
  });

  it("reads the document after Squadi has answered, so a reply saved meanwhile is in what the sync saves", async () => {
    const before = { fixtures: [{ id: "old", availability: {} }] };
    const after = { fixtures: [{ id: "old", availability: { p1: { status: "in" } } }] }; // a parent replied while Squadi was answering
    m.getData.mockReset();
    m.getData.mockResolvedValueOnce(before).mockResolvedValue(after);
    const { GET } = await loadRoute({ authOn: true });
    await cron(GET);
    expect(m.applySync.mock.calls[0][0]).toBe(after);
    // Order: the last fetch finished before the document was read for the save.
    const lastFetch = Math.max(...m.fetchSquadi.mock.invocationCallOrder);
    const readForSave = m.getData.mock.invocationCallOrder[1];
    expect(readForSave).toBeGreaterThan(lastFetch);
    expect(m.setData.mock.calls[0][1].fixtures[0]).toEqual({ id: "old", availability: { p1: { status: "in" } } });
  });

  it("a competition's first import is not news; a real change in the same run still is", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.NOTIFY_EMAILS = "coach@a.com";
    const sent = [];
    global.fetch = vi.fn(async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; });
    // The season: one game moved (a change, nothing created). Winterfest: five games arriving for the first time.
    m.fetchSquadi.mockImplementation(async (ids) => (ids === SEASON_IDS ? [{ squadiId: "s1" }] : ["w1", "w2", "w3", "w4", "w5"].map((squadiId) => ({ squadiId }))));
    m.applySync.mockImplementation((data, squadi, opts) => (opts.comp
      ? applyLikeReal(data, squadi, opts)
      : { data: { ...data, fixtures: (data.fixtures || []).map((f) => (f.id === "old" ? { ...f, schedChanges: [{ field: "Time" }] } : f)) }, changes: ["Round 3 vs Wests: time moved"], created: 0, mutated: true }));
    m.getData.mockResolvedValue({ fixtures: [{ id: "old", squadiId: "s1", schedChanges: [] }] });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0].emailStatus).toBe("emailed");
    // Only the season's change is emailed.
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Round 3 vs Wests: time moved");
    expect(sent[0].text).not.toContain("Winterfest");
    expect(sent[0].subject).toContain("1 fixture change");
    // Every change is still reported to whoever asked.
    expect(body.results[0].changes).toHaveLength(6);
    const saved = m.setData.mock.calls[0][1].fixtures;
    // The season game keeps its "time changed" badge; the five new games arrive without a "new game" one.
    expect(saved.find((f) => f.id === "old").schedChanges).toEqual([{ field: "Time" }]);
    expect(saved.filter((f) => f.comp === "cw")).toHaveLength(5);
    expect(saved.filter((f) => f.comp === "cw").every((f) => f.schedChanges.length === 0)).toBe(true);
  });

  it("a first import on its own says so and sends nothing", async () => {
    process.env.RESEND_API_KEY = "key";
    process.env.NOTIFY_EMAILS = "coach@a.com";
    global.fetch = vi.fn(async () => ({ ok: true }));
    m.fetchSquadi.mockImplementation(async (ids) => (ids === SEASON_IDS ? [] : ["w1", "w2", "w3", "w4"].map((squadiId) => ({ squadiId }))));
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0].emailStatus).toBe("initial import — email skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("nothing new in any draw: nothing is saved, only the sync clock moves", async () => {
    m.fetchSquadi.mockResolvedValue([]);
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toMatchObject({ team: "a", matchesSeen: 0, created: 0, changes: [], emailStatus: "no changes" });
    expect(m.setData).not.toHaveBeenCalled();
    expect(m.setMeta).toHaveBeenCalledTimes(1);
  });
});

// Both at once: one squad with two season feeds that also plays another
// competition. Three draws, one save, and each failure named for what it is.
describe("a two-team squad that also plays another competition", () => {
  const McKay = { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 };
  const McKain = { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 };
  const WINTER_IDS = { competitionId: "1750", divisionId: "20001", teamId: 300123 };
  const SQUAD = { slug: "a", name: "U9 Academy", squadi: [McKay, McKain], competitions: [{ id: "cw", name: "Winterfest", squadi: WINTER_IDS }, { id: "cp", name: "Not published" }] };
  const run = async () => {
    m.getTeams.mockReturnValue([SQUAD]);
    const { GET } = await loadRoute({ authOn: true });
    return (await (await GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }))).json()).results[0];
  };
  // applySync stand-in: one fixture per call, carrying what the call was told.
  const tagging = () => m.applySync.mockImplementation((doc, squadi, { comp, side } = {}) => ({
    data: { ...doc, fixtures: [...doc.fixtures, { id: side || comp.id, ...(side ? { side } : {}), ...(comp ? { comp: comp.id } : {}), schedChanges: [] }] },
    changes: [`NEW — ${side || comp.name}`], created: 1, mutated: true
  }));
  const whose = (ids) => (ids.label || "Winterfest");

  it("pulls three draws, each applied as what it is, into one save", async () => {
    tagging();
    m.fetchSquadi.mockResolvedValue([{ squadiId: 1 }]);
    const r = await run();
    expect(m.fetchSquadi.mock.calls.map((c) => c[0])).toEqual([McKay, McKain, WINTER_IDS]);
    expect(m.applySync.mock.calls.map((c) => c[2])).toEqual([
      { comp: null, side: "McKay" }, { comp: null, side: "McKain" }, { comp: { id: "cw", name: "Winterfest" }, side: undefined }
    ]);
    // Each is applied on top of the one before.
    expect(m.applySync.mock.calls.map((c) => c[0].fixtures.length)).toEqual([0, 1, 2]);
    expect(m.setData).toHaveBeenCalledTimes(1);
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => [f.side || "", f.comp || ""])).toEqual([["McKay", ""], ["McKain", ""], ["", "cw"]]);
    expect(m.setMeta).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ team: "a", matchesSeen: 3, created: 3, changes: ["NEW — McKay", "NEW — McKain", "NEW — Winterfest"] });
    expect("failed" in r).toBe(false);
  });

  it("names each failure for what it is: a feed by its side, the competition by its name", async () => {
    tagging();
    m.fetchSquadi.mockImplementation(async (ids) => { if (whose(ids) !== "McKay") throw new Error(`Squadi responded 50${whose(ids) === "McKain" ? 3 : 4}`); return [{ squadiId: 1 }]; });
    const r = await run();
    expect(r.failed).toEqual([
      { name: "McKain", side: "McKain", error: "Squadi responded 503" },
      { name: "Winterfest", error: "Squadi responded 504" }
    ]);
    expect("side" in r.failed[1]).toBe(false);
    // McKay's draw is still applied and saved.
    expect(m.setData.mock.calls[0][1].fixtures.map((f) => f.side)).toEqual(["McKay"]);
    expect(r).toMatchObject({ created: 1, changes: ["NEW — McKay"] });
    expect(r.ok).toBeUndefined();
  });

  it("only when all three fail is the team's sync an error, with nothing written", async () => {
    m.fetchSquadi.mockRejectedValue(new Error("Squadi responded 500"));
    const r = await run();
    expect(r).toMatchObject({ team: "a", ok: false });
    expect(r.error).toContain("Squadi responded 500");
    expect(m.setData).not.toHaveBeenCalled();
    expect(m.setMeta).not.toHaveBeenCalled();
  });

  it("a draw's first import is judged on its own beside the other two", async () => {
    // McKay's game moves; McKain's draw arrives for the first time (five games); Winterfest has nothing new.
    m.getData.mockResolvedValue({ fixtures: [{ id: "old", side: "McKay", schedChanges: [{ field: "Time" }] }] });
    m.applySync.mockImplementation((doc, squadi, { comp, side } = {}) => {
      if (side === "McKay") return { data: doc, changes: ["McKay · Round 3 vs X: time a → b"], created: 0, mutated: true };
      if (comp) return { data: doc, changes: [], created: 0, mutated: false };
      const fresh = [1, 2, 3, 4, 5].map((n) => ({ id: "n" + n, side, schedChanges: [{ field: "New game" }] }));
      return { data: { ...doc, fixtures: [...doc.fixtures, ...fresh] }, changes: fresh.map((f) => `NEW — McKain · ${f.id}`), created: 5, mutated: true };
    });
    const r = await run();
    const saved = m.setData.mock.calls[0][1].fixtures;
    expect(saved.find((f) => f.id === "old").schedChanges).toHaveLength(1); // McKay's real change keeps its badge
    expect(saved.filter((f) => f.id !== "old").every((f) => f.schedChanges.length === 0)).toBe(true); // McKain's first import has none
    expect(r.changes).toHaveLength(6);
    expect(r.created).toBe(5);
  });
});

// A competition whose draw is on a club's Majestri site is read here, on the
// server, beside Squadi's (lib/majestriDraw.js is the real module; the network
// is a stand-in serving a made-up competition page).
describe("a competition on Majestri", () => {
  const SEASON = { competitionId: "777", divisionId: "2", teamId: 3 };
  const FIVES = { id: "cfives", name: "Winter Fives", majestri: { url: MAJESTRI_COMP, team: "Riverside Rockets" } };
  const cron = (GET) => GET(fakeRequest({ url: "https://x.test/api/sync", headers: { authorization: "Bearer s3cret" } }));
  const applyLikeReal = (data, records, opts) => {
    const fixtures = [...(data.fixtures || []), ...records.filter((r) => !r.bye).map((r) => ({ id: "f-" + r.squadiId, squadiId: r.squadiId, opponent: r.opponent, ...(opts?.comp ? { comp: opts.comp.id, compName: opts.comp.name } : {}) }))];
    return { data: { ...data, fixtures }, changes: records.filter((r) => !r.bye).map((r) => `NEW — ${r.squadiId}`), created: records.filter((r) => !r.bye).length, mutated: records.length > 0 };
  };
  let realFetch, savedResend, savedNotify, asked, emails;
  beforeEach(() => {
    realFetch = global.fetch; savedResend = process.env.RESEND_API_KEY; savedNotify = process.env.NOTIFY_EMAILS;
    delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAILS;
    asked = []; emails = [];
    global.fetch = vi.fn(async (url, opts = {}) => {
      asked.push(String(url));
      if (String(url) === "https://api.resend.com/emails") { emails.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}) }; }
      if (String(url) === MAJESTRI_COMP) return { ok: true, status: 200, text: async () => MAJESTRI_PAGE };
      throw new TypeError("unexpected " + url);
    });
    m.fetchSquadi.mockResolvedValue([{ squadiId: "s1", opponent: "Wests" }]);
    m.applySync.mockImplementation(applyLikeReal);
  });
  afterEach(() => {
    global.fetch = realFetch;
    if (savedResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedResend;
    if (savedNotify === undefined) delete process.env.NOTIFY_EMAILS; else process.env.NOTIFY_EMAILS = savedNotify;
  });

  it("reads the competition's page on the server and applies our games to the competition, beside the season's", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", squadi: SEASON, competitions: [FIVES] }]);
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(asked).toEqual([MAJESTRI_COMP]); // one request to Majestri, at the stored address
    expect(m.fetchSquadi).toHaveBeenCalledTimes(1);
    expect(m.applySync).toHaveBeenCalledTimes(2);
    expect(m.applySync.mock.calls[1][2]).toEqual({ comp: { id: "cfives", name: "Winter Fives" } });
    const records = m.applySync.mock.calls[1][1];
    expect(records.filter((r) => !r.bye).map((r) => [r.squadiId, r.opponent, r.homeAway])).toEqual([
      ["majestri:9001:rnd9f9f9f9:0", "Valley Vipers", "H"], ["majestri:9001:rnd0a1b2c3:0", "Hilltop Hawks", "H"], ["majestri:9001:rnd4d5e6f7:0", "Valley Vipers", "A"],
      ["majestri:9001:rnd1c1c1c1:0", "Lakeside Lions & Co", "H"], ["majestri:9001:rnd1c1c1c1:1", "Hilltop Hawks", "A"]
    ]);
    expect(body.results[0]).toMatchObject({ team: "a", checked: ["Squadi", "Majestri"], created: 6 });
    expect(m.setData).toHaveBeenCalledTimes(1);
  });

  it("while another sync holds the team's lock, the team is read and written by neither, and its result says busy", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", squadi: SEASON, competitions: [FIVES] }]);
    m.takeLock.mockResolvedValueOnce(false);
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toMatchObject({ team: "a", busy: true, created: 0, changes: [] });
    expect([m.getData.mock.calls.length, m.setData.mock.calls.length, m.applySync.mock.calls.length]).toEqual([1, 0, 0]); // only the check that the team has a document
  });

  it("gives leave to take scores only to a competition set up so, on Squadi or Majestri: never to the season, nor to one whose scores are entered by hand", async () => {
    const withScores = { ...FIVES, scores: true };
    const byHand = { ...FIVES, id: "cspring", name: "Spring Fives" };
    const cup = { id: "ccup", name: "Winter Cup", squadi: { competitionId: "55", divisionId: "All", teamId: 3 }, scores: true };
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", squadi: SEASON, competitions: [withScores, byHand, cup] }]);
    const { GET } = await loadRoute({ authOn: true });
    await cron(GET);
    expect(m.applySync.mock.calls.map((c) => c[2])).toEqual([
      { comp: null }, { comp: { id: "ccup", name: "Winter Cup" }, scoreFrom: "Squadi" },
      { comp: { id: "cfives", name: "Winter Fives" }, scoreFrom: "Majestri" }, { comp: { id: "cspring", name: "Spring Fives" } }
    ]);
    // The games carry Majestri's scores either way; only the leave decides whether they are taken.
    for (const call of m.applySync.mock.calls.slice(2)) expect(call[1].find((r) => r.squadiId === "majestri:9001:rnd0a1b2c3:0").score).toEqual({ us: 5, them: 2 });
  });

  it("a team whose only draw is on Majestri is synced, on a visit too, and its email says where the changes came from", async () => {
    process.env.RESEND_API_KEY = "re_test"; process.env.NOTIFY_EMAILS = "coach@example.com";
    const fivesOnly = { slug: "a", name: "Team A", competitions: [{ ...FIVES, majestri: { url: MAJESTRI_COMP, team: "Hilltop Hawks" } }] };
    m.getTeams.mockReturnValue([fivesOnly]);
    m.teamBySlug.mockResolvedValue(fivesOnly);
    m.auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    m.membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
    // Two of its games already came in, so the rest are news, not a first import.
    m.getData.mockResolvedValue({ fixtures: [{ id: "x1", squadiId: "majestri:9001:rnd9f9f9f9:0" }, { id: "x2", squadiId: "majestri:9001:rnd0a1b2c3:0" }] });
    m.applySync.mockImplementation((data, records, opts) => ({ data, changes: ["Winter Fives Round 2 vs Riverside Rovers: time 4:30 → 5:10"], created: 0, mutated: true }));
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ url: "https://x.test/api/sync?ifStale=1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, checked: ["Majestri"], emailStatus: "emailed" });
    expect(m.fetchSquadi).not.toHaveBeenCalled();
    expect(emails[0].text).toContain("just came through from Majestri");
  });

  it("a Majestri draw that cannot be read is named, and the season's is still applied", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", squadi: SEASON, competitions: [FIVES] }]);
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, text: async () => "" }));
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toMatchObject({ checked: ["Squadi"], failed: [{ name: "Winter Fives", error: "Majestri responded 403" }] });
    expect(m.applySync).toHaveBeenCalledTimes(1);
  });

  it("when the Majestri draw is the only one and fails, the sync fails with its words", async () => {
    const fivesOnly = { slug: "a", name: "Team A", competitions: [FIVES] };
    m.getTeams.mockReturnValue([fivesOnly]);
    global.fetch = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const { GET } = await loadRoute({ authOn: true });
    const body = await (await cron(GET)).json();
    expect(body.results[0]).toEqual({ team: "a", ok: false, error: "Majestri could not be reached." });
    expect(m.setData).not.toHaveBeenCalled();
  });

  it("a Majestri draw with no team chosen, or behind Squadi ids on the same row, is never read", async () => {
    m.getTeams.mockReturnValue([{ slug: "a", name: "Team A", squadi: SEASON, competitions: [
      { id: "c1", name: "No team", majestri: { url: MAJESTRI_COMP } },
      { id: "c2", name: "Squadi first", squadi: { competitionId: "5", divisionId: "6", teamId: 7 }, majestri: { url: MAJESTRI_COMP, team: "Riverside Rockets" } }
    ] }]);
    const { GET } = await loadRoute({ authOn: true });
    await cron(GET);
    expect(asked).toEqual([]);
    expect(m.fetchSquadi).toHaveBeenCalledTimes(2);
  });
});

