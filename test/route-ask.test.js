import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/ask builds a prompt from team docs + a live game summary and calls the
// Anthropic API. We mock the team resolution, the store and global fetch so we
// can assert the gate behaviour and inspect exactly what prompt gets sent
// (model selection, system prompt, doc budget, game summary, question slice).
// Account mode goes through the real lib/viewer, so its dependencies (auth,
// directory) are mocked too; the default is legacy team-code mode.
const { teamFromCookieHeader, teamBySlug, getData, addAskLog, auth, membershipsForEmail, viewingAs } = vi.hoisted(() => ({
  teamFromCookieHeader: vi.fn(), teamBySlug: vi.fn(), getData: vi.fn(), addAskLog: vi.fn(),
  auth: vi.fn(), membershipsForEmail: vi.fn(), viewingAs: vi.fn()
}));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader, teamBySlug }));
vi.mock("@/lib/store", () => ({ getData, addAskLog }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, viewingAs }));

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/ask/route");
}

function anthropicOk(text = "Here is your answer.") {
  return { ok: true, status: 200, text: async () => "", json: async () => ({ content: [{ type: "text", text }] }) };
}
// Parse the body of the (single) Anthropic messages call.
const sentBody = () => JSON.parse(fetch.mock.calls[0][1].body);

const KEYS = ["AUTH_SECRET", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"];
let saved;
beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.ANTHROPIC_MODEL = "claude-test-model"; // skip model discovery
  teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A" });
  getData.mockResolvedValue({ team: { name: "Team A", ageGroup: "U8", division: "Div 1" }, fixtures: [], sessions: [], players: [] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk()));
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

const ask = async (body) => (await loadRoute()).POST(fakeRequest({ body }));

describe("POST /api/ask — gates", () => {
  it("401s when no team resolves", async () => {
    teamFromCookieHeader.mockReturnValue(null);
    expect((await ask({ question: "hi" })).status).toBe(401);
  });

  it("503s when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await ask({ question: "hi" })).status).toBe(503);
  });

  it("400s on malformed JSON", async () => {
    const { POST } = await loadRoute();
    expect((await POST(fakeRequest({}))).status).toBe(400);
  });

  it("400s on an empty question", async () => {
    expect((await ask({ question: "   " })).status).toBe(400);
  });

  it("409s when the team has no data", async () => {
    getData.mockResolvedValue(null);
    expect((await ask({ question: "hi" })).status).toBe(409);
  });
});

