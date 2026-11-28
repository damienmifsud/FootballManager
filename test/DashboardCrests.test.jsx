// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import MatchDayPlanner from "@/components/MatchDayPlanner";
import Crest, { OppCrest } from "@/components/Crest";
import { isoLocal, fmtDate } from "@/lib/dashboardData";

// Wherever a game is written "vs somebody" the opposition's crest is beside
// it, and wherever a family is asked to answer (a reply, a duty) the sheet
// says where the game is. The crest is one of our own files, found by the
// opponent's name (lib/clubs.js). A logo address kept from the draw is shown
// only for a club with no artwork here, and only from Squadi's or Dribl's own
// image hosts (lib/clubs.js sourceLogo; test/crestLogos.test.jsx): HOTLINK
// below is neither, so it is never shown. A club with neither gets a disc
// with its initials.
// Real component in jsdom; every club, ground and person here is made up or
// from the bundled crest set.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const kids = [
  { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
  { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
  { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
];
const HOTLINK = "https://images.example.com/their-logo.png";
// In the crest set: an away game at a named ground. The draw's own logo address rides on the fixture.
const oxley = (over = {}) => ({ id: "f1", round: 7, status: "upcoming", dateISO: daysFromNow(3), time: "09:00", opponent: "Oxley United U9 Eagles", homeAway: "A",
  venue: "Oxley Park – Field 2", opponentLogo: HOTLINK, ourLogo: HOTLINK, availability: {}, ...over });
// Not in the crest set, and nowhere to play yet.
const zebras = (over = {}) => ({ id: "f2", round: 8, status: "upcoming", dateISO: daysFromNow(6), time: "10:30", opponent: "Zebras FC", homeAway: "H", venue: "", availability: {}, ...over });
const training = (over = {}) => ({ id: "s1", title: "Training", kind: "training", recur: "weekly", weekday: new Date(daysFromNow(1) + "T00:00:00").getDay(),
  startISO: daysFromNow(-30), untilISO: daysFromNow(60), time: "16:30", endTime: "17:30", location: "Field 3", availability: {}, ...over });
const makeData = (over = {}) => ({
  team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", headCoach: "Byron" },
  players: kids, fixtures: [oxley(), zebras()], sessions: [], isSample: false, ...over
});
const hatOf = (role, ids = [], names = []) => {
  const hat = { role, playerIds: ids, playerNames: names };
  return { mode: "account", email: "x@example.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role, playerIds: ids, playerNames: names,
    hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: [] };
};
const stubFetch = (me = null) => fetch.mockImplementation((url) => {
  const u = String(url);
  if (me && u.includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
  if (u.includes("/api/rsvp") || u.includes("/api/duty")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
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
const chipIs = (label) => waitFor(() => expect(screen.getByRole("button", { name: "Viewing as" }).textContent).toBe(label));
const headerTitle = () => document.querySelector(".head .hname")?.textContent;
const headerKicker = () => document.querySelector(".head .hkick")?.textContent;
const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
const nav = (label) => fireEvent.click(within(screen.getByRole("navigation")).getByText(label));
const weekRow = (title) => [...document.querySelectorAll(".week .wk-row")].find((r) => r.querySelector(".wk-title").textContent === title);
const sheetEl = () => document.querySelector(".sheet");
const brief = (scope = sheetEl()) => scope.querySelector(".gb");
const sideLines = (scope = sheetEl()) => [...scope.querySelectorAll(".gb-side")].map((r) => [...r.children].map((c) => c.textContent));
const maps = (place) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);
const rsvpBodies = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/rsvp")).map((c) => JSON.parse(c[1].body));
// Every picture on the page is one of our own files, and the draw's logo address is nowhere in it.
const expectNoHotlink = () => {
  const srcs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"));
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.filter((s) => !s.startsWith("/crests/"))).toEqual([]);
  expect(document.body.innerHTML).not.toContain("images.example.com");
};

describe("the crest itself", () => {
  it("is the club's picture with nothing to read out, since the name is always beside it in words", () => {
    render(<Crest src="/crests/lions-fc.png" name="Lions FC" />);
    const img = document.querySelector("img.mcrest");
    expect(img.getAttribute("src")).toBe("/crests/lions-fc.png");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.classList.contains("ours")).toBe(false);
    fireEvent.error(img); // a picture that will not load leaves its space rather than a broken image
    expect(img.style.visibility).toBe("hidden");
  });

  it("with no artwork is a disc with the club's initials, kept from screen readers", () => {
    render(<Crest name="Northside Old Boys" className="x" discClass="x ph" />);
    const disc = document.querySelector(".x.ph");
    expect(disc.textContent).toBe("NO");
    expect(disc.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("img")).toBeNull();
  });

  it("ours falls back to the bundled club crest when the team's own logo will not load, and only then gives up", () => {
    render(<Crest src="/uploads/our-logo.png" name="Test FC" ours />);
    const img = document.querySelector("img.mcrest.ours");
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe("/crests/olympic-fc.png");
    expect(img.style.visibility).toBe("");
    fireEvent.error(img);
    expect(img.style.visibility).toBe("hidden");
  });

  it("the opposition's crest is found from the name on the fixture alone", () => {
    render(<><OppCrest name="Lions FC U9 Orange" className="a" discClass="a ph" /><OppCrest name="Zebras FC" className="b" discClass="b ph" /><OppCrest className="c" discClass="c ph" /></>);
    expect(document.querySelector("img.a").getAttribute("src")).toBe("/crests/lions-fc.png");
    expect(document.querySelector(".b.ph").textContent).toBe("ZF");
    expect(document.querySelector(".c.ph").textContent).toBe("?"); // an opponent not yet named
  });
});

describe("a game row (Home's next 7 days, the calendar list, a day's sheet)", () => {
  it("shows the opposition's crest where the trophy was: artwork when we have it, initials when we do not; training keeps its icon", async () => {
    await load(makeData({ sessions: [training()], fixtures: [oxley(), zebras(), zebras({ id: "f3", round: 9, dateISO: daysFromNow(5), opponent: "Lions FC", status: "cancelled" })] }));
    const ox = weekRow("vs Oxley United U9 Eagles");
    expect(ox.querySelector(".wk-ic.game.opp img.mcrest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(ox.querySelector("img.mcrest").getAttribute("alt")).toBe("");
    expect(ox.querySelector(".wk-ic svg")).toBeNull(); // no trophy beside the crest
    const zeb = weekRow("vs Zebras FC");
    expect(zeb.querySelector(".wk-ic.opp .mcrest.ph").textContent).toBe("ZF");
    expect(zeb.querySelector(".mcrest.ph").getAttribute("aria-hidden")).toBe("true");
    expect(zeb.querySelector("img")).toBeNull();
    // A cancelled game is still that club's game.
    const off = weekRow("vs Lions FC");
    expect(off.querySelector(".wk-title").className).toBe("wk-title off");
    expect(off.querySelector("img.mcrest").getAttribute("src")).toBe("/crests/lions-fc.png");
    const tr = weekRow("Training");
    expect(tr.querySelector(".wk-ic").className).toBe("wk-ic training");
    expect(tr.querySelector(".wk-ic svg")).toBeTruthy();
    expect(tr.querySelector(".mcrest")).toBeNull();
    expectNoHotlink();
  });

  it("the day's sheet on the calendar uses the same row", async () => {
    const today = isoLocal(new Date());
    await load(makeData({ fixtures: [oxley({ dateISO: today })] }));
    nav("Calendar");
    const cell = [...document.querySelectorAll(".cal-cell")][new Date().getDate() - 1];
    fireEvent.click(cell);
    const row = await waitFor(() => { const r = document.querySelector(".sheet .day-rows .wk-row"); expect(r).toBeTruthy(); return r; });
    expect(row.querySelector(".wk-ic.opp img.mcrest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(document.querySelector(".callist .wk-row .wk-ic.opp img.mcrest")).toBeTruthy(); // and the month's list under the grid
  });
});

describe("the reply sheet says who the game is against and where it is", () => {
  it("crest, opposition, date, time, home or away, the ground, and the way there; the reply itself is unchanged", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData());
    await chipIs("Parent of Sam");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    const b = brief();
    expect(b.className).toBe("gb");
    expect(b.querySelector("img.mcrest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(b.querySelector(".gb-title").textContent).toBe("vs Oxley United U9 Eagles");
    expect(b.querySelector(".gb-meta").textContent).toBe(`${fmtDate(daysFromNow(3))} · 09:00 · Away`);
    expect(b.querySelector(".gb-place .ng-place").textContent).toBe("Oxley Park – Field 2");
    const way = within(b).getByRole("link", { name: "Directions" });
    expect(way.getAttribute("href")).toBe(maps("Oxley Park – Field 2"));
    expect([way.getAttribute("target"), way.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    expect(b.querySelector(".gb-side")).toBeNull(); // one game, one place
    expectNoHotlink();
    fireEvent.click(within(sheetEl()).getByRole("button", { name: "In" }));
    await waitFor(() => expect(rsvpBodies()).toEqual([{ kind: "game", id: "f1", playerId: "p1", status: "in" }]));
  });

  it("a game with nowhere to play yet says so and offers no directions; one that is neither home nor away says neither", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [zebras()] }));
    await chipIs("Parent of Sam");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await screen.findByText("Reply for Sam", { selector: ".rs-title" });
    expect(brief().querySelector(".mcrest.ph").textContent).toBe("ZF");
    expect(brief().querySelector(".gb-meta").textContent).toBe(`${fmtDate(daysFromNow(6))} · 10:30 · Home`);
    expect(brief().querySelector(".gb-place .ng-place").textContent).toBe("Venue to be confirmed");
    expect(within(sheetEl()).queryByRole("link")).toBeNull();
    cleanup();
    await load(makeData({ fixtures: [zebras({ homeAway: undefined, time: "" })] }));
    await chipIs("Parent of Sam");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await screen.findByText("Reply for Sam", { selector: ".rs-title" });
    expect(brief().querySelector(".gb-meta").textContent).toBe(fmtDate(daysFromNow(6)));
  });

  it("training says where it is too, with its own icon rather than a crest", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [], sessions: [training()] }));
    await chipIs("Parent of Sam");
    fireEvent.click(weekRow("Training"));
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    await screen.findByText("Reply for Sam", { selector: ".rs-title" });
    expect(brief().querySelector(".gb-title").textContent).toBe("Training");
    expect(brief().querySelector(".gb-meta").textContent).toBe(`${fmtDate(daysFromNow(1))} · 16:30–17:30`);
    expect(brief().querySelector(".wk-ic.training svg")).toBeTruthy();
    expect(brief().querySelector(".mcrest")).toBeNull();
    expect(within(brief()).getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(maps("Field 3"));
  });

  it("training with no place set says nothing about where, rather than a dash", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [], sessions: [training({ location: "" })] }));
    await chipIs("Parent of Sam");
    fireEvent.click(weekRow("Training"));
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    await screen.findByText("Reply for Sam", { selector: ".rs-title" });
    expect(brief().querySelector(".gb-place")).toBeNull();
    expect(within(brief()).queryByRole("link")).toBeNull();
  });
});

