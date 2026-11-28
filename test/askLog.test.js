import { describe, it, expect } from "vitest";
import { whoAsked, askLogEntry, cleanAskEntry, mergeAskLogs, askerWords, HOW_WORDS, CODE_ASKER, QUESTION_MAX, ANSWER_MAX } from "@/lib/askLog";

// lib/askLog.js: each question asked on a team's Ask tab, kept with who asked
// it. Every name and address here is made up.
const account = (hat, over = {}) => ({ mode: "account", email: "jane@example.com", realEmail: "jane@example.com", impersonating: null, team: { slug: "u10" }, hat, ...over });
const parent = { role: "parent", playerIds: ["p1"], playerNames: ["Sam Lee"] };
const AT = "2026-11-28T05:10:00.000Z";

describe("whoAsked", () => {
  it("keeps the sign-in and what they were on the team, as the Viewing-as chip says it", () => {
    expect(whoAsked(account(parent))).toEqual({ email: "jane@example.com", label: "Parent of Sam" });
    expect(whoAsked(account({ role: "coach", playerIds: [], playerNames: [], staffRole: "Head coach" }, { email: "kim@example.com", realEmail: "kim@example.com" })))
      .toEqual({ email: "kim@example.com", label: "Head coach" });
    expect(whoAsked(account({ role: "parent", playerIds: ["p1"], playerNames: ["Sam Lee"], selfIds: ["p1"] }))).toEqual({ email: "jane@example.com", label: "Player" });
    expect(whoAsked(account({ role: "viewer", playerIds: [], playerNames: [], clubAdmin: true }))).toEqual({ email: "jane@example.com", label: "Club admin (view only)" });
    expect(whoAsked(account({ role: "coach", playerIds: [], playerNames: [], club: true }))).toEqual({ email: "jane@example.com", label: "Super admin" });
  });

  it("keeps a super admin viewing as someone as themselves, with who they were viewing as", () => {
    const v = account(parent, { email: "jane@example.com", realEmail: "Owner@Example.com", impersonating: "jane@example.com" });
    expect(whoAsked(v)).toEqual({ email: "owner@example.com", label: "Parent of Sam", as: "jane@example.com" });
  });

  it("has no one to name in team-code mode, or without a viewer", () => {
    expect(whoAsked({ mode: "code", team: { slug: "u10" } })).toEqual({ label: CODE_ASKER });
    expect(whoAsked(null)).toEqual({ label: CODE_ASKER });
  });
});

describe("askLogEntry", () => {
  it("keeps the question, trimmed, when it was asked, how it was answered and who asked", () => {
    expect(askLogEntry({ question: "  When is   training? ", answer: "Tuesdays at 5:30.", how: "assistant", viewer: account(parent), at: AT }))
      .toEqual({ at: AT, q: "When is training?", a: "Tuesdays at 5:30.", how: "assistant", who: { email: "jane@example.com", label: "Parent of Sam" } });
  });

  it("keeps the assistant's answer with its line breaks, and no answer for a quick one or a failure", () => {
    const e = askLogEntry({ question: "Duties?", answer: "Fruit:\r\n- Sam  \n\n\n\n- Leo", how: "assistant", viewer: account(parent), at: AT });
    expect(e.a).toBe("Fruit:\n- Sam\n\n- Leo");
    expect(askLogEntry({ question: "Next game?", answer: "Saturday", how: "quick", viewer: account(parent), at: AT })).not.toHaveProperty("a");
    expect(askLogEntry({ question: "Next game?", answer: "oops", how: "failed", viewer: account(parent), at: AT })).not.toHaveProperty("a");
  });

  it("caps a long question and answer, takes an unknown way of answering as the assistant, and keeps nothing without a question", () => {
    const e = askLogEntry({ question: "q".repeat(5000), answer: "a".repeat(5000), how: "telepathy", viewer: account(parent), at: AT });
    expect([e.q.length, e.a.length, e.how]).toEqual([QUESTION_MAX, ANSWER_MAX, "assistant"]);
    expect(askLogEntry({ question: "   ", viewer: account(parent) })).toBeNull();
    expect(askLogEntry({ viewer: account(parent) })).toBeNull();
    expect(askLogEntry()).toBeNull();
  });

  it("stamps the time it was asked when none is given", () => {
    const e = askLogEntry({ question: "Hi", viewer: { mode: "code" } });
    expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    expect(e.who).toEqual({ label: CODE_ASKER });
  });
});

