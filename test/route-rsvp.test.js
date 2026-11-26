import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// The RSVP route is the narrow, parent-facing write path. In account mode its
// job is permission enforcement by the WORN hat (parent hat → the children on
// that hat only; coach hat → anyone; viewer hat → nothing); in legacy
// team-code mode anyone with the code may write and the whoami cookie
// attributes the entry. Both modes do a surgical single-entry merge. AUTH_ON
// is read at module load, so each block re-imports the route. lib/viewer is
// the real module — only its dependencies are mocked.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

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
const OTHER = { id: "p2", name: "Other", parentEmails: ["someone@else.com"] };
const TEAM_DATA = () => ({ fixtures: [{ id: "f1", availability: {} }], sessions: [{ id: "s1", availability: {} }], players: [PLAYER, OTHER] });

const COACH_M = { teamSlug: "a", teamName: "Team A", role: "coach" };
const PARENT_M = (playerId = "p1", playerName = "Sam") => ({ teamSlug: "a", teamName: "Team A", role: "parent", playerId, playerName });

// Membership rows carry the intent: a "coach" row for coach cases, a "parent"
// row (with the child's playerId) for parent cases.
function happyPath({ email = "mum@a.com", coach = false, memberships } = {}) {
  auth.mockResolvedValue({ user: { email } });
  membershipsForEmail.mockResolvedValue({ memberships: memberships || [coach ? COACH_M : PARENT_M()] });
  teamBySlug.mockReturnValue({ slug: "a", name: "Team A" });
  getData.mockResolvedValue(TEAM_DATA());
  setData.mockResolvedValue();
}

const rsvp = (playerId, extra = {}) => ({ body: { kind: "game", id: "f1", playerId, status: "in" }, ...extra });

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
    // Falls back to the only team ("a"), never resolving "other".
    expect(teamBySlug).toHaveBeenCalledWith("a");
    expect(teamBySlug).not.toHaveBeenCalledWith("other");
  });

  it("409s when the caller is on several teams and has not picked one", async () => {
    happyPath({ memberships: [PARENT_M(), { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p9", playerName: "Leo" }] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in" }, cookies: { team_slug: "other" } }));
    expect(res.status).toBe(409);
    expect(setData).not.toHaveBeenCalled();
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
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p2")));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("lets a coach set anyone and stamps the entry as Coach", async () => {
    happyPath({ email: "coach@a.com", coach: true });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p2", status: "out", reason: "injured" } }));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p2).toMatchObject({ status: "out", reason: "injured", by: "Coach" });
  });

  it("forbids a viewer (e.g. a parent demoted by an override) even for the child listed on the roster", async () => {
    happyPath({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "viewer" }] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p1"))); // PLAYER.parentEmails lists mum@a.com — irrelevant now
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("lets a parent of two kids set either of them", async () => {
    happyPath({ memberships: [PARENT_M("p1", "Sam"), PARENT_M("p2", "Other")] });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest(rsvp("p1")))).status).toBe(200);
    expect((await POST(fakeRequest(rsvp("p2")))).status).toBe(200);
    expect(setData.mock.calls[0][1].fixtures[0].availability.p1).toMatchObject({ by: "Sam" });
    expect(setData.mock.calls[1][1].fixtures[0].availability.p2).toMatchObject({ by: "Other" });
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

describe("account mode — a coach who is also a parent", () => {
  const BOTH = [COACH_M, PARENT_M("p1", "Sam")];

  it("acting as the parent (act_as cookie) writes their own child, labelled with the child's name", async () => {
    happyPath({ email: "both@a.com", memberships: BOTH });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p1", { cookies: { act_as: "parent" } })));
    expect(res.status).toBe(200);
    const [, saved] = setData.mock.calls[0];
    expect(saved.fixtures[0].availability.p1).toMatchObject({ status: "in", by: "Sam" });
  });

  it("acting as the parent cannot set someone else's child", async () => {
    happyPath({ email: "both@a.com", memberships: BOTH });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p2", { cookies: { act_as: "parent" } })));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("without act_as wears the coach hat: any player, labelled Coach", async () => {
    happyPath({ email: "both@a.com", memberships: BOTH });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest(rsvp("p2")))).status).toBe(200);
    expect(setData.mock.calls[0][1].fixtures[0].availability.p2).toMatchObject({ by: "Coach" });
    expect((await POST(fakeRequest(rsvp("p1")))).status).toBe(200);
    expect(setData.mock.calls[1][1].fixtures[0].availability.p1).toMatchObject({ by: "Coach" });
  });

  it("a forged act_as=coach on a plain parent does not widen anything", async () => {
    happyPath({ memberships: [PARENT_M()] });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest(rsvp("p2", { cookies: { act_as: "coach" } })))).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
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

