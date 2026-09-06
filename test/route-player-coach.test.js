import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/player-coach writes ONE player's coach-only block (ratings + private
// note) and nothing else. Coach-gated in account mode; any code holder in
// legacy mode. AUTH_ON is module-load state, so each block re-imports the
// route. The sanitiser (lib/teamSetup.sanitizeCoachFields) is the real one.
const { auth, getData, setData, teamBySlug, teamFromCookieHeader, membershipsForEmail, isCoachForTeam, viewingAs } = vi.hoisted(() => ({
  auth: vi.fn(), getData: vi.fn(), setData: vi.fn(),
  teamBySlug: vi.fn(), teamFromCookieHeader: vi.fn(),
  membershipsForEmail: vi.fn(), isCoachForTeam: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getData, setData }));
vi.mock("@/lib/teams", () => ({ teamBySlug, teamFromCookieHeader }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isCoachForTeam, viewingAs }));

const RATINGS = { GK: 1, DEF: 4, MID: 3, FWD: 2 };
const EXISTING = { ratings: { GK: 0, DEF: 5, MID: 2, FWD: null }, note: "Left footed, likes the wing" };
const DATA = () => ({
  team: { name: "A", parentsSee: { liveScore: false } },
  players: [
    { id: "p1", name: "Sam", number: 7, coach: EXISTING },
    { id: "p2", name: "Ava", number: 9 },
    { id: "p3", name: "Leo", coach: { ratings: { GK: 5, DEF: 1, MID: 1, FWD: 1 }, note: "Keeper" } }
  ],
  fixtures: [
    { id: "f1", round: 1, us: 3, them: 1, availability: { p1: { status: "in" } }, plan: { subTimes: [10], assignments: [{ GK: "p3" }], updatedAt: 1 } },
    { id: "f2", round: 2 }
  ],
  sessions: [{ id: "s1", kind: "training" }]
});

let savedSecret;
beforeEach(() => {
  // Reset implementations, not just call history: the view-as test sets a
  // return value on viewingAs that must not leak into the tests after it.
  vi.resetAllMocks();
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
  return import("@/app/api/player-coach/route");
}

function coachSession() {
  auth.mockResolvedValue({ user: { email: "coach@a.com" } });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }] });
  teamBySlug.mockReturnValue({ slug: "a" });
  isCoachForTeam.mockResolvedValue(true);
}

describe("POST /api/player-coach — validation", () => {
  it("400s on malformed JSON", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad json" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("400s when playerId is missing or neither ratings nor note is provided", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const noId = await POST(fakeRequest({ body: { ratings: RATINGS } }));
    expect(noId.status).toBe(400);
    expect(await noId.json()).toEqual({ error: "bad request" });
    const noPatch = await POST(fakeRequest({ body: { playerId: "p1" } }));
    expect(noPatch.status).toBe(400);
    expect(await noPatch.json()).toEqual({ error: "bad request" });
    expect((await POST(fakeRequest({ body: null }))).status).toBe(400);
    expect(setData).not.toHaveBeenCalled();
    // Validation happens before any lookup, so nothing was read either.
    expect(getData).not.toHaveBeenCalled();
  });

  it("404s when the team has no data yet", async () => {
    coachSession();
    getData.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no data" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("404s for an unknown player", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "ghost", ratings: RATINGS } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no such player" });
    expect(setData).not.toHaveBeenCalled();
  });
});

describe("POST /api/player-coach — account mode", () => {
  it("401s when not signed in", async () => {
    auth.mockResolvedValue(null);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("401s a signed-in user with no memberships", async () => {
    auth.mockResolvedValue({ user: { email: "stranger@x.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a parent (non-coach)", async () => {
    coachSession();
    isCoachForTeam.mockResolvedValue(false);
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(setData).not.toHaveBeenCalled();
  });

  it("403s a write while a super admin is viewing as someone else", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    viewingAs.mockReturnValue("mum@a.com");
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You're viewing as another user — read only. Exit view-as to make changes." });
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it("honours the team_slug cookie when the coach has several memberships", async () => {
    coachSession();
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", role: "coach" }, { teamSlug: "b", role: "coach" }] });
    teamBySlug.mockImplementation(async (slug) => ({ slug }));
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS }, cookies: { team_slug: "b" } }));
    expect(res.status).toBe(200);
    expect(teamBySlug).toHaveBeenCalledWith("b");
    expect(isCoachForTeam).toHaveBeenCalledWith("coach@a.com", "b");
    expect(setData.mock.calls[0][0]).toBe("b");
  });

  it("writes only the target player's coach block, preserving everything else", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS, note: "  Quick feet  " } }));
    expect(res.status).toBe(200);
    expect(setData).toHaveBeenCalledTimes(1);
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    const original = DATA();
    const p1 = saved.players.find((p) => p.id === "p1");
    expect(p1.coach).toEqual({ ratings: RATINGS, note: "Quick feet" });
    // Everything else on the same player is untouched.
    expect(p1).toMatchObject({ id: "p1", name: "Sam", number: 7 });
    // Other players, fixtures (incl. plan and RSVPs), team and sessions are
    // deep-equal to the loaded document.
    expect(saved.players.filter((p) => p.id !== "p1")).toEqual(original.players.filter((p) => p.id !== "p1"));
    expect(saved.fixtures).toEqual(original.fixtures);
    expect(saved.team).toEqual(original.team);
    expect(saved.sessions).toEqual(original.sessions);
    expect(Object.keys(saved).sort()).toEqual(Object.keys(original).sort());
  });

  it("responds with ok, the playerId and the saved coach object", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p2", ratings: { GK: 2.6, DEF: 9, MID: -3, FWD: "x" }, note: " Keen " } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const savedCoach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(json).toEqual({ ok: true, playerId: "p2", coach: savedCoach });
    expect(json.coach).toEqual({ ratings: { GK: 3, DEF: 5, MID: 0, FWD: null }, note: "Keen" });
  });
});

