// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal, fmtDate } from "@/lib/dashboardData";

// Where two features meet in the dashboard: one squad that plays as two teams
// each round (fixture.side, paired by round) and a team's other competitions
// (fixture.comp, each with its own round numbers and, perhaps, its own squad).
// A pair is always within one competition, and a game is labelled with both.
// Real component in jsdom, in a file of its own like the other dashboard files.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const kids = [
  { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
  { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
  { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
];
const WINTER = { comp: "cwinter", compName: "Winterfest" };
const g = (id, side, over = {}) => ({ id, round: 7, ...(side ? { side } : {}), status: "upcoming", dateISO: daysFromNow(5), time: "09:00", opponent: "Oxley United", homeAway: "H", venue: "Perry Park – Field 4C", availability: {}, ...over });
const makeData = (over = {}) => ({
  team: { name: "U9 Academy", division: "FQA 1", ageGroup: "U9", coachPin: "", sides: ["McKay", "McKain"] },
  players: kids, fixtures: [], sessions: [], isSample: false, ...over
});
const parentOf = (ids, names) => {
  const hat = { role: "parent", playerIds: ids, playerNames: names };
  return { mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "U9 Academy", role: "parent", playerIds: ids, playerNames: names,
    hats: [hat], teams: [{ teamSlug: "a", teamName: "U9 Academy", hats: [hat] }], canSwitch: false, memberships: [] };
};
const stubFetch = (me = null) => fetch.mockImplementation((url) => {
  const u = String(url);
  if (me && u.includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
  if (u.includes("/api/rsvp")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
});

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  vi.stubGlobal("fetch", vi.fn());
  stubFetch();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const headerTitle = () => document.querySelector(".head .hname")?.textContent;
const headerKicker = () => document.querySelector(".head .hkick")?.textContent;
const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
const nav = (label) => fireEvent.click(within(screen.getByRole("navigation")).getByText(label));
const weekRows = () => [...document.querySelectorAll(".week .wk-row")].map((r) => ({
  title: r.querySelector(".wk-title").textContent, side: r.querySelector(".sidetag")?.textContent || "", pills: [...r.querySelectorAll(".wk-pill")].map((p) => p.textContent)
}));
const resultRow = (opponent) => [...document.querySelectorAll(".mrow")].filter((r) => r.textContent.includes(opponent));
const rowTags = (r) => ({ comp: r.querySelector(".mtag")?.textContent || "", side: r.querySelector(".sidetag")?.textContent || "" });
const sheet = () => within(document.querySelector(".sheet"));
const rsvpBodies = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/rsvp")).map((c) => JSON.parse(c[1].body));

describe("Sides and competitions together", () => {
  // The season's round 7 is a pair. Winterfest has its own round 7 the same
  // week (one game, the McKain side's entry) and a round 8 that is a pair.
  const mixed = (over = {}) => makeData({
    fixtures: [
      g("sa", "McKay"), g("sb", "McKain", { time: "10:30", venue: "Perry Park – Field 4A" }),
      g("w7", "McKain", { ...WINTER, dateISO: daysFromNow(6), opponent: "Zebras FC", venue: "Lions Park" }),
      g("wa", "McKay", { ...WINTER, round: 8, dateISO: daysFromNow(12), opponent: "Lions", venue: "Lions Park – Field 1" }),
      g("wb", "McKain", { ...WINTER, round: 8, dateISO: daysFromNow(12), time: "11:00", opponent: "Lions", venue: "Lions Park – Field 2" })
    ],
    ...over
  });

  it("the season's pair does not take in another competition's game of the same round number", async () => {
    await load(mixed());
    // Home: the season's two games, one line per side; Winterfest's round 7 is not a third line.
    expect([...document.querySelectorAll(".nextgame .ng-side .sidetag")].map((t) => t.textContent)).toEqual(["McKay", "McKain"]);
    expect(document.querySelector(".ng-label").textContent).toBe("Next game · Round 7 · Home");
    // The week: both season games tagged with their side; the Winterfest game is a single game, so it is not.
    expect(weekRows().map((r) => r.side)).toEqual(["McKay", "McKain", ""]);
    nav("Results");
    await waitFor(() => expect(document.querySelectorAll(".mrow").length).toBe(5));
    expect(resultRow("Oxley United").map(rowTags)).toEqual([{ comp: "", side: "McKay" }, { comp: "", side: "McKain" }]);
    expect(resultRow("Zebras FC").map(rowTags)).toEqual([{ comp: "Winterfest", side: "" }]);
  });

  it("a competition's own pair carries both: its name and each game's side", async () => {
    await load(mixed());
    nav("Results");
    await waitFor(() => expect(document.querySelectorAll(".mrow").length).toBe(5));
    const lions = resultRow("Lions");
    expect(lions.map(rowTags)).toEqual([{ comp: "Winterfest", side: "McKay" }, { comp: "Winterfest", side: "McKain" }]);
    fireEvent.click(lions[1]);
    await waitFor(() => expect(headerTitle()).toBe("Winterfest · Round 8"));
    expect(headerKicker()).toBe(`McKain · vs Lions · ${fmtDate(daysFromNow(12))}`);
    expect(document.querySelector(".mh-label").textContent).toBe(`Winterfest · Round 8 · McKain · Home · ${fmtDate(daysFromNow(12))}`);
    const wa = decodeURIComponent(document.querySelector("a.washare").getAttribute("href"));
    expect(wa).toContain("⚽ U9 Academy McKain — Winterfest · Round 8 vs Lions");
  });

  it("duties: a competition pair's cards name the competition and the side", async () => {
    await load(mixed());
    fireEvent.click(document.querySelector(".dutycard"));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    const heads = [...document.querySelectorAll(".ducard .du-head")].map((h) => [h.querySelector(".du-opp").textContent, h.querySelector(".sidetag")?.textContent || ""]);
    expect(heads).toContainEqual(["vs Lions · Winterfest", "McKay"]);
    expect(heads).toContainEqual(["vs Lions · Winterfest", "McKain"]);
    expect(heads).toContainEqual(["vs Zebras FC · Winterfest", ""]);
    expect(heads).toContainEqual(["vs Oxley United", "McKay"]);
  });

  it("one reply covers the season's two games and not the other competition's game of that round", async () => {
    stubFetch(parentOf(["p1"], ["Sam Smith"]));
    await load(mixed());
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    expect(await sheet().findByText("Your reply covers both games this round.")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(rsvpBodies()).toEqual([{ kind: "game", id: "sa", playerId: "p1", status: "in" }]));
    await waitFor(() => expect(weekRows().map((r) => r.pills)).toEqual([["Sam's in"], ["Sam's in"], ["No reply"]]));
  });

  it("a reply on a single competition game is not offered as covering both", async () => {
    stubFetch(parentOf(["p1"], ["Sam Smith"]));
    await load(mixed());
    fireEvent.click(weekRows().length && [...document.querySelectorAll(".week .wk-row")][2]);
    await waitFor(() => expect(headerTitle()).toBe("Winterfest · Round 7"));
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    await sheet().findByRole("button", { name: "In" });
    expect(sheet().queryByText("Your reply covers both games this round.")).toBeNull();
  });

  it("a competition's squad applies to both games of its pair, and a family outside it moves on to the season's pair", async () => {
    // Winterfest's pair is the sooner round here; Sam is going, Alex is not.
    const data = makeData({
      competitionSquads: { cwinter: ["p1", "p3"] },
      fixtures: [
        g("wa", "McKay", { ...WINTER, round: 2, dateISO: daysFromNow(3), opponent: "Lions" }),
        g("wb", "McKain", { ...WINTER, round: 2, dateISO: daysFromNow(3), time: "11:00", opponent: "Lions" }),
        g("sa", "McKay", { dateISO: daysFromNow(6) }), g("sb", "McKain", { dateISO: daysFromNow(6), time: "10:30" })
      ]
    });
    stubFetch(parentOf(["p2"], ["Alex Smith"]));
    await load(data);
    // Alex's family: the season's round 7, both sides, and they are asked about Alex.
    expect(document.querySelector(".ng-label").textContent).toBe("Next game · Round 7 · Home");
    expect([...document.querySelectorAll(".nextgame .ng-side .sidetag")].map((t) => t.textContent)).toEqual(["McKay", "McKain"]);
    expect(screen.getByText("Reply for Alex")).toBeTruthy();
    // The Winterfest pair's rows show the squad's tally, not a reply for Alex.
    expect(weekRows().slice(0, 2).map((r) => [r.side, r.pills])).toEqual([["McKay", ["0 in · 2 to reply"]], ["McKain", ["0 in · 2 to reply"]]]);
    cleanup();
    // Sam's family: Winterfest's pair is next, one reply covers both of its games.
    stubFetch(parentOf(["p1"], ["Sam Smith"]));
    await load(data);
    expect(document.querySelector(".ng-label").textContent).toBe("Next game · Winterfest · Round 2 · Home");
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    expect(await sheet().findByText("Your reply covers both games this round.")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(weekRows().map((r) => r.pills)).toEqual([["Sam's in"], ["Sam's in"], ["No reply"], ["No reply"]]));
  });

  it("results and duties list a round's two games in wizard order, whichever was synced first", async () => {
    // McKain's feed came in first for round 7; round 8 was stored the usual way round.
    await load(makeData({ fixtures: [
      g("sb", "McKain"), g("sa", "McKay"),
      g("ta", "McKay", { round: 8, dateISO: daysFromNow(12), opponent: "Souths" }), g("tb", "McKain", { round: 8, dateISO: daysFromNow(12), opponent: "Souths" })
    ] }));
    nav("Results");
    await waitFor(() => expect(document.querySelectorAll(".mrow").length).toBe(4));
    expect([...document.querySelectorAll(".mrow")].map((r) => `${r.querySelector(".mr-round .r").textContent} ${r.querySelector(".sidetag").textContent}`))
      .toEqual(["7 McKay", "7 McKain", "8 McKay", "8 McKain"]);
    nav("Home");
    fireEvent.click(document.querySelector(".dutycard"));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    expect([...document.querySelectorAll(".ducard .du-head")].map((h) => `${h.querySelector(".du-round").textContent} ${h.querySelector(".sidetag").textContent}`))
      .toEqual(["R7 McKay", "R7 McKain", "R8 McKay", "R8 McKain"]);
  });
});