describe("one reply per round on a two-team squad", () => {
  const paired = (over = {}) => ({
    ...TEAM_DATA(),
    fixtures: [
      { id: "f1", round: 3, side: "McKay", availability: { p2: { status: "out" } } },
      { id: "f2", round: 3, side: "McKain", availability: {} },
      { id: "f3", round: 4, side: "McKay", availability: {} }
    ],
    ...over
  });
  const post = async (body) => {
    viewingAs.mockReset(); // the "view as" block above leaves an impersonation behind
    const { POST } = await loadRoute({ authOn: true });
    return POST(fakeRequest({ body }));
  };
  it("a game reply is written to the fixture and its twin in the same save", async () => {
    happyPath();
    getData.mockResolvedValue(paired());
    expect((await post({ kind: "game", id: "f1", playerId: "p1", status: "out", reason: "Away" })).status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
    const [f1, f2, f3] = setData.mock.calls[0][1].fixtures;
    expect(f1.availability.p1).toMatchObject({ status: "out", reason: "Away", by: "Sam" });
    expect(f2.availability.p1).toEqual(f1.availability.p1);
    expect(f1.availability.p2).toEqual({ status: "out" }); // other players untouched
    expect(f2.availability.p2).toBeUndefined();
    expect(f3.availability).toEqual({});
  });
  it("replying on the other game mirrors back, and clearing clears both", async () => {
    happyPath();
    const d = paired();
    d.fixtures[0].availability.p1 = { status: "in" };
    d.fixtures[1].availability.p1 = { status: "in" };
    getData.mockResolvedValue(d);
    await post({ kind: "game", id: "f2", playerId: "p1", status: null });
    const [f1, f2] = setData.mock.calls[0][1].fixtures;
    expect("p1" in f1.availability).toBe(false);
    expect("p1" in f2.availability).toBe(false);
    expect(f1.availability.p2).toEqual({ status: "out" });
  });
  it("an unpaired fixture (a bye round on the other side) is written alone", async () => {
    happyPath();
    getData.mockResolvedValue(paired());
    await post({ kind: "game", id: "f3", playerId: "p1", status: "in" });
    const [f1, f2, f3] = setData.mock.calls[0][1].fixtures;
    expect(f3.availability.p1.status).toBe("in");
    expect(f1.availability.p1).toBeUndefined();
    expect(f2.availability.p1).toBeUndefined();
  });
  it("sessions are unchanged", async () => {
    happyPath();
    getData.mockResolvedValue(paired());
    await post({ kind: "session", id: "s1", occ: "2026-06-17", playerId: "p1", status: "in" });
    const saved = setData.mock.calls[0][1];
    expect(saved.sessions[0].availability["2026-06-17"].p1.status).toBe("in");
    expect(saved.fixtures).toEqual(paired().fixtures);
  });
});

// A player with their own email on their record signs in as themselves: the
// directory gives a "player" membership, which sits under the same family hat
// a parent wears, limited to their own record.
describe("account mode — a player signed in with their own email", () => {
  const PLAYER_M = (playerId = "p1", playerName = "Sam") => ({ teamSlug: "a", teamName: "Team A", role: "player", playerId, playerName });
  beforeEach(() => { viewingAs.mockReset(); }); // earlier blocks leave an impersonation behind
  afterEach(() => { viewingAs.mockReset(); });

  it("replies for themselves, stamped with their own name", async () => {
    happyPath({ email: "sam@example.com", memberships: [PLAYER_M()] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p1")));
    expect(res.status).toBe(200);
    expect(setData.mock.calls[0][1].fixtures[0].availability.p1).toMatchObject({ status: "in", by: "Sam" });
  });

  it("cannot reply for a team-mate", async () => {
    happyPath({ email: "sam@example.com", memberships: [PLAYER_M()] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p2")));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("replies for their child in the same team too, without switching role", async () => {
    happyPath({ email: "sam@example.com", memberships: [PLAYER_M("p1", "Sam"), PARENT_M("p2", "Other")] });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest(rsvp("p1")))).status).toBe(200);
    expect((await POST(fakeRequest(rsvp("p2")))).status).toBe(200);
    expect(setData.mock.calls[1][1].fixtures[0].availability.p2).toMatchObject({ by: "Other" });
  });

  it("a player who also coaches is limited to their own record once they act as the player", async () => {
    happyPath({ email: "sam@example.com", memberships: [COACH_M, PLAYER_M()] });
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest(rsvp("p2", { cookies: { act_as: "parent" } })))).status).toBe(403);
    expect((await POST(fakeRequest(rsvp("p1", { cookies: { act_as: "parent" } })))).status).toBe(200);
    expect(setData.mock.calls[0][1].fixtures[0].availability.p1).toMatchObject({ by: "Sam" });
    // As coach (the default hat) they reply for anyone.
    expect((await POST(fakeRequest(rsvp("p2")))).status).toBe(200);
    expect(setData.mock.calls[1][1].fixtures[0].availability.p2).toMatchObject({ by: "Coach" });
  });

  it("is read only while a super admin views as them", async () => {
    happyPath({ email: "admin@club.com", memberships: [PLAYER_M()] });
    viewingAs.mockReturnValue("sam@example.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest(rsvp("p1")));
    expect(res.status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});

// Rounds are numbered per draw: a reply on a paired season game is never
// copied onto another competition's game that happens to share the round
// number, and a competition's own pair still shares its replies.
describe("one reply per round — never across competitions", () => {
  const WINTER = { comp: "cwinter", compName: "Winterfest" };
  const doc = () => ({
    ...TEAM_DATA(),
    fixtures: [
      { id: "s3a", round: 3, side: "McKay", availability: {} },
      { id: "s3b", round: 3, side: "McKain", availability: {} },
      { id: "w3", round: 3, side: "McKain", ...WINTER, availability: {} },   // Winterfest's round 3, one side
      { id: "w4a", round: 4, side: "McKay", ...WINTER, availability: {} },
      { id: "w4b", round: 4, side: "McKain", ...WINTER, availability: {} },
      { id: "s4", round: 4, side: "McKay", availability: {} }                // the season's round 4, other side on a bye
    ]
  });
  const post = async (body) => {
    viewingAs.mockReset();
    const { POST } = await loadRoute({ authOn: true });
    return POST(fakeRequest({ body }));
  };
  const replied = () => setData.mock.calls[0][1].fixtures.filter((f) => f.availability.p1).map((f) => f.id);

  it("a season reply covers the season's two games and nothing of Winterfest's", async () => {
    happyPath();
    getData.mockResolvedValue(doc());
    expect((await post({ kind: "game", id: "s3a", playerId: "p1", status: "in" })).status).toBe(200);
    expect(replied()).toEqual(["s3a", "s3b"]);
  });

  it("a reply on a competition game with no pair of its own is written to that game alone", async () => {
    happyPath();
    getData.mockResolvedValue(doc());
    await post({ kind: "game", id: "w3", playerId: "p1", status: "out", reason: "Away" });
    expect(replied()).toEqual(["w3"]);
  });

  it("a competition's own pair shares the reply, and the season game of that round number is left alone", async () => {
    happyPath();
    getData.mockResolvedValue(doc());
    await post({ kind: "game", id: "w4b", playerId: "p1", status: "in" });
    expect(replied()).toEqual(["w4a", "w4b"]);
    setData.mockClear();
    await post({ kind: "game", id: "s4", playerId: "p1", status: "in" });
    expect(replied()).toEqual(["s4"]);
  });
});

// The combined family view on My teams replies for children in several teams
// from one page, so each reply names its team. A named team is always
// answered as the family there, and can never reach further than that.
describe("account mode — a reply that names its team", () => {
  const A_COACH = { teamSlug: "a", teamName: "Team A", role: "coach" };
  const A_KID = { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" };
  const B_KID = { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p2", playerName: "Other" };
  const C_COACH = { teamSlug: "c", teamName: "Team C", role: "coach" };
  const docs = () => ({ a: TEAM_DATA(), b: TEAM_DATA(), c: TEAM_DATA() });
  const signIn = (memberships) => {
    auth.mockResolvedValue({ user: { email: "sam@example.com" } });
    membershipsForEmail.mockResolvedValue({ memberships });
    teamBySlug.mockImplementation((slug) => ({ slug, name: "Team " + slug.toUpperCase() }));
    const stored = docs();
    getData.mockImplementation(async (slug) => stored[slug] ?? null);
    setData.mockResolvedValue();
  };
  const named = (teamSlug, playerId, extra = {}) => fakeRequest({ body: { kind: "game", id: "f1", playerId, status: "in", teamSlug }, ...extra });
  beforeEach(() => { viewingAs.mockReset(); });
  afterEach(() => { teamBySlug.mockReset(); getData.mockReset(); });

  it("goes to the named team, whichever team the session has open", async () => {
    signIn([A_KID, B_KID]);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(named("b", "p2", { cookies: { team_slug: "a" } }));
    expect(res.status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData.mock.calls[0][0]).toBe("b");
    expect(setData.mock.calls[0][1].fixtures[0].availability.p2).toMatchObject({ status: "in", by: "Other" });
    // Without a cookie a login on two teams cannot reply at all unless it names one.
    expect((await POST(fakeRequest(rsvp("p1")))).status).toBe(409);
    expect((await POST(named("a", "p1"))).status).toBe(200);
  });

  it("only for a player the family has on that team", async () => {
    signIn([A_KID, B_KID]);
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(named("b", "p1"))).status).toBe(403); // p1 is theirs on Team A, not on Team B
    expect((await POST(named("a", "p2"))).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });

  it("a team the login is not on is refused, and nothing is read from it", async () => {
    signIn([A_KID]);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(named("b", "p1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getData).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("is answered as the family even by a coach: their own child, never the whole squad", async () => {
    signIn([A_COACH, A_KID, C_COACH]);
    const { POST } = await loadRoute({ authOn: true });
    // The coach hat could set anyone; a reply that names its team cannot.
    expect((await POST(named("a", "p2", { cookies: { team_slug: "a", act_as: "coach" } }))).status).toBe(403);
    expect((await POST(named("a", "p1", { cookies: { team_slug: "a", act_as: "coach" } }))).status).toBe(200);
    expect(setData.mock.calls[0][1].fixtures[0].availability.p1).toMatchObject({ by: "Sam" }); // not "Coach"
    // A team they only coach has no family to answer for.
    expect((await POST(named("c", "p1"))).status).toBe(403);
    // The ordinary route is untouched: as coach, on the open team, anyone.
    expect((await POST(fakeRequest(rsvp("p2", { cookies: { team_slug: "a" } })))).status).toBe(200);
    expect(setData.mock.calls[1][1].fixtures[0].availability.p2).toMatchObject({ by: "Coach" });
  });

  it("a team name that is not text is a bad request", async () => {
    signIn([A_KID]);
    const { POST } = await loadRoute({ authOn: true });
    for (const teamSlug of ["", 5, null, ["a"], {}]) {
      const res = await POST(fakeRequest({ body: { kind: "game", id: "f1", playerId: "p1", status: "in", teamSlug } }));
      expect(res.status, JSON.stringify(teamSlug)).toBe(400);
    }
    expect(setData).not.toHaveBeenCalled();
  });

  it("is refused while a super admin views as the family", async () => {
    signIn([A_KID, B_KID]);
    viewingAs.mockReturnValue("sam@example.com");
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(named("b", "p2"))).status).toBe(403);
    expect(setData).not.toHaveBeenCalled();
  });
});