describe("a paired round: one reply, two games, so the sheet says where each is", () => {
  const team = { name: "U9 Squad", division: "Div 1", ageGroup: "U9", coachPin: "", sides: ["Red", "White"] };
  const g = (id, side, over = {}) => ({ id, round: 7, side, status: "upcoming", dateISO: daysFromNow(5), time: "09:00", opponent: "Oxley United", homeAway: "H", venue: "Perry Park – Field 4C", availability: {}, ...over });
  const open = async (fixtures) => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ team, fixtures }));
    await chipIs("Parent of Sam");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await screen.findByText("Reply for Sam", { selector: ".rs-title" });
  };

  it("the same ground is named once, with directions, and each side has its kick-off and field, in the team's own order", async () => {
    await open([g("b", "White", { time: "10:30", venue: "Perry Park – Field 4A" }), g("a", "Red")]); // stored White first
    expect(brief().querySelector(".gb-title").textContent).toBe("vs Oxley United");
    expect(brief().querySelector(".gb-meta").textContent).toBe(`${fmtDate(daysFromNow(5))} · Home`); // the times are on the lines below
    expect(brief().querySelector(".gb-place .ng-place").textContent).toBe("Perry Park");
    expect(within(brief()).getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(maps("Perry Park"));
    expect(sideLines()).toEqual([["Red", "09:00", "Field 4C"], ["White", "10:30", "Field 4A"]]);
    expect(within(sheetEl()).getByText("Your reply covers both games this round.")).toBeTruthy();
  });

  it("two grounds are each named in full; a side with no time or ground yet says so; home and away are left out when the two differ", async () => {
    await open([g("a", "Red"), g("b", "White", { time: "", venue: "", homeAway: "A" })]);
    expect(brief().querySelector(".gb-meta").textContent).toBe(fmtDate(daysFromNow(5)));
    expect(brief().querySelector(".gb-place")).toBeNull(); // no one ground to point at
    expect(within(sheetEl()).queryByRole("link")).toBeNull();
    expect(sideLines()).toEqual([["Red", "09:00", "Perry Park – Field 4C"], ["White", "TBC", "Venue to be confirmed"]]);
    expect(brief().querySelector(".gb-sides").className).toBe("gb-sides first");
  });

  it("a duty belongs to one of the two games, so its sheet names that side and that field only", async () => {
    stubFetch(hatOf("coach"));
    await load(makeData({ team, fixtures: [g("a", "Red"), g("b", "White", { time: "10:30", venue: "Perry Park – Field 4A" })] }));
    await chipIs("Coach");
    fireEvent.click(screen.getByRole("button", { name: "Duties, White" }));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    const white = [...document.querySelectorAll(".ducard")].find((c) => c.querySelector(".sidetag")?.textContent === "White");
    fireEvent.click(within(white).getAllByText("Assign")[0]);
    await waitFor(() => expect(sheetEl()).toBeTruthy());
    expect(brief().querySelector(".gb-meta").textContent).toBe(`White · ${fmtDate(daysFromNow(5))} · 10:30 · Home`);
    expect(brief().querySelector(".gb-place .ng-place").textContent).toBe("Perry Park – Field 4A");
    expect(sideLines()).toEqual([]);
  });
});