describe("POST /api/ask — account mode", () => {
  beforeEach(() => { process.env.AUTH_SECRET = "test-secret"; });

  it("lets a parent hat ask (any hat may read)", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }] });
    teamBySlug.mockResolvedValue({ slug: "a", name: "Team A" });
    const res = await ask({ question: "When is training?" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Here is your answer." });
    expect(teamFromCookieHeader).not.toHaveBeenCalled();
    expect(getData).toHaveBeenCalledWith("a");
  });

  it("401s when signed out or with no memberships", async () => {
    auth.mockResolvedValue(null);
    expect((await ask({ question: "hi" })).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "x@y.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    expect((await ask({ question: "hi" })).status).toBe(401);
  });

  it("409s (pick a team) for a member of several teams with no team chosen", async () => {
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p2", playerName: "Leo" }
    ] });
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/pick a team/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask — prompt construction", () => {
  it("returns the assistant answer and calls the model from ANTHROPIC_MODEL", async () => {
    const res = await ask({ question: "What size ball?" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Here is your answer." });
    const body = sentBody();
    expect(fetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe("claude-test-model");
    expect(body.system).toContain("Team A");
    const userContent = body.messages.at(-1).content;
    expect(userContent).toContain("QUESTION: What size ball?");
  });

  it("includes a live game summary built from fixtures/sessions/squad", async () => {
    getData.mockResolvedValue({
      team: { name: "Team A", ageGroup: "U8", division: "Div 1" },
      fixtures: [{ round: 3, opponent: "Wests", homeAway: "H", dateISO: "2026-06-20", time: "09:00", venue: "Perry Park", us: 2, them: 1 }],
      sessions: [{ title: "Training", recur: "weekly", time: "17:00" }],
      players: [{ id: "p1" }, { id: "p2" }]
    });
    const userContent = (await ask({ question: "how did we go?" }).then(sentBodyContent));
    expect(userContent).toContain("LIVE TEAM DATA:\nToday is ");
    expect(userContent).toContain("| Season, round 3 | home vs Wests | ground: Perry Park | won 2–1");
    expect(userContent).toContain("- Training: weekly 17:00");
    expect(userContent).toContain("Squad: 2 players.");
  });

  it("dates the data in Brisbane: just after 2pm UTC is already tomorrow there", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T14:30:00Z"));
    try {
      const userContent = await ask({ question: "next game?" }).then(sentBodyContent);
      expect(userContent).toContain("Today is Saturday 28 November 2026 (Brisbane).");
    } finally { vi.useRealTimers(); }
  });

  it("builds nothing about a program in: no team is told it plays MiniRoos, and the rules are the coach's documents alone", async () => {
    let body = await ask({ question: "rules?" }).then(() => sentBody());
    expect(body.system).toContain("THIS TEAM IS: U8 Div 1. ");
    expect(body.system).toContain("default to this team's (U8)");
    expect(body.system).not.toMatch(/MiniRoos|pathway|does not publish match results/);
    // With no documents loaded there are none: no built-in reference is added.
    expect(body.messages.at(-1).content).toContain("TEAM DOCUMENTS:\n(none provided)\n\n");
    expect(body.messages.at(-1).content).not.toMatch(/MiniRoos|Built-in reference/);
    fetch.mockClear();
    getData.mockResolvedValue({ team: { name: "Team A", ageGroup: "U10", division: "" }, fixtures: [], sessions: [], players: [], knowledge: [{ name: "Academy rules", text: "Games are 2 x 25 minutes." }] });
    body = await ask({ question: "rules?" }).then(() => sentBody());
    expect(body.system).toContain("THIS TEAM IS: U10. ");
    expect(body.system).toContain("default to this team's (U10)");
    expect(body.messages.at(-1).content).toContain("TEAM DOCUMENTS:\n### Document: Academy rules\nGames are 2 x 25 minutes.\n\n");
    fetch.mockClear();
    getData.mockResolvedValue({ team: { name: "Team A" }, fixtures: [], sessions: [], players: [] });
    body = await ask({ question: "rules?" }).then(() => sentBody());
    expect(body.system).toContain("THIS TEAM IS: a junior team. ");
    expect(body.system).toContain("default to this team's (its age group)");
  });

  it("gives a coming game in a competition with a format of its own that format, from the club's set-up", async () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    teamFromCookieHeader.mockReturnValue({ slug: "a", name: "Team A", competitions: [{ id: "cfives", name: "Summer Fives", format: { playersOnField: 5, hasGK: true, periods: 2, gameLength: 30 } }] });
    getData.mockResolvedValue({ team: { name: "Team A", ageGroup: "U10" }, sessions: [], players: [], fixtures: [
      { id: "f1", dateISO: soon, time: "17:10", opponent: "Valley Vipers", venue: "Riverside Park – Field 1", homeAway: "H", status: "upcoming", comp: "cfives", compName: "Summer Fives", round: null, roundName: "Semi Finals" },
      { id: "f2", dateISO: soon, time: "09:00", opponent: "Wests", venue: "Wests Oval", homeAway: "A", status: "upcoming", round: 9 }
    ] });
    const body = await ask({ question: "how long is the semi?" }).then(() => sentBody());
    const lines = body.messages.at(-1).content.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.find((l) => l.includes("Valley Vipers"))).toContain("Summer Fives · Semi Finals");
    expect(lines.find((l) => l.includes("Valley Vipers"))).toContain("| format: 5 a side with a keeper, 2 halves of 15 minutes");
    // A season game plays the team's own format, so it says none.
    expect(lines.find((l) => l.includes("Wests"))).not.toContain("format:");
    expect(body.system).toContain("A coming game in a competition with a format of its own lists it");
  });

  it("truncates uploaded docs to the character budget, dropping overflow", async () => {
    getData.mockResolvedValue({
      team: { name: "Team A", ageGroup: "U8", division: "" },
      fixtures: [], sessions: [], players: [],
      knowledge: [
        { name: "big", text: "x".repeat(120001) }, // exhausts the 120k budget
        { name: "dropped", text: "should not appear" }
      ]
    });
    const userContent = await ask({ question: "rules?" }).then(sentBodyContent);
    expect(userContent).toContain("### Document: big");
    expect(userContent).not.toContain("### Document: dropped");
  });

  it("caps the question at 1000 characters", async () => {
    const userContent = await ask({ question: "Q".repeat(2000) }).then(sentBodyContent);
    const sent = userContent.split("QUESTION: ")[1];
    expect(sent).toHaveLength(1000);
  });

  it("maps recent chat history into Anthropic roles", async () => {
    await ask({ question: "next?", history: [{ role: "you", text: "hello" }, { role: "assistant", text: "hi there" }] });
    const msgs = sentBody().messages;
    expect(msgs[0]).toEqual({ role: "user", content: "hello" });
    expect(msgs[1]).toEqual({ role: "assistant", content: "hi there" });
  });
});

