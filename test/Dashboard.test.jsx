// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";

// Component-level tests for the Dashboard App: data loading via window.storage,
// the sample-data fallback, tab navigation, and the coach-mode PIN gate. These
// render the real component in jsdom, so they exercise the wiring the pure-helper
// unit tests can't. We stay off the Stats tab (recharts needs a real layout).

// Dates relative to "today" so the next-fixture cards (Home, Duties) keep
// finding an upcoming game no matter when the suite runs.
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", assistantCoach: "Dee" },
    players: [{ id: "p1", name: "Sam Smith", number: 7, position: "FWD" }],
    fixtures: [{ id: "f1", status: "upcoming", dateISO: daysFromNow(7), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {} }],
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

describe("App — account-mode roles (/api/me)", () => {
  const meFetch = (me) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };

  it("hides the coach toggle entirely for a parent", async () => {
    meFetch({ mode: "account", email: "mum@a.com", admin: false, teamSlug: "a", role: "parent", memberships: [] });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    await waitFor(() => expect(screen.queryByRole("button", { name: /View/ })).toBeNull());
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("hides the coach toggle and the respond button for a view-only club admin", async () => {
    meFetch({ mode: "account", email: "td@club.com", admin: false, teamSlug: "a", role: "viewer", memberships: [] });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    await waitFor(() => expect(screen.queryByRole("button", { name: /View/ })).toBeNull());
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
  });

  it("lets a server-verified coach enter coach mode without the PIN", async () => {
    meFetch({ mode: "account", email: "coach@a.com", admin: false, teamSlug: "a", role: "coach", memberships: [] });
    // A coachPin is set, but the server-verified role skips the PIN sheet.
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    const viewBtn = await screen.findByRole("button", { name: /View/ });
    // Wait for /api/me to land before toggling.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(viewBtn);
    expect(await screen.findByText("Settings")).toBeTruthy();
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

describe("App — per-team feature flags (duties)", () => {
  it("shows fruit + goalkeeper tiles by default, with jersey duty off", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByRole("button", { name: /View/ });
    expect(screen.getByText("Fruit duty")).toBeTruthy();
    expect(screen.getByText("In goal")).toBeTruthy();
    expect(screen.queryByText("Jerseys")).toBeNull();
  });

  it("honours the flags: jersey on, fruit and goalkeeper off", async () => {
    const data = makeData();
    data.team.features = { fruitDuty: false, gkDuty: false, jerseyDuty: true };
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await screen.findByRole("button", { name: /View/ });
    expect(screen.getByText("Jerseys")).toBeTruthy();
    expect(screen.queryByText("Fruit duty")).toBeNull();
    expect(screen.queryByText("In goal")).toBeNull();
    // Duties tab shows only the jersey section.
    fireEvent.click(screen.getByText("Duties"));
    expect(await screen.findByText("Jersey washing")).toBeTruthy();
    expect(screen.queryByText("Goalkeeper")).toBeNull();
  });
});

describe("App — Squadi-style results rows", () => {
  const withFixtures = (fixtures) => makeData({ fixtures });

  it("flips an away game (home team left) but colours the score by our result", async () => {
    // Olympic away win 3–1 → rendered home-perspective as 1–3 with a WIN chip.
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "f1", round: 4, status: "played", dateISO: "2026-05-02", time: "09:00", opponent: "Wests", homeAway: "A", venue: "X", us: 3, them: 1, availability: {} }
    ])) });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /View/ });
    fireEvent.click(screen.getByText("Results"));
    const row = container.querySelector(".sqrow");
    expect(row.querySelector(".sqscore").className).toContain("win");
    expect(row.querySelector(".sqscore").textContent).toBe("1–3");
    // Away flip: opponent (home side) renders first, Olympic highlighted on the right.
    const names = [...row.querySelectorAll(".sqname")].map((n) => n.textContent);
    expect(names).toEqual(["Wests", "Test FC"]);
    expect(row.querySelector(".sqteam.away").className).toContain("squs");
  });

  it("renders the non-score states as chips (cancelled dims the row)", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "c1", round: 1, status: "cancelled", dateISO: "2026-05-02", opponent: "A", homeAway: "H", us: null, them: null, availability: {} },
      { id: "u1", round: 2, status: "upcoming", dateISO: "2099-05-02", opponent: "B", homeAway: "H", us: null, them: null, availability: {} },
      { id: "n1", round: 3, status: "played", dateISO: "2020-01-01", opponent: "C", homeAway: "H", us: null, them: null, availability: {} }
    ])) });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /View/ });
    fireEvent.click(screen.getByText("Results"));
    expect(screen.getByText("Canc")).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("No score")).toBeTruthy();
    expect(container.querySelector(".sqrow.canc")).toBeTruthy();
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
