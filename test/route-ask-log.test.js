import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/ask-log: a quick answer worked out on the phone is kept with who asked
// (POST), and the super admin reads every team's questions (GET). The session,
// the directory, the store and the team list are stand-ins; lib/askLog and
// lib/viewer are real. Every name and address is made up.
const { auth, isAdminEmail, clubPeople, membershipsForEmail, viewingAs, getAskLog, addAskLog, getTeams, teamFromCookieHeader, teamBySlug } = vi.hoisted(() => ({
  auth: vi.fn(), isAdminEmail: vi.fn(), clubPeople: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn(),
  getAskLog: vi.fn(), addAskLog: vi.fn(), getTeams: vi.fn(), teamFromCookieHeader: vi.fn(), teamBySlug: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, clubPeople, membershipsForEmail, viewingAs }));
vi.mock("@/lib/store", () => ({ getAskLog, addAskLog }));
vi.mock("@/lib/teams", () => ({ getTeams, teamFromCookieHeader, teamBySlug }));

const TEAMS = [{ slug: "u10", name: "Under 10s" }, { slug: "u9", name: "Under 9s" }];
const LOGS = {
  u10: [
    { at: "2026-11-28T03:00:00.000Z", q: "When is training?", a: "Tuesdays.", how: "assistant", who: { email: "jane@example.com", label: "Parent of Sam" } },
    { at: "2026-11-28T01:00:00.000Z", q: "Next game?", how: "quick", who: { label: "Someone with the team code" } }
  ],
  u9: [{ at: "2026-11-28T02:00:00.000Z", q: "Who brings fruit?", how: "failed", who: { email: "kim@example.com", label: "Head coach" } }]
};

const KEYS = ["AUTH_SECRET"];
let saved;
beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.AUTH_SECRET = "test-secret";
  auth.mockResolvedValue({ user: { email: "owner@example.com" } });
  isAdminEmail.mockImplementation((e) => e === "owner@example.com");
  viewingAs.mockReturnValue(null);
  getTeams.mockResolvedValue(TEAMS);
  getAskLog.mockImplementation(async (slug) => LOGS[slug] || []);
  addAskLog.mockResolvedValue(undefined);
  clubPeople.mockResolvedValue({ teams: TEAMS, people: [{ email: "jane@example.com", name: "Jane Lee" }, { email: "kim@example.com", name: "" }] });
  membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "u10", teamName: "Under 10s", role: "parent", playerId: "p1", playerName: "Sam Lee" }] });
  teamBySlug.mockResolvedValue({ slug: "u10", name: "Under 10s" });
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

async function route() {
  vi.resetModules();
  return import("@/app/api/ask-log/route");
}
const post = async (body) => (await route()).POST(fakeRequest({ url: "http://localhost/api/ask-log", body }));
const get = async (query = "") => (await route()).GET(fakeRequest({ url: `http://localhost/api/ask-log${query}` }));

describe("POST /api/ask-log: a quick answer, kept with who asked", () => {
  it("keeps the question for the team asked from, with the signed-in person, and never an answer", async () => {
    auth.mockResolvedValue({ user: { email: "jane@example.com" } });
    const res = await post({ question: " When and where is our next game? ", answer: "Somewhere made up" });
    expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    const [slug, entry, max] = addAskLog.mock.calls[0];
    expect([slug, max]).toEqual(["u10", 500]);
    expect(entry).toEqual({ at: expect.any(String), q: "When and where is our next game?", how: "quick", who: { email: "jane@example.com", label: "Parent of Sam" } });
  });

  it("in team-code mode, keeps it for the code's team with no one to name", async () => {
    delete process.env.AUTH_SECRET;
    teamFromCookieHeader.mockReturnValue({ slug: "u9", name: "Under 9s" });
    await post({ question: "Next game?" });
    expect(addAskLog.mock.calls[0].slice(0, 2)).toEqual(["u9", expect.objectContaining({ who: { label: "Someone with the team code" } })]);
  });

  it("keeps nothing without a question or a team, and says when it couldn't be kept", async () => {
    expect((await post({ question: "  " })).status).toBe(400);
    expect((await (await route()).POST(fakeRequest({ url: "http://localhost/api/ask-log" }))).status).toBe(400);
    auth.mockResolvedValue(null);
    expect((await post({ question: "Next game?" })).status).toBe(401);
    expect(addAskLog).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { email: "jane@example.com" } });
    addAskLog.mockRejectedValueOnce(new Error("store down"));
    expect((await post({ question: "Next game?" })).status).toBe(503);
  });
});

describe("GET /api/ask-log: the super admin's Questions section", () => {
  it("gives every team's questions, newest first, with the team and the club's name for whoever asked", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.teams).toEqual(TEAMS);
    expect(j.questions.map((q) => [q.q, q.teamName, q.name || ""])).toEqual([
      ["When is training?", "Under 10s", "Jane Lee"],
      ["Who brings fruit?", "Under 9s", ""],
      ["Next game?", "Under 10s", ""]
    ]);
    expect(j.questions[0]).toMatchObject({ team: "u10", a: "Tuesdays.", how: "assistant", who: { email: "jane@example.com", label: "Parent of Sam" } });
  });

  it("gives one team's questions when asked, and refuses a team there isn't", async () => {
    const j = await (await get("?team=u9")).json();
    expect(j.questions.map((q) => q.q)).toEqual(["Who brings fruit?"]);
    expect(getAskLog.mock.calls.map((c) => c[0])).toEqual(["u9"]);
    expect((await get("?team=nobody")).status).toBe(404);
  });

  it("doesn't look anyone up when nobody signed in asked", async () => {
    getAskLog.mockImplementation(async (slug) => (slug === "u10" ? [LOGS.u10[1]] : []));
    const j = await (await get()).json();
    expect(j.questions.map((q) => q.q)).toEqual(["Next game?"]);
    expect(clubPeople).not.toHaveBeenCalled();
  });

  it("is the super admin's alone: not a coach, a parent or a club admin, nor anyone signed out or in team-code mode", async () => {
    for (const email of ["jane@example.com", "kim@example.com", "club@example.com"]) {
      auth.mockResolvedValue({ user: { email } });
      expect((await get()).status).toBe(403);
    }
    auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    delete process.env.AUTH_SECRET;
    expect((await get()).status).toBe(400);
    expect(getAskLog).not.toHaveBeenCalled();
  });
});