describe("POST /api/player-coach — sanitising via the real guard", () => {
  it("rounds, clamps and nulls ratings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: {
      playerId: "p2",
      ratings: { GK: 4.4, DEF: 4.5, MID: 7, FWD: -1, BOGUS: 3 }
    } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach.ratings).toEqual({ GK: 4, DEF: 5, MID: 5, FWD: 0 });
    // Unknown keys never reach storage.
    expect(coach.ratings).not.toHaveProperty("BOGUS");
  });

  it("stores null for missing, non-numeric, NaN and null ratings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: {
      playerId: "p2",
      ratings: { GK: null, DEF: "3", MID: NaN, FWD: undefined }
    } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach.ratings).toEqual({ GK: null, DEF: null, MID: null, FWD: null });
  });

  it("tolerates a non-object ratings value by nulling every rating", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p2", ratings: "junk" } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach).toEqual({ ratings: { GK: null, DEF: null, MID: null, FWD: null }, note: "" });
  });

  it("trims the note and truncates it at 400 characters", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const long = "  " + "x".repeat(450) + "  ";
    const res = await POST(fakeRequest({ body: { playerId: "p2", note: long } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach.note).toBe("x".repeat(400));
    expect(coach.note).toHaveLength(400);
  });

  it("stores an empty string for a null or non-string note", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    expect((await POST(fakeRequest({ body: { playerId: "p1", note: null } }))).status).toBe(200);
    expect(setData.mock.calls[0][1].players.find((p) => p.id === "p1").coach.note).toBe("");
    // A numeric note is stringified rather than rejected (the guard's contract).
    expect((await POST(fakeRequest({ body: { playerId: "p1", note: 42 } }))).status).toBe(200);
    expect(setData.mock.calls[1][1].players.find((p) => p.id === "p1").coach.note).toBe("42");
  });
});

describe("POST /api/player-coach — partial patches", () => {
  it("a ratings-only patch keeps the existing note", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p1").coach;
    expect(coach).toEqual({ ratings: RATINGS, note: EXISTING.note });
    expect(await res.json()).toEqual({ ok: true, playerId: "p1", coach });
  });

  it("a note-only patch keeps the existing ratings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", note: "Growing in confidence" } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p1").coach;
    expect(coach).toEqual({ ratings: EXISTING.ratings, note: "Growing in confidence" });
  });

  it("a note-only patch on a player with no coach block yet gets null ratings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p2", note: "New this season" } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach).toEqual({ ratings: { GK: null, DEF: null, MID: null, FWD: null }, note: "New this season" });
  });

  it("a ratings-only patch on a player with no coach block yet gets an empty note", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p2", ratings: RATINGS } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p2").coach;
    expect(coach).toEqual({ ratings: RATINGS, note: "" });
  });

  it("an explicit empty note clears the existing note but keeps ratings", async () => {
    coachSession();
    const { POST } = await loadRoute({ authOn: true });
    const res = await POST(fakeRequest({ body: { playerId: "p1", note: "" } }));
    expect(res.status).toBe(200);
    const coach = setData.mock.calls[0][1].players.find((p) => p.id === "p1").coach;
    expect(coach).toEqual({ ratings: EXISTING.ratings, note: "" });
  });
});

describe("POST /api/player-coach — legacy team-code mode", () => {
  it("lets a code holder save coach fields without any session", async () => {
    teamFromCookieHeader.mockReturnValue({ slug: "a" });
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS, note: "Solid" }, headers: { cookie: "site_auth=code" } }));
    expect(res.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
    expect(membershipsForEmail).not.toHaveBeenCalled();
    expect(isCoachForTeam).not.toHaveBeenCalled();
    expect(teamFromCookieHeader).toHaveBeenCalledWith("site_auth=code");
    const [slug, saved] = setData.mock.calls[0];
    expect(slug).toBe("a");
    expect(saved.players.find((p) => p.id === "p1").coach).toEqual({ ratings: RATINGS, note: "Solid" });
    // The rest of the document is untouched here too.
    const original = DATA();
    expect(saved.fixtures).toEqual(original.fixtures);
    expect(saved.players.filter((p) => p.id !== "p1")).toEqual(original.players.filter((p) => p.id !== "p1"));
    expect(await res.json()).toEqual({ ok: true, playerId: "p1", coach: { ratings: RATINGS, note: "Solid" } });
  });

  it("401s without a valid team-code cookie", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    const { POST } = await loadRoute({ authOn: false });
    const res = await POST(fakeRequest({ body: { playerId: "p1", ratings: RATINGS } }));
    expect(res.status).toBe(401);
    expect(setData).not.toHaveBeenCalled();
  });
});
