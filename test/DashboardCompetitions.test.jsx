// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";

// The dashboard's handling of games from a team's other competitions. These
// render the real component in jsdom, like test/Dashboard.test.jsx; they sit
// in a file of their own so that file is not where every dashboard change meets.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

// Dates relative to "today" so "next game" and past/upcoming hold whenever the suite runs.
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", assistantCoach: "Dee" },
    players: [{ id: "p1", name: "Sam Smith", number: 7, position: "FWD" }],
    fixtures: [],
    sessions: [],
    isSample: false,
    ...over
  };
}

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  // /api/me and the other endpoints do not exist under test: legacy (team-code) view.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

// The header hat chip is only present once data has loaded.
const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const headerTitle = () => document.querySelector(".head .hname")?.textContent;

// A team's other competitions (lib/competitions.js): a game synced from one
// carries its id and name (comp, compName). It is labelled with that name
// wherever its round shows, and never counts in the season record.
describe("Competitions — games outside the season", () => {
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" }
  ];
  const WINTER = { comp: "cwinter", compName: "Winterfest" };
  const game = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: daysFromNow(10), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const played = (over = {}) => ({ id: "r5", round: 5, status: "played", dateISO: daysFromNow(-14), time: "09:00", opponent: "Rovers", homeAway: "H", venue: "Perry Park", us: 3, them: 1, availability: {}, ...over });
  // A Winterfest game sooner than the next season game, and one already played and won.
  const winterNext = (over = {}) => game({ id: "w2", round: 2, dateISO: daysFromNow(3), time: "10:30", opponent: "Lions", homeAway: "A", venue: "Lion Park", ...WINTER, ...over });
  const winterWon = (over = {}) => played({ id: "w1", round: 1, dateISO: daysFromNow(-5), opponent: "Zebras", us: 6, them: 0, goals: [{ pid: "p2", n: 4 }], ...WINTER, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  const toResults = () => fireEvent.click(within(screen.getByRole("navigation")).getByText("Results"));
  const resCard = (label) => screen.getByText(label, { selector: ".label" }).closest(".card");
  const rowOf = (card, opponent) => [...card.querySelectorAll(".mrow")].find((r) => r.textContent.includes(opponent));

  it("results: the game carries its competition's name on a tag line and keeps its own round number", async () => {
    await load(makeData({ players: kids, fixtures: [game(), played(), winterNext(), winterWon()] }));
    toResults();
    const fixtures = resCard("Fixtures"), results = resCard("Results");
    const lions = rowOf(fixtures, "Lions"), wests = rowOf(fixtures, "Wests");
    expect(lions.querySelector(".mrow-tag .mtag").textContent).toBe("Winterfest");
    expect(lions.querySelector(".mtag svg")).toBeTruthy();
    expect(lions.querySelector(".mr-round .r").textContent).toBe("2");
    expect(wests.querySelector(".mrow-tag")).toBeNull();
    expect(wests.querySelector(".mr-round .r").textContent).toBe("7");
    expect(rowOf(results, "Zebras").querySelector(".mtag").textContent).toBe("Winterfest");
    expect(rowOf(results, "Rovers").querySelector(".mrow-tag")).toBeNull();
    const note = screen.getByText("Games in another competition are tagged with its name and don't count toward the season record.");
    expect(note.className).toBe("footnote res-foot");
    expect(screen.queryByText(/Carnival games are tagged/)).toBeNull();
  });

  it("a season with no such game shows no tag and no footnote", async () => {
    await load(makeData({ players: kids, fixtures: [game(), played()] }));
    toResults();
    expect(document.querySelector(".mtag")).toBeNull();
    expect(screen.queryByText(/don't count toward the season record/)).toBeNull();
  });

  it("carnival games keep their own footnote: the competition one is only for competition games", async () => {
    const carnival = { id: "c1", title: "Winter carnival", kind: "carnival", recur: "once", dateISO: daysFromNow(5), time: "08:00", endTime: "14:00", location: "Perry Park" };
    const cgame = game({ id: "cg", round: null, dateISO: daysFromNow(5), opponent: "Zebras FC", carnivalId: "c1" });
    await load(makeData({ players: kids, fixtures: [game(), cgame], sessions: [carnival] }));
    toResults();
    expect(screen.getByText(/Carnival games are tagged with their carnival/)).toBeTruthy();
    expect(screen.queryByText(/Games in another competition/)).toBeNull();
    // With both kinds on the list, each has its footnote, and a game that is
    // both (a competition game the coach linked to a carnival) wears the carnival's tag.
    cleanup();
    const both = winterNext({ id: "wb", opponent: "Tigers", carnivalId: "c1" });
    await load(makeData({ players: kids, fixtures: [game(), cgame, winterNext(), both], sessions: [carnival] }));
    toResults();
    expect(screen.getByText(/Carnival games are tagged with their carnival/)).toBeTruthy();
    expect(screen.getByText(/Games in another competition/)).toBeTruthy();
    const fixtures = resCard("Fixtures");
    expect([...rowOf(fixtures, "Tigers").querySelectorAll(".mtag")].map((t) => t.textContent)).toEqual(["Winter carnival"]);
    expect([...rowOf(fixtures, "Lions").querySelectorAll(".mtag")].map((t) => t.textContent)).toEqual(["Winterfest"]);
  });

  it("the season record, form and stats count the season only", async () => {
    // Season: one win (3-1). Winterfest: a 6-0 win with four goals from Alex.
    await load(makeData({ players: kids, fixtures: [game(), played({ goals: [{ pid: "p1", n: 3 }] }), winterWon()] }));
    toResults();
    expect(document.querySelector(".season-mini .wdl .v").textContent).toBe("1–0–0");
    expect([...document.querySelectorAll(".season-mini .pip")].map((p) => p.textContent)).toEqual(["W"]);
    fireEvent.click(screen.getByText("All stats ›"));
    await screen.findByText("Top scorers");
    const tiles = [...document.querySelectorAll(".st-tiles .tile")].map((t) => t.querySelector(".k").textContent + "=" + t.querySelector(".v").textContent);
    expect(tiles).toEqual(["Played=1", "Won=1", "Drew=0", "Lost=0", "Pts=3"]);
    // Goals by round: the season's round 5 only, not Winterfest's round 1.
    expect([...document.querySelectorAll(".st-col .st-rd")].map((e) => e.textContent)).toEqual(["R5"]);
    // Top scorers: Sam's three season goals; Alex's four were at Winterfest.
    const scorers = [...document.querySelectorAll(".sc-row")].map((r) => r.querySelector(".pr-name b").textContent);
    expect(scorers).toEqual(["Sam Smith"]);
  });

  it("home: the next game is the soonest game whatever its competition, and says which", async () => {
    await load(makeData({ players: kids, fixtures: [game(), winterNext()] }));
    expect(document.querySelector(".ng-label").textContent).toBe("Next game · Winterfest · Round 2 · Away");
    // A season game reads as it always did.
    cleanup();
    await load(makeData({ players: kids, fixtures: [game()] }));
    expect(document.querySelector(".ng-label").textContent).toBe("Next game · Round 7 · Home");
  });

  it("match screen: the header and the hero name the competition with the round", async () => {
    await load(makeData({ players: kids, fixtures: [game(), winterNext()] }));
    toResults();
    fireEvent.click(rowOf(resCard("Fixtures"), "Lions"));
    await waitFor(() => expect(headerTitle()).toBe("Winterfest · Round 2"));
    expect(document.querySelector(".mh-label").textContent).toMatch(/^Winterfest · Round 2 · Away · /);
    // A competition game with no round is known by the competition alone.
    cleanup();
    await load(makeData({ players: kids, fixtures: [winterNext({ round: null })] }));
    toResults();
    fireEvent.click(rowOf(resCard("Fixtures"), "Lions"));
    await waitFor(() => expect(headerTitle()).toBe("Winterfest"));
    expect(document.querySelector(".mh-label").textContent).toMatch(/^Winterfest · Away · /);
  });

  it("with two draws the lists run by date, not by round number; a single draw keeps its round order", async () => {
    // Winterfest's rounds 1 and 2 fall either side of the season's round 7; round 8 is later still.
    const fixtures = [
      game({ id: "s8", round: 8, dateISO: daysFromNow(20), opponent: "Souths" }),
      winterNext({ id: "w2", round: 2, dateISO: daysFromNow(12), opponent: "Tigers" }),
      game({ id: "s7", round: 7, dateISO: daysFromNow(10), opponent: "Wests" }),
      winterNext({ id: "w1", round: 1, dateISO: daysFromNow(3), opponent: "Lions" })
    ];
    await load(makeData({ players: kids, fixtures }));
    toResults();
    const order = () => [...resCard("Fixtures").querySelectorAll(".mrow")].map((r) => r.querySelector(".mr-side:not(.ours) .mr-name").textContent);
    expect(order()).toEqual(["Lions", "Wests", "Tigers", "Souths"]);
    // Duties too.
    fireEvent.click(within(screen.getByRole("navigation")).getByText("Home"));
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    expect([...document.querySelectorAll(".ducard .du-opp")].map((e) => e.textContent)).toEqual(["vs Lions · Winterfest", "vs Wests", "vs Tigers · Winterfest", "vs Souths"]);
    // One draw: a postponed round keeps its place by number, as before.
    cleanup();
    await load(makeData({ players: kids, fixtures: [game({ id: "s8", round: 8, dateISO: daysFromNow(6), opponent: "Souths" }), game({ id: "s7", round: 7, dateISO: daysFromNow(13), opponent: "Wests" })] }));
    toResults();
    expect(order()).toEqual(["Wests", "Souths"]);
  });

  it("duties: the game's card says which competition it is", async () => {
    await load(makeData({ players: kids, fixtures: [game(), winterNext()] }));
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    const opp = [...document.querySelectorAll(".ducard .du-opp")].map((e) => e.textContent);
    expect(opp).toContain("vs Lions · Winterfest");
    expect(opp).toContain("vs Wests");
  });
});
