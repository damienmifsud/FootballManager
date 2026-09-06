import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";
import { brisbaneTodayISO } from "@/lib/visibility";

// /api/data: GET is any-member read, redacted server-side for parents and
// viewers by lib/visibility (real module, not mocked here); POST is the
// coach/admin-only whole-object write in account mode. In legacy team-code
// mode the site_auth cookie maps to one team and everyone with the code can
// read AND write the full document (the original access model, no roles).
// AUTH_ON is read at module load, so each block re-imports the route with the
// right env.
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

// GET runs the stored document through the REAL lib/visibility (not mocked)
// before it leaves the server. A parent gets a redacted copy shaped by the
// coach's "what parents see" switches; a coach gets the whole thing; a super
// admin viewing as a parent gets exactly what that parent would.
describe("account mode — visibility layer on GET", () => {
  // Pin the clock so Brisbane's "today" is deterministic: 15:30Z on the 5th is
  // 01:30 on the 6th in Brisbane, which is what the route must compute.
  const OTHER = "2026-09-13";
  let TODAY;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T15:30:00Z"));
    TODAY = brisbaneTodayISO();
    expect(TODAY).toBe("2026-09-06");
  });
  afterEach(() => vi.useRealTimers());

  const PLAN = () => ({
    subTimes: [10, 20, 30],
    assignments: [{ GK: "p1", DEF1: "p2" }],
    overrides: { p2: false },
    timer: { startedAt: 1 },
    hintSeen: true,
    updatedAt: 1
  });
  const RECORD = () => ({
    savedAt: 2, savedBy: "coach@a.com", auto: false, scoreUs: 3, scoreThem: 1,
    shapes: ["2-3-1"], theirShapes: ["3-3"], blocks: [{ start: 0, end: 10 }],
    minutes: [{ pid: "p1", min: 30 }, { pid: "p2", min: 20 }],
    matchLog: [{ at: 4, text: "Goal for us" }], oppNote: "Quick on the break",
    snapshot: { players: [] }
  });
  const fullDoc = (parentsSee = {}) => ({
    team: {
      name: "A",
      coachPin: "1234",
      parentsSee,
      rules: [{ id: "bi-period", text: "Everyone available plays in both halves", builtin: true }]
    },
    players: [
      { id: "p1", name: "Sam", coach: { ratings: { GK: 3, DEF: 4, MID: 2, FWD: 1 }, note: "Left foot only" } },
      { id: "p2", name: "Ava", coach: { ratings: { GK: null, DEF: 2, MID: 5, FWD: 4 }, note: "" } }
    ],
    fixtures: [
      { id: "f-today", dateISO: TODAY, us: 3, them: 1, plan: PLAN(), record: RECORD() },
      { id: "f-other", dateISO: OTHER, plan: PLAN(), record: RECORD() }
    ],
    sessions: []
  });
  const byId = (body, id) => body.fixtures.find((f) => f.id === id);

  function parentSession({ parentsSee = {}, memberships = [{ teamSlug: "a", role: "parent", playerId: "p1" }] } = {}) {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships });
    teamBySlug.mockReturnValue({ slug: "a" });
    isCoachForTeam.mockResolvedValue(false);
    const stored = fullDoc(parentsSee);
    getData.mockResolvedValue(stored);
    return stored;
  }

  async function get() {
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest());
    expect(res.status).toBe(200);
    return res.json();
  }

  it("with default switches: no rules, no coach fields, today's lineup only, no record", async () => {
    parentSession();
    const body = await get();
    expect(isCoachForTeam).toHaveBeenCalledWith("mum@a.com", "a");

    expect(body.team.name).toBe("A");
    expect("rules" in body.team).toBe(false);
    expect("coachPin" in body.team).toBe(false);
    expect(body.players).toEqual([{ id: "p1", name: "Sam" }, { id: "p2", name: "Ava" }]);

    const today = byId(body, "f-today");
    expect(today).toMatchObject({ us: 3, them: 1 });
    expect(today.plan.assignments).toEqual([{ GK: "p1", DEF1: "p2" }]);
    expect(today.plan.timer).toEqual({ startedAt: 1 });
    expect("overrides" in today.plan).toBe(false);
    expect("hintSeen" in today.plan).toBe(false);
    expect("record" in today).toBe(false);

    const other = byId(body, "f-other");
    expect("plan" in other).toBe(false);
    expect("record" in other).toBe(false);
  });

  it("with planBeforeKickoff: every plan comes through in full", async () => {
    parentSession({ parentsSee: { planBeforeKickoff: true } });
    const body = await get();
    expect(byId(body, "f-today").plan).toEqual(PLAN());
    expect(byId(body, "f-other").plan).toEqual(PLAN());
    expect("rules" in body.team).toBe(false);
  });

  it("with liveScore off: today's lineup still comes, but without the match clock", async () => {
    parentSession({ parentsSee: { liveScore: false } });
    const body = await get();
    const today = byId(body, "f-today");
    expect(today.plan.assignments).toEqual([{ GK: "p1", DEF1: "p2" }]);
    expect("timer" in today.plan).toBe(false);
    expect("overrides" in today.plan).toBe(false);
    expect(today).toMatchObject({ us: 3, them: 1 });
  });

  it("with liveScore off and planBeforeKickoff on: every plan comes through minus the clock", async () => {
    parentSession({ parentsSee: { liveScore: false, planBeforeKickoff: true } });
    const body = await get();
    const { timer, ...noClock } = PLAN();
    expect(byId(body, "f-today").plan).toEqual(noClock);
    expect(byId(body, "f-other").plan).toEqual(noClock);
  });

  it("with liveLineup off: no plan even on game day", async () => {
    parentSession({ parentsSee: { liveLineup: false } });
    const body = await get();
    expect("plan" in byId(body, "f-today")).toBe(false);
    expect("plan" in byId(body, "f-other")).toBe(false);
  });

  it("with ownChildMinutes: record is just the parent's own child's minutes", async () => {
    parentSession({ parentsSee: { ownChildMinutes: true } });
    const body = await get();
    expect(byId(body, "f-today").record).toEqual({ minutes: [{ pid: "p1", min: 30 }] });
    expect(byId(body, "f-other").record).toEqual({ minutes: [{ pid: "p1", min: 30 }] });
  });

  it("with ownChildMinutes: a parent of two gets both, another team's child is ignored", async () => {
    parentSession({
      parentsSee: { ownChildMinutes: true },
      memberships: [
        { teamSlug: "a", role: "parent", playerId: "p1" },
        { teamSlug: "a", role: "parent", playerId: "p2" },
        { teamSlug: "b", role: "parent", playerId: "p9" }
      ]
    });
    const { GET } = await loadRoute({ authOn: true });
    const res = await GET(fakeRequest({ cookies: { team_slug: "a" } }));
    const body = await res.json();
    expect(byId(body, "f-today").record).toEqual({ minutes: [{ pid: "p1", min: 30 }, { pid: "p2", min: 20 }] });
  });

  it("with everyoneMinutes: record is everyone's minutes and nothing else", async () => {
    parentSession({ parentsSee: { everyoneMinutes: true } });
    const body = await get();
    const rec = byId(body, "f-today").record;
    expect(rec).toEqual({ minutes: [{ pid: "p1", min: 30 }, { pid: "p2", min: 20 }] });
    for (const k of ["snapshot", "matchLog", "oppNote", "shapes", "theirShapes", "blocks", "scoreUs", "scoreThem", "savedBy"]) {
      expect(k in rec).toBe(false);
    }
  });

  it("a viewer (no child on the team) with ownChildMinutes sees an empty minutes list", async () => {
    parentSession({ parentsSee: { ownChildMinutes: true }, memberships: [{ teamSlug: "a", role: "viewer" }] });
    const body = await get();
    expect(byId(body, "f-today").record).toEqual({ minutes: [] });
    expect("rules" in body.team).toBe(false);
    expect("coach" in body.players[0]).toBe(false);
  });

  it("a parent receives their own child's guardian contacts and PIN, not another family's", async () => {
    parentSession();
    getData.mockResolvedValue({
      team: { name: "A" },
      players: [
        { id: "p1", name: "Sam", guardians: [{ name: "Mum", mobile: "0400 000 001", email: "mum@a.com" }], parentName: "Mum", parentContact: "0400 000 001", parentEmails: ["mum@a.com"], pin: "1111" },
        { id: "p2", name: "Ava", guardians: [{ name: "Dad", mobile: "0400 000 002", email: "dad@b.com" }], parentName: "Dad", parentContact: "0400 000 002", parentEmails: ["dad@b.com"], pin: "2222" }
      ],
      fixtures: []
    });
    const body = await get();
    expect(body.players[0]).toMatchObject({ id: "p1", parentEmails: ["mum@a.com"], pin: "1111" });
    expect(body.players[0].guardians[0].mobile).toBe("0400 000 001");
    expect(body.players[1]).toEqual({ id: "p2", name: "Ava" });
    expect(JSON.stringify(body)).not.toMatch(/dad@b\.com|0400 000 002|2222/);
  });

  it("never mutates the stored document while redacting", async () => {
    const stored = parentSession({ parentsSee: { ownChildMinutes: true } });
    const before = JSON.parse(JSON.stringify(stored));
    await get();
    expect(stored).toEqual(before);
  });

  it("the same document reaches a coach in full", async () => {
    parentSession({ parentsSee: { ownChildMinutes: true } });
    auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
    isCoachForTeam.mockResolvedValue(true);
    const body = await get();
    expect(body).toEqual(fullDoc({ ownChildMinutes: true }));
    expect(body.team.rules).toHaveLength(1);
    expect(body.players[0].coach.note).toBe("Left foot only");
    expect(byId(body, "f-other").plan).toEqual(PLAN());
    expect(byId(body, "f-today").record).toEqual(RECORD());
  });

  it("a super admin viewing as a parent is redacted exactly like that parent", async () => {
    parentSession({ parentsSee: { ownChildMinutes: true } });
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    isCoachForTeam.mockResolvedValue(false); // for mum, not for the boss
    const body = await get();
    expect(membershipsForEmail).toHaveBeenCalledWith("mum@a.com");
    expect(isCoachForTeam).toHaveBeenCalledWith("mum@a.com", "a");
    expect("rules" in body.team).toBe(false);
    expect("coach" in body.players[0]).toBe(false);
    expect(byId(body, "f-today").record).toEqual({ minutes: [{ pid: "p1", min: 30 }] });
    expect("plan" in byId(body, "f-other")).toBe(false);
    expect("overrides" in byId(body, "f-today").plan).toBe(false);
  });

  it("returns null (not a redacted shell) when the team has no document yet", async () => {
    parentSession();
    getData.mockResolvedValue(null);
    const body = await get();
    expect(body).toBeNull();
  });
});

describe("legacy team-code mode — no roles, so no redaction", () => {
  it("serves the full document, coach-only fields included, to any code holder", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const stored = {
      team: { name: "A", rules: [{ id: "bi-period", text: "x", builtin: true }] },
      players: [{ id: "p1", name: "Sam", coach: { ratings: { GK: 3 }, note: "n" } }],
      fixtures: [{ id: "f1", dateISO: "2030-01-01", plan: { overrides: { p1: true }, hintSeen: true }, record: { oppNote: "secret", minutes: [] } }]
    };
    getData.mockResolvedValue(stored);
    const { GET } = await loadRoute({ authOn: false });
    const res = await GET(fakeRequest({ headers: { cookie: "site_auth=team-code" } }));
    expect(await res.json()).toEqual(stored);
    expect(isCoachForTeam).not.toHaveBeenCalled();
  });
});
