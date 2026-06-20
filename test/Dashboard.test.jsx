// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import App from "@/components/Dashboard";

// Component-level tests for the Dashboard App: data loading via window.storage,
// the sample-data fallback, tab navigation, and the coach-mode PIN gate. These
// render the real component in jsdom, so they exercise the wiring the pure-helper
// unit tests can't. We stay off the Stats tab (recharts needs a real layout).

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", assistantCoach: "Dee" },
    players: [{ id: "p1", name: "Sam Smith", number: 7, position: "FWD" }],
    fixtures: [{ id: "f1", status: "upcoming", dateISO: "2026-09-01", time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {} }],
    sessions: [],
    isSample: false,
    ...over
  };
}

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  // SubscribeCard / AskTab fetch endpoints that don't exist under test.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

// The header coach button (unique, only present once data has loaded) makes a
// reliable "loaded" anchor — the team name itself appears in multiple cards.
const waitForLoaded = () => screen.findByRole("button", { name: /View/ });

describe("App — loading and data", () => {
  it("shows a loading state, then renders the team header from stored data", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    expect(screen.getByText("Loading…")).toBeTruthy(); // initial synchronous render
    await waitForLoaded();
    expect(screen.getByText(/Div 1 · U8/)).toBeTruthy();
    expect(screen.getByText("Coach Byron · Asst Dee")).toBeTruthy();
    expect(screen.getAllByText("Test FC").length).toBeGreaterThan(0);
  });

  it("falls back to sample data (with banner) and persists it when storage is empty", async () => {
    storage.get.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText(/example data/i)).toBeTruthy();
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
  });

  it("falls back to sample data when storage throws", async () => {
    storage.get.mockRejectedValue(new Error("offline"));
    render(<App />);
    await waitForLoaded();
    expect(document.body.textContent).toMatch(/Olympic FC/); // sampleData team name
  });
});

describe("App — tab navigation", () => {
  it("switches to the Squad tab and lists players", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    // The player isn't on the Home tab; it appears after navigating to Squad.
    fireEvent.click(screen.getByText("Squad"));
    expect(await screen.findByText("Sam Smith")).toBeTruthy();
  });
});

describe("App — coach-mode PIN gate", () => {
  it("enters coach mode directly when no PIN is set, revealing the Settings tab", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "" } })) });
    render(<App />);
    await waitForLoaded();
    expect(screen.queryByText("Settings")).toBeNull(); // coach-only tab hidden in view mode

    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    // Now in coach mode: the toggle flips and the Settings tab appears.
    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Coach/ })).toBeTruthy();
  });

  it("does NOT enter coach mode when a PIN is set", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    // Coach mode must stay off: no coach toggle, no coach-only Settings tab.
    expect(screen.queryByRole("button", { name: /Coach/ })).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
  });
});

describe("App — RSVP toggle (match modal)", () => {
  it("marks a player 'in', updating the count and POSTing to /api/rsvp", async () => {
    // RSVP succeeds so the optimistic update sticks (a failed POST reverts it).
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /View/ })); // coach can mark anyone

    // Open the match modal from the Home "Who's playing?" card.
    fireEvent.click(screen.getByText("Who's playing?"));
    const inBtn = await screen.findByRole("button", { name: "In" });
    fireEvent.click(inBtn);

    // Optimistic count update in the modal, and the RSVP POST.
    expect(await screen.findByText("1 in")).toBeTruthy();
    await waitFor(() => {
      const call = fetch.mock.calls.find(c => String(c[0]).includes("/api/rsvp"));
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toMatchObject({ kind: "game", id: "f1", playerId: "p1", status: "in" });
    });
  });
});

describe("App — coach edit-save (fixture)", () => {
  it("persists a new fixture via window.storage and clears the sample flag", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /View/ })); // coach mode

    fireEvent.click(screen.getByText("Results"));          // Fixtures tab
    fireEvent.click(await screen.findByText("Add fixture")); // open the editor
    // Drive the segmented controls (robustly addressable by button text).
    fireEvent.click(await screen.findByRole("button", { name: "Away" }));
    fireEvent.click(screen.getByRole("button", { name: "Played" }));
    fireEvent.click(screen.getByRole("button", { name: "Save fixture" }));

    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    const saved = JSON.parse(storage.set.mock.calls.at(-1)[1]);
    expect(saved.isSample).toBe(false);
    const added = saved.fixtures.find(x => x.status === "played");
    expect(added).toBeTruthy();
    expect(added.homeAway).toBe("A");
  });
});
