import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/ask builds a prompt from team docs + a live game summary and calls the
// Anthropic API. We mock the team resolution, the store and global fetch so we
// can assert the gate behaviour and inspect exactly what prompt gets sent
// (model selection, system prompt, doc budget, game summary, question slice).
const { teamFromCookieHeader, teamBySlug, getData } = vi.hoisted(() => ({
  teamFromCookieHeader: vi.fn(), teamBySlug: vi.fn(), getData: vi.fn()
}));
vi.mock("@/lib/teams", () => ({ teamFromCookieHeader, teamBySlug }));
vi.mock("@/lib/store", () => ({ getData }));

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
    expect(userContent).toContain("Round 3: vs Wests");
    expect(userContent).toContain("result 2-1");
    expect(userContent).toContain("Training (weekly");
    expect(userContent).toContain("Squad size: 2");
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