describe("POST /api/ask — upstream failures", () => {
  it("502s when Anthropic responds with an error", async () => {
    fetch.mockResolvedValue({ ok: false, status: 529, text: async () => "overloaded" });
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("529");
  });

  it("502s when the request throws", async () => {
    fetch.mockRejectedValue(new Error("network down"));
    const res = await ask({ question: "hi" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Could not reach/);
  });
});

// Helper: resolve a POST response's sent user content (last message content).
function sentBodyContent() {
  return JSON.parse(fetch.mock.calls[0][1].body).messages.at(-1).content;
}

// Every question answered is kept with who asked it (lib/askLog.js), for the
// super admin's Questions section, and keeping it never fails an answer.
describe("POST /api/ask — the question kept with who asked", () => {
  const kept = () => addAskLog.mock.calls.map(([slug, entry, max]) => [slug, { ...entry, at: typeof entry.at }, max]);

  it("keeps the question, the answer and who asked, in team-code mode with no one to name", async () => {
    fetch.mockResolvedValue(anthropicOk("Training is Tuesdays at 5:30."));
    expect((await ask({ question: " When is  training? " })).status).toBe(200);
    expect(kept()).toEqual([["a", { at: "string", q: "When is training?", a: "Training is Tuesdays at 5:30.", how: "assistant", who: { label: "Someone with the team code" } }, 500]]);
  });

  it("names the signed-in person and what they are on the team", async () => {
    process.env.AUTH_SECRET = "test-secret";
    auth.mockResolvedValue({ user: { email: "mum@a.com" } });
    membershipsForEmail.mockResolvedValue({ memberships: [{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam Smith" }] });
    teamBySlug.mockResolvedValue({ slug: "a", name: "Team A" });
    await ask({ question: "When is training?" });
    expect(addAskLog.mock.calls[0][1].who).toEqual({ email: "mum@a.com", label: "Parent of Sam" });
  });

  it("keeps a question the assistant couldn't answer, without an answer", async () => {
    fetch.mockResolvedValue({ ok: false, status: 529, text: async () => "overloaded" });
    await ask({ question: "Who brings fruit?" });
    fetch.mockRejectedValue(new Error("network down"));
    await ask({ question: "And oranges?" });
    expect(kept().map(([, e]) => [e.q, e.how, "a" in e])).toEqual([["Who brings fruit?", "failed", false], ["And oranges?", "failed", false]]);
  });

  it("still answers when the question can't be kept", async () => {
    addAskLog.mockRejectedValueOnce(new Error("store down"));
    const res = await ask({ question: "When is training?" });
    expect([res.status, (await res.json()).answer]).toEqual([200, "Here is your answer."]);
  });

  it("keeps nothing for a request that is refused before it is asked", async () => {
    await ask({ question: "   " });
    teamFromCookieHeader.mockReturnValue(null);
    await ask({ question: "hi" });
    expect(addAskLog).not.toHaveBeenCalled();
  });
});