describe("duties", () => {
  it("each game in the list has its crest beside the name; the name itself reads as before", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData());
    await chipIs("Parent of Sam");
    fireEvent.click(screen.getByRole("button", { name: "Duties" }));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    const heads = [...document.querySelectorAll(".ducard .du-head")];
    expect(heads.map((h) => h.querySelector(".du-opp").textContent)).toEqual(["vs Oxley United U9 Eagles", "vs Zebras FC"]);
    expect(heads[0].querySelector("img.du-crest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(heads[1].querySelector(".du-crest.ph").textContent).toBe("ZF");
    expect(document.querySelector(".head .hopp")).toBeNull(); // the list is about every game, so the header carries no one crest
    expectNoHotlink();
  });

  it("the sheet for taking a duty says who the game is against and where the fruit is going", async () => {
    stubFetch(hatOf("parent", ["p1", "p2"], ["Sam Smith", "Alex Smith"]));
    await load(makeData());
    await chipIs("Parent of Sam & Alex");
    fireEvent.click(screen.getByRole("button", { name: "Duties" }));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    fireEvent.click(within(document.querySelector(".ducard")).getByText("Fruit duty").closest(".du-slot"));
    await waitFor(() => expect(sheetEl()).toBeTruthy());
    expect(within(sheetEl()).getByText("Fruit duty · Round 7")).toBeTruthy();
    expect(brief().querySelector("img.mcrest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(brief().querySelector(".gb-title").textContent).toBe("vs Oxley United U9 Eagles");
    expect(brief().querySelector(".gb-meta").textContent).toBe(`${fmtDate(daysFromNow(3))} · 09:00 · Away`);
    expect(within(brief()).getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(maps("Oxley Park – Field 2"));
  });
});

describe("a player's own screen", () => {
  it("asks 'Is Sam playing?' under who the game is against and where; the label above still gives the round, date and time", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData());
    await chipIs("Parent of Sam");
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    fireEvent.click(document.querySelectorAll(".prow")[0]);
    await waitFor(() => expect(headerTitle()).not.toBe("Test FC"));
    const card = document.querySelector(".card.preply");
    expect(card.querySelector(".label").textContent).toBe(`Round 7 · ${fmtDate(daysFromNow(3))} · 09:00`);
    const b = brief(card);
    expect(b.className).toBe("gb plain");
    expect(b.querySelector("img.mcrest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(b.querySelector(".gb-title").textContent).toBe("vs Oxley United U9 Eagles");
    expect(b.querySelector(".gb-meta").textContent).toBe("Away"); // the date and time are in the label
    expect(within(b).getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(maps("Oxley Park – Field 2"));
    expect(card.querySelector(".rr-name").textContent).toBe("Is Sam playing?");
  });
});

describe("the header on a game's own screens", () => {
  it("carries the opposition's crest on the match screen and on Who's in for the game, and not once Who's in shows training", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    // Training the day before the game pairs with it on Who's in.
    await load(makeData({ fixtures: [oxley()], sessions: [training({ weekday: new Date(daysFromNow(2) + "T00:00:00").getDay() })] }));
    await chipIs("Parent of Sam");
    expect(document.querySelector(".head .hopp")).toBeNull(); // Home carries our own crest
    expect(document.querySelector(".head .hcrest")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
    expect(document.querySelector(".head img.hopp").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(headerKicker()).toBe(`vs Oxley United U9 Eagles · ${fmtDate(daysFromNow(3))}`);
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(document.querySelector(".head img.hopp").getAttribute("src")).toBe("/crests/oxley-united.png");
    const tabs = [...document.querySelectorAll(".wi-seg button")];
    expect(tabs).toHaveLength(2);
    fireEvent.click(tabs[1]); // Training
    await waitFor(() => expect(headerKicker()).toMatch(/^Training · /));
    expect(document.querySelector(".head .hopp")).toBeNull();
    fireEvent.click(tabs[0]);
    await waitFor(() => expect(document.querySelector(".head .hopp")).toBeTruthy());
    expectNoHotlink();
  });

  it("a club with no artwork gets its initials there, and the line under the title reads as before", async () => {
    await load(makeData({ fixtures: [zebras()] }));
    fireEvent.click(screen.getByText("Details"));
    await waitFor(() => expect(headerTitle()).toBe("Round 8"));
    expect(document.querySelector(".head .hopp.ph").textContent).toBe("ZF");
    expect(document.querySelector(".head .hopp.ph").getAttribute("aria-hidden")).toBe("true");
    expect(headerKicker()).toBe(`vs Zebras FC · ${fmtDate(daysFromNow(6))}`);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    expect(document.querySelector(".head .hopp")).toBeNull();
  });
});

describe("the match day planner's header line", () => {
  const data = { team: { name: "Test FC", ageGroup: "U9" }, players: kids, fixtures: [] };
  const fixture = (over = {}) => ({ id: "f1", round: 5, dateISO: "2026-09-01", time: "09:00", opponent: "Oxley United", homeAway: "H", venue: "Perry Park", status: "upcoming", availability: {}, ...over });
  const line = () => [...document.querySelectorAll(".mdp .truncate")].find((e) => /Round 5/.test(e.textContent));

  it("has the opposition's crest when we have its artwork, and only the name when we do not", () => {
    render(<MatchDayPlanner data={data} fixture={fixture({ opponentLogo: HOTLINK })} isCoach onSavePlan={vi.fn()} close={vi.fn()} />);
    expect(line().querySelector("img.md-crest").getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(line().querySelector("img.md-crest").getAttribute("alt")).toBe("");
    expect(line().textContent).toMatch(/^Round 5 vs Oxley United · /);
    expect(document.body.innerHTML).not.toContain("images.example.com");
    cleanup();
    render(<MatchDayPlanner data={data} fixture={fixture({ opponent: "Zebras FC", homeAway: "A" })} isCoach onSavePlan={vi.fn()} close={vi.fn()} />);
    expect(line().querySelector("img")).toBeNull();
    expect(line().textContent).toMatch(/^Round 5 @ Zebras FC · /);
  });
});

// The club logo library (lib/clubLogos.js): for a club with no artwork here,
// the logo Squadi or Dribl gives it, which the server puts on each game it
// sends (opponentCrest). Built-in artwork always comes first.
describe("a club with no artwork, and the logo the club logo library found for it", () => {
  const FOUND = "https://cdn.dribl.com/clubs/zebras.png";
  const SQUADI_CLUB = "https://storage.googleapis.com/download/storage/v1/b/squadi-prod.appspot.com/o/organisation%2Flogo_org_41_1700000001.jpg?generation=1700000002&alt=media";
  const drawn = (scope, cls) => scope.querySelector(`img.${cls}.drawn`);

  it("shows the found logo wherever the game is named, fitted on white and asked for without a referrer", async () => {
    stubFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [oxley(), zebras({ opponentCrest: FOUND })] }));
    await chipIs("Parent of Sam");
    const img = drawn(weekRow("vs Zebras FC"), "mcrest");
    expect(img.getAttribute("src")).toBe(FOUND);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("alt")).toBe("");
    // The built-in crest is untouched beside it.
    const ox = weekRow("vs Oxley United U9 Eagles").querySelector("img.mcrest");
    expect([ox.getAttribute("src"), ox.className]).toEqual(["/crests/oxley-united.png", "mcrest"]);
    fireEvent.click(screen.getByRole("button", { name: "Duties" }));
    await waitFor(() => expect(headerTitle()).toBe("Duties"));
    expect(drawn(document.querySelectorAll(".ducard .du-head")[1], "du-crest").getAttribute("src")).toBe(FOUND);
  });

  it("on the next-game card, the match screen's header, the Results list and the calendar too", async () => {
    await load(makeData({ fixtures: [zebras({ opponentCrest: FOUND, dateISO: isoLocal(new Date()) })] }));
    expect(drawn(document, "mu-crest").getAttribute("src")).toBe(FOUND);
    fireEvent.click(screen.getByText("Details"));
    await waitFor(() => expect(headerTitle()).toBe("Round 8"));
    expect(drawn(document.querySelector(".head"), "hopp").getAttribute("src")).toBe(FOUND);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    nav("Results");
    await waitFor(() => expect(document.querySelector(".reslist")).toBeTruthy());
    // The game is still to come, so it is in the Fixtures card under Results.
    expect(document.querySelector(".reslist img.mcrest.drawn").getAttribute("src")).toBe(FOUND);
    nav("Calendar");
    await waitFor(() => expect(document.querySelector(".cal-crest")).toBeTruthy());
    expect(drawn(document, "cal-crest").getAttribute("src")).toBe(FOUND);
  });

  it("keeps the initials when the library found nothing, even if the game carries a logo", async () => {
    await load(makeData({ fixtures: [zebras({ opponentCrest: null, opponentLogo: SQUADI_CLUB })] }));
    expect(weekRow("vs Zebras FC").querySelector(".mcrest.ph").textContent).toBe("ZF");
    expect(weekRow("vs Zebras FC").querySelector("img")).toBeNull();
  });

  it("shows the game's own Squadi club logo when the page came without the library's choice", async () => {
    await load(makeData({ fixtures: [zebras({ opponentLogo: SQUADI_CLUB })] }));
    expect(drawn(weekRow("vs Zebras FC"), "mcrest").getAttribute("src")).toBe(SQUADI_CLUB);
  });

  it("gives way to the initials when the logo will not load", async () => {
    await load(makeData({ fixtures: [zebras({ opponentCrest: FOUND })] }));
    fireEvent.error(drawn(weekRow("vs Zebras FC"), "mcrest"));
    await waitFor(() => expect(weekRow("vs Zebras FC").querySelector(".mcrest.ph").textContent).toBe("ZF"));
  });
});

describe("the match day planner's header line, with a found logo", () => {
  it("fits the found logo beside the opposition's name, asked for without a referrer", () => {
    const data = { team: { name: "Test FC", ageGroup: "U9" }, players: kids, fixtures: [] };
    const fx = { id: "f1", round: 5, dateISO: "2026-09-01", time: "09:00", opponent: "Zebras FC", homeAway: "H", venue: "Perry Park", status: "upcoming", availability: {}, opponentCrest: "https://cdn.dribl.com/clubs/zebras.png" };
    render(<MatchDayPlanner data={data} fixture={fx} isCoach onSavePlan={vi.fn()} close={vi.fn()} />);
    const img = document.querySelector(".mdp img.md-crest.drawn");
    expect([img.getAttribute("src"), img.getAttribute("referrerpolicy")]).toEqual(["https://cdn.dribl.com/clubs/zebras.png", "no-referrer"]);
  });
});
