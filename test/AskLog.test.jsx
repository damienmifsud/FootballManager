// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import AskLog, { whenAsked } from "@/components/AskLog";

// Club admin → Questions: every question asked on the teams' Ask tabs, with
// who asked it. /api/ask-log is a stand-in; every name and address is made up.
const TEAMS = [{ slug: "u10", name: "Under 10s" }, { slug: "u9", name: "Under 9s" }];
const QUESTIONS = [
  { at: "2026-11-28T05:05:00.000Z", q: "When is training?", a: "Training is Tuesdays at 5:30.\\n- Bring water", how: "assistant", team: "u10", teamName: "Under 10s", name: "Jane Lee", who: { email: "jane@example.com", label: "Parent of Sam" } },
  { at: "2026-11-28T04:00:00.000Z", q: "Next game?", how: "quick", team: "u10", teamName: "Under 10s", who: { label: "Someone with the team code" } },
  { at: "2026-11-27T23:30:00.000Z", q: "Who brings fruit?", how: "failed", team: "u9", teamName: "Under 9s", name: "Kim Owner", who: { email: "owner@example.com", label: "Head coach", as: "kim@example.com" } }
];
let reply;
beforeEach(() => {
  reply = (url) => ({ ok: true, json: async () => ({ teams: TEAMS, questions: url.includes("team=u9") ? QUESTIONS.slice(2) : QUESTIONS }) });
  global.fetch = vi.fn(async (url) => reply(String(url)));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const rows = () => within(screen.getByRole("list", { name: "Questions asked" })).getAllByRole("listitem");
const rowText = (r) => [...r.querySelectorAll(".al-q, .al-who, .al-meta")].map((el) => el.textContent);

describe("AskLog", () => {
  it("lists each question with who asked it, their email, the team, when in Brisbane and how it was answered", async () => {
    render(<AskLog />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map(rowText)).toEqual([
      ["When is training?", "Jane Lee · Parent of Sam", "jane@example.com · Under 10s · Sat 28 Nov, 3:05 pm · Answered by the assistant"],
      ["Next game?", "Someone with the team code", "Under 10s · Sat 28 Nov, 2:00 pm · Quick answer on the phone"],
      ["Who brings fruit?", "Kim Owner, viewing as kim@example.com (Head coach)", "owner@example.com · Under 9s · Sat 28 Nov, 9:30 am · The assistant couldn't answer"]
    ]);
    expect(screen.getByRole("status").textContent).toBe("3 questions from 3 people");
    expect(global.fetch).toHaveBeenCalledWith("/api/ask-log", { cache: "no-store" });
  });

  it("keeps the assistant's answer folded under its question", async () => {
    render(<AskLog />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    const answer = rows()[0].querySelector("details");
    expect(answer.open).toBe(false);
    expect(answer.querySelector("summary").textContent).toBe("The answer");
    expect(answer.querySelector("div").textContent).toBe("Training is Tuesdays at 5:30.\\n- Bring water");
    expect(rows()[1].querySelector("details")).toBeNull();
  });

  it("shows one team's questions when one is picked", async () => {
    render(<AskLog />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "u9" } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(global.fetch).toHaveBeenLastCalledWith("/api/ask-log?team=u9", { cache: "no-store" });
    expect(screen.getByRole("status").textContent).toBe("1 question from 1 person");
  });

  it("says when no questions have been asked, and when they couldn't be loaded", async () => {
    reply = () => ({ ok: true, json: async () => ({ teams: TEAMS, questions: [] }) });
    render(<AskLog />);
    expect(await screen.findByText("No questions asked yet.")).toBeTruthy();
    cleanup();
    reply = () => ({ ok: false, json: async () => ({ error: "forbidden" }) });
    render(<AskLog />);
    expect((await screen.findByRole("alert")).textContent).toBe("forbidden");
  });

  it("writes the time as it was in Brisbane", () => {
    expect(whenAsked("2026-11-28T14:30:00.000Z")).toBe("Sun 29 Nov, 12:30 am");
    expect(whenAsked("not a time")).toBe("");
  });
});