describe("cleanAskEntry and mergeAskLogs", () => {
  it("drops anything not in the shape kept, and tidies the rest", () => {
    expect(cleanAskEntry(null)).toBeNull();
    expect(cleanAskEntry({ q: "Hi" })).toBeNull();
    expect(cleanAskEntry({ q: "", at: AT })).toBeNull();
    expect(cleanAskEntry({ q: "Hi", at: "yesterday-ish" })).toBeNull();
    expect(cleanAskEntry({ q: "Hi", at: AT, how: "magic", a: "x", who: { email: "not an email", label: "" } }))
      .toEqual({ at: AT, q: "Hi", a: "x", how: "assistant", who: { label: CODE_ASKER } });
    expect(cleanAskEntry({ q: "Hi", at: AT, how: "quick", a: "dropped", who: { email: "JANE@example.com", label: "Parent of Sam", as: "x@example.com" } }))
      .toEqual({ at: AT, q: "Hi", how: "quick", who: { email: "jane@example.com", label: "Parent of Sam", as: "x@example.com" } });
  });

  it("puts every team's questions together, newest first, with the team's name, and stops at the limit", () => {
    const e = (q, at) => ({ q, at, how: "quick", who: { label: CODE_ASKER } });
    const merged = mergeAskLogs([
      { slug: "u10", name: "Under 10s", entries: [e("third", "2026-11-28T03:00:00Z"), e("first", "2026-11-28T01:00:00Z"), "junk"] },
      { slug: "u9", name: "", entries: [e("second", "2026-11-28T02:00:00Z")] },
      { slug: "u8", name: "Under 8s", entries: null }
    ]);
    expect(merged.map((m) => [m.q, m.team, m.teamName])).toEqual([["third", "u10", "Under 10s"], ["second", "u9", "u9"], ["first", "u10", "Under 10s"]]);
    expect(mergeAskLogs([{ slug: "u10", name: "Under 10s", entries: [e("a", "2026-11-28T03:00:00Z"), e("b", "2026-11-28T02:00:00Z")] }], 1).map((m) => m.q)).toEqual(["a"]);
  });
});

describe("askerWords", () => {
  it("names the person the club knows, what they were on the team, and their email", () => {
    expect(askerWords({ email: "jane@example.com", label: "Parent of Sam" }, "Jane Lee")).toEqual({ line: "Jane Lee · Parent of Sam", email: "jane@example.com" });
    expect(askerWords({ email: "jane@example.com", label: "Parent of Sam" }, "")).toEqual({ line: "Parent of Sam", email: "jane@example.com" });
  });

  it("says when a super admin was viewing as someone, and who has no sign-in", () => {
    expect(askerWords({ email: "owner@example.com", label: "Parent of Sam", as: "jane@example.com" }, "Kim Owner"))
      .toEqual({ line: "Kim Owner, viewing as jane@example.com (Parent of Sam)", email: "owner@example.com" });
    expect(askerWords({ email: "owner@example.com", label: "Parent of Sam", as: "jane@example.com" })).toEqual({ line: "Viewing as jane@example.com (Parent of Sam)", email: "owner@example.com" });
    expect(askerWords({ label: CODE_ASKER })).toEqual({ line: CODE_ASKER, email: "" });
    expect(askerWords(null)).toEqual({ line: CODE_ASKER, email: "" });
  });

  it("words each way of answering", () => {
    expect(HOW_WORDS).toEqual({ assistant: "Answered by the assistant", quick: "Quick answer on the phone", failed: "The assistant couldn't answer" });
  });
});
