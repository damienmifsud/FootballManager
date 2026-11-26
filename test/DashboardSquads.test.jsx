// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";
import { joinNames } from "@/lib/hats";

// Competition squads in the dashboard: a game in a competition with a picked
// squad (data.competitionSquads) is for those players only, and the coach
// picks the squad in Team settings. These render the real component in jsdom,
// like test/Dashboard.test.jsx; they sit in a file of their own so that file
// is not where every dashboard change meets.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

// Dates relative to "today" so "next game" and past/upcoming hold whenever the suite runs.
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };

const kids = [
  { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
  { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
  { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
];
const WINTER = { comp: "cwinter", compName: "Winterfest" };
// A season game in five days and a Winterfest game in three: Winterfest is the sooner.
const season = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: daysFromNow(5), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
const winter = (over = {}) => ({ id: "w2", round: 2, status: "upcoming", dateISO: daysFromNow(3), time: "10:30", opponent: "Lions", homeAway: "A", venue: "Lion Park", availability: {}, ...WINTER, ...over });
// Sam and Milo are going to Winterfest; Alex is not.
const SQUAD = { cwinter: ["p1", "p3"] };

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", assistantCoach: "Dee" },
    players: kids,
    fixtures: [season(), winter()],
    sessions: [],
    competitionSquads: SQUAD,
    isSample: false,
    ...over
  };
}

// /api/me payloads in the hat-picker shape.
const parentOf = (ids, names) => {
  const hat = { role: "parent", playerIds: ids, playerNames: names };
  return {
    mode: "account", email: "mum@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role: "parent",
    playerIds: ids, playerNames: names, hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: []
  };
};
const COMPS = [{ id: "cwinter", name: "Winterfest", playerIds: null }, { id: "cprem", name: "Premier Invitational", playerIds: null }];
// The route's answer to a save: what it stored (null for everyone, and for a list that leaves nobody).
const echo = (body) => Promise.resolve({ ok: true, json: async () => ({ ok: true, comp: body.comp, playerIds: body.playerIds && body.playerIds.length ? body.playerIds : null }) });

// fetch under test: /api/me answers with `me` (absent: the legacy team-code
// view); /api/competition-squad lists `comps` and hands a save to `save`.
// Everything else is "not found", as in the other dashboard test files.
function stubFetch({ me = null, comps = null, save = null } = {}) {
  fetch.mockImplementation((url, init) => {
    const u = String(url);
    if (me && u.includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
    if (u.includes("/api/competition-squad")) {
      if (init?.method === "POST") return save ? save(JSON.parse(init.body)) : Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      if (comps) return Promise.resolve({ ok: true, json: async () => ({ competitions: comps }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}
const savesSent = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/competition-squad") && c[1]?.method === "POST").map((c) => JSON.parse(c[1].body));

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  vi.stubGlobal("fetch", vi.fn());
  stubFetch();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

// The header hat chip is only present once data has loaded.
const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const chip = () => screen.getByRole("button", { name: "Viewing as" });
const expectChip = (label) => waitFor(() => expect(chip().textContent).toBe(label));
const headerTitle = () => document.querySelector(".head .hname")?.textContent;
const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
// Legacy (team-code) mode: coach mode is entered from the Viewing-as sheet.
const enterCoachMode = async () => {
  fireEvent.click(await waitForLoaded());
  fireEvent.click(await screen.findByText("Coach mode"));
  await expectChip("Coach");
};
const asCoach = async (data) => { await load(data); await enterCoachMode(); };
const asParent = async (data, ids, names) => {
  stubFetch({ me: parentOf(ids, names) });
  await load(data);
  await expectChip(`Parent of ${joinNames(names)}`);
};
const nav = (label) => fireEvent.click(within(screen.getByRole("navigation")).getByText(label));
const cpills = () => [...document.querySelectorAll(".ng-counts .cpill")].map((e) => e.textContent);
const ngLabel = () => document.querySelector(".ng-label").textContent;
const homeReplyRows = () => [...document.querySelectorAll(".ng .replyrow .rr-name, .card .replyrows .rr-name")].map((e) => e.textContent);
const weekRow = (opponent) => [...document.querySelectorAll(".wk-row")].find((r) => r.textContent.includes(opponent));
const weekPills = (opponent) => [...weekRow(opponent).querySelectorAll(".wk-pill")].map((e) => e.textContent);
const resCard = (label) => screen.getByText(label, { selector: ".label" }).closest(".card");
const openGame = async (opponent, title) => {
  nav("Results");
  fireEvent.click([...resCard("Fixtures").querySelectorAll(".mrow")].find((r) => r.textContent.includes(opponent)));
  await waitFor(() => expect(headerTitle()).toBe(title));
};
const squadNote = () => document.querySelector(".squadnote")?.textContent || null;

describe("Competition squads — who a game is for", () => {
  it("home, coach: the next game's counts and its row in the week are over its squad, not the whole team", async () => {
    // Sam (in the squad) is in; Alex's reply was given before the squad was picked and no longer counts.
    await asCoach(makeData({ fixtures: [season(), winter({ availability: { p1: { status: "in" }, p2: { status: "in" } } })] }));
    expect(ngLabel()).toBe("Next game · Winterfest · Round 2 · Away");
    expect(cpills()).toEqual(["1 in", "0 out", "1 no reply"]);
    expect(weekPills("Lions")).toEqual(["1 in · 1 to reply"]);
    // The season game beside it is still for everyone.
    expect(weekPills("Wests")).toEqual(["0 in · 3 to reply"]);
    expect(squadNote()).toBeNull();
  });

  it("with no squad picked, a competition's game is for everyone, as it was", async () => {
    await asCoach(makeData({ competitionSquads: undefined }));
    expect(cpills()).toEqual(["0 in", "0 out", "3 no reply"]);
    expect(weekPills("Lions")).toEqual(["0 in · 3 to reply"]);
    // A squad picked for another competition changes nothing here.
    cleanup();
    await asCoach(makeData({ competitionSquads: { ccup: ["p1"] } }));
    expect(cpills()).toEqual(["0 in", "0 out", "3 no reply"]);
  });

  it("a squad nobody on the team is in any more is everyone again, never no one", async () => {
    await asCoach(makeData({ competitionSquads: { cwinter: ["deleted-1", "deleted-2"] } }));
    expect(cpills()).toEqual(["0 in", "0 out", "3 no reply"]);
    expect(weekPills("Lions")).toEqual(["0 in · 3 to reply"]);
  });

  it("home, a family whose child is in the squad: asked to reply for the competition's game", async () => {
    await asParent(makeData(), ["p1"], ["Sam Smith"]);
    expect(ngLabel()).toBe("Next game · Winterfest · Round 2 · Away");
    expect(homeReplyRows()).toEqual(["Sam S."]);
    expect(screen.getByText("Reply for Sam")).toBeTruthy();
    expect(squadNote()).toBeNull();
    expect(weekPills("Lions")).toEqual(["No reply"]);
  });

  it("home, a family whose child is not in the squad: their next game is the next one their child is part of", async () => {
    await asParent(makeData(), ["p2"], ["Alex Smith"]);
    // Winterfest is sooner, but Alex is not going: the card is about round 7.
    expect(ngLabel()).toBe("Next game · Round 7 · Home");
    expect(homeReplyRows()).toEqual(["Alex S."]);
    expect(squadNote()).toBeNull();
    // The Winterfest game is still on the week's list, with the squad's tally and no reply asked of them.
    expect(weekPills("Lions")).toEqual(["0 in · 2 to reply"]);
    expect(weekPills("Wests")).toEqual(["No reply"]);
  });

  it("home, that family when only the competition's games are left: the game shows, with the reason they are not asked", async () => {
    await asParent(makeData({ fixtures: [winter()] }), ["p2"], ["Alex Smith"]);
    expect(ngLabel()).toBe("Next game · Winterfest · Round 2 · Away");
    expect(homeReplyRows()).toEqual([]);
    expect(cpills()).toEqual(["0 in", "0 out", "2 no reply"]);
    expect(squadNote()).toBe("Alex isn't in the Winterfest squad.");
    expect(document.querySelector(".squadnote").className).toBe("note squadnote");
  });

  it("home, two children with one in the squad: a reply row for that child and a line naming the other", async () => {
    await asParent(makeData(), ["p1", "p2"], ["Sam Smith", "Alex Smith"]);
    expect(ngLabel()).toBe("Next game · Winterfest · Round 2 · Away");
    expect(homeReplyRows()).toEqual(["Sam S."]);
    expect(squadNote()).toBe("Alex isn't in the Winterfest squad.");
    expect(weekPills("Lions")).toEqual(["No reply"]);
    // Neither child in it: both are named.
    cleanup();
    await asParent(makeData({ fixtures: [winter()], competitionSquads: { cwinter: ["p3"] } }), ["p1", "p2"], ["Sam Smith", "Alex Smith"]);
    expect(homeReplyRows()).toEqual([]);
    expect(squadNote()).toBe("Sam and Alex aren't in the Winterfest squad.");
  });

  it("match screen and Who's in: counts, reply rows and the list are the squad's", async () => {
    await asParent(makeData(), ["p1", "p2"], ["Sam Smith", "Alex Smith"]);
    await openGame("Lions", "Winterfest · Round 2");
    expect(document.querySelector(".whosin .wi-count").textContent).toBe("0 in · 0 out · 2 no reply");
    expect([...document.querySelectorAll(".whosin .replyrow .rr-name")].map((e) => e.textContent)).toEqual(["Sam S."]);
    expect(document.querySelector(".whosin .squadnote").textContent).toBe("Alex isn't in the Winterfest squad.");
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect([...document.querySelectorAll(".av-row .av-name span:first-child")].map((e) => e.textContent)).toEqual(["Sam Smith", "Milo Park"]);
    expect([...document.querySelectorAll(".wi-tile .v")].map((e) => e.textContent)).toEqual(["0", "0", "2"]);
    // Only the child who is on the list can be replied for, and the footer says so.
    expect(document.querySelectorAll(".av-row .rr-btn")).toHaveLength(1);
    expect(document.querySelector(".wi-foot").textContent).toBe("You can reply for Sam. Coaches can reply for anyone.");
  });

  it("match screen, a family with no child in the squad: no reply row, the reason, and the same on Who's in", async () => {
    await asParent(makeData(), ["p2"], ["Alex Smith"]);
    await openGame("Lions", "Winterfest · Round 2");
    expect(document.querySelector(".whosin .replyrow")).toBeNull();
    expect(document.querySelector(".whosin .squadnote").textContent).toBe("Alex isn't in the Winterfest squad.");
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(document.querySelector(".av-row .rr-btn")).toBeNull();
    expect(document.querySelector(".wi-foot").textContent).toBe("Alex isn't in the Winterfest squad.");
    expect(screen.queryByText(/You can reply for/)).toBeNull();
  });

  it("the season game beside it is untouched: everyone is counted, asked and listed", async () => {
    await asParent(makeData(), ["p2"], ["Alex Smith"]);
    await openGame("Wests", "Round 7");
    expect(document.querySelector(".whosin .wi-count").textContent).toBe("0 in · 0 out · 3 no reply");
    expect([...document.querySelectorAll(".whosin .replyrow .rr-name")].map((e) => e.textContent)).toEqual(["Alex S."]);
    expect(squadNote()).toBeNull();
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(document.querySelectorAll(".av-row")).toHaveLength(3);
    expect(document.querySelector(".wi-foot").textContent).toBe("You can reply for Alex. Coaches can reply for anyone.");
  });

  it("who's in, coach: marks replies for the squad only, and the reminder names only them", async () => {
    await asCoach(makeData());
    await openGame("Lions", "Winterfest · Round 2");
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect([...document.querySelectorAll(".av-row .av-name span:first-child")].map((e) => e.textContent)).toEqual(["Sam Smith", "Milo Park"]);
    expect(document.querySelectorAll(".av-row .av-seg")).toHaveLength(2);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(screen.getByRole("button", { name: /Nudge|Remind/ }));
    const sent = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(sent).toMatch(/Winterfest · Round 2 vs Lions/);
    expect(sent).toMatch(/Sam and Milo/);
    expect(sent).not.toMatch(/Alex/);
    open.mockRestore();
  });

  it("squad tab, coach: a reply button for the next game only on the players it is for", async () => {
    await asCoach(makeData());
    nav("Squad");
    await screen.findByText("Sam Smith");
    const rows = Object.fromEntries([...document.querySelectorAll(".prow")].map((r) => [r.querySelector(".pr-name b").textContent, !!r.querySelector(".rr-btn")]));
    expect(rows).toEqual({ "Sam Smith": true, "Alex Smith": false, "Milo Park": true });
  });

  it("player screen, coach: the reply for the next game is offered only for a player it is for", async () => {
    await asCoach(makeData());
    nav("Squad");
    fireEvent.click((await screen.findByText("Sam Smith")).closest(".prow"));
    await waitFor(() => expect(headerTitle()).toBe("Sam Smith"));
    expect(document.querySelector(".preply .label").textContent).toMatch(/^Winterfest · Round 2 · /);
    expect(screen.getByText("Is Sam playing?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click((await screen.findByText("Alex Smith")).closest(".prow"));
    await waitFor(() => expect(headerTitle()).toBe("Alex Smith"));
    expect(document.querySelector(".preply")).toBeNull();
    expect(screen.queryByText("Is Alex playing?")).toBeNull();
  });

  it("player screen, a family whose child is not in the squad: asked about the next game their child is part of", async () => {
    await asParent(makeData(), ["p2"], ["Alex Smith"]);
    nav("Squad");
    fireEvent.click((await screen.findByText("Alex Smith")).closest(".prow"));
    await waitFor(() => expect(headerTitle()).toBe("Alex Smith"));
    expect(document.querySelector(".preply .label").textContent).toMatch(/^Round 7 · /);
    expect(screen.getByText("Is Alex playing?")).toBeTruthy();
  });

  it("duty sheet, a family with children in and out of the squad: only those in it are offered, and the fruit is for the squad", async () => {
    await asParent(makeData(), ["p1", "p2", "p3"], ["Sam Smith", "Alex Smith", "Milo Park"]);
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    const lions = [...document.querySelectorAll(".ducard")].find((c) => c.querySelector(".du-opp").textContent.includes("Lions"));
    fireEvent.click(within(lions).getAllByRole("button", { name: "I'll do it" })[0]);
    const radios = await screen.findByRole("radiogroup", { name: "Whose family" });
    expect(within(radios).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Sam S.'s family", "Milo P.'s family"]);
    expect(screen.getByText(/Half-time fruit for 2 kids/)).toBeTruthy();
  });

  it("duties: a family volunteers only for a game their child is in, and the coach assigns from the squad", async () => {
    await asParent(makeData(), ["p2"], ["Alex Smith"]);
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    const card = (opponent) => [...document.querySelectorAll(".ducard")].find((c) => c.querySelector(".du-opp").textContent.includes(opponent));
    expect(card("Lions").querySelector(".du-claim")).toBeNull();
    expect(card("Wests").querySelector(".du-claim")).toBeTruthy();
    cleanup();
    stubFetch();
    await asCoach(makeData());
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    fireEvent.click(card("Lions").querySelector(".du-slot.tap"));
    await waitFor(() => expect(document.querySelector(".ds-list")).toBeTruthy());
    expect([...document.querySelectorAll(".ds-row .ds-name")].map((e) => e.textContent.replace(/'s family$/, ""))).toEqual(["Sam Smith", "Milo Park"]);
  });
});

describe("Settings — competition squads", () => {
  const openSettings = async () => {
    fireEvent.click(chip());
    fireEvent.click(await screen.findByText("Team settings"));
    await screen.findByText("Team details");
  };
  const sw = (name) => screen.getByRole("switch", { name });
  const isOn = (name) => sw(name).getAttribute("aria-checked") === "true";
  const everyone = (comp) => `Everyone is in the ${comp} squad`;
  const inSquadSw = (player, comp) => `${player} is in the ${comp} squad`;
  const block = (comp) => screen.getByText(comp, { selector: ".sq-name" }).closest(".sq-comp");
  const meta = (comp) => block(comp).querySelector(".sq-meta").textContent;
  const coachSettings = async (data, opts) => {
    stubFetch(opts);
    await asCoach(data);
    await openSettings();
  };

  it("lists the team's competitions, everyone in each until a squad is picked", async () => {
    await coachSettings(makeData({ competitionSquads: undefined }), { comps: COMPS, save: echo });
    expect(await screen.findByText("Competition squads")).toBeTruthy();
    expect(screen.getByText("Who is going to each competition. Only those players are asked to reply and counted for its games. The season is always everyone.")).toBeTruthy();
    expect([...document.querySelectorAll(".sq-name")].map((e) => e.textContent)).toEqual(["Winterfest", "Premier Invitational"]);
    expect(meta("Winterfest")).toBe("Everyone");
    expect(isOn(everyone("Winterfest"))).toBe(true);
    expect(isOn(everyone("Premier Invitational"))).toBe(true);
    // No player switches until a squad is being picked.
    expect(screen.queryByRole("switch", { name: /Sam Smith is in/ })).toBeNull();
    expect(savesSent()).toEqual([]);
  });

  it("shows a squad already picked: who is in, who is not, and the count", async () => {
    await coachSettings(makeData(), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    expect(meta("Winterfest")).toBe("2 of 3 players");
    expect(isOn(everyone("Winterfest"))).toBe(false);
    expect([inSquadSw("Sam Smith", "Winterfest"), inSquadSw("Alex Smith", "Winterfest"), inSquadSw("Milo Park", "Winterfest")].map(isOn)).toEqual([true, false, true]);
    // The other competition is untouched by it.
    expect(meta("Premier Invitational")).toBe("Everyone");
    expect(screen.queryByRole("switch", { name: /is in the Premier Invitational squad$/, checked: false })).toBeNull();
  });

  it("turning Everyone off starts a squad with every player in it; a player's switch then takes them out", async () => {
    await coachSettings(makeData({ competitionSquads: undefined }), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(everyone("Winterfest")));
    await waitFor(() => expect(savesSent()).toEqual([{ comp: "cwinter", playerIds: ["p1", "p2", "p3"] }]));
    await waitFor(() => expect(meta("Winterfest")).toBe("3 of 3 players"));
    expect(isOn(everyone("Winterfest"))).toBe(false);
    expect(isOn(inSquadSw("Alex Smith", "Winterfest"))).toBe(true);

    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    await waitFor(() => expect(savesSent()).toHaveLength(2));
    expect(savesSent()[1]).toEqual({ comp: "cwinter", playerIds: ["p1", "p3"] });
    await waitFor(() => expect(meta("Winterfest")).toBe("2 of 3 players"));
    expect(isOn(inSquadSw("Alex Smith", "Winterfest"))).toBe(false);
    // Only this competition's squad was sent, and never the whole document.
    expect(Object.keys(savesSent()[1]).sort()).toEqual(["comp", "playerIds"]);
    expect(storage.set).not.toHaveBeenCalled();
    expect(meta("Premier Invitational")).toBe("Everyone");
  });

  it("a player's switch puts them back in, in the team's order", async () => {
    await coachSettings(makeData({ competitionSquads: { cwinter: ["p3"] } }), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Sam Smith", "Winterfest")));
    await waitFor(() => expect(savesSent()).toEqual([{ comp: "cwinter", playerIds: ["p1", "p3"] }]));
    await waitFor(() => expect(meta("Winterfest")).toBe("2 of 3 players"));
  });

  it("turning Everyone back on sends null and puts the player switches away", async () => {
    await coachSettings(makeData(), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(everyone("Winterfest")));
    await waitFor(() => expect(savesSent()).toEqual([{ comp: "cwinter", playerIds: null }]));
    await waitFor(() => expect(meta("Winterfest")).toBe("Everyone"));
    expect(isOn(everyone("Winterfest"))).toBe(true);
    expect(screen.queryByRole("switch", { name: /Sam Smith is in/ })).toBeNull();
  });

  it("taking the last player out is everyone again: a competition is never for no one", async () => {
    await coachSettings(makeData({ competitionSquads: { cwinter: ["p1"] } }), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    expect(meta("Winterfest")).toBe("1 of 3 players");
    fireEvent.click(sw(inSquadSw("Sam Smith", "Winterfest")));
    await waitFor(() => expect(savesSent()).toEqual([{ comp: "cwinter", playerIds: [] }]));
    await waitFor(() => expect(meta("Winterfest")).toBe("Everyone"));
    expect(isOn(everyone("Winterfest"))).toBe(true);
  });

  it("shows what the server stored when that differs from what was sent", async () => {
    // Milo was removed from the team in another tab: the route drops him from the squad it stores.
    const save = (body) => Promise.resolve({ ok: true, json: async () => ({ ok: true, comp: body.comp, playerIds: ["p1"] }) });
    await coachSettings(makeData({ competitionSquads: { cwinter: ["p3"] } }), { comps: COMPS, save });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Sam Smith", "Winterfest")));
    await waitFor(() => expect(meta("Winterfest")).toBe("1 of 3 players"));
    expect(isOn(inSquadSw("Sam Smith", "Winterfest"))).toBe(true);
    expect(isOn(inSquadSw("Milo Park", "Winterfest"))).toBe(false);
  });

  it("the rest of the app follows the pick straight away", async () => {
    await coachSettings(makeData({ competitionSquads: undefined }), { comps: COMPS, save: echo });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(everyone("Winterfest")));
    await waitFor(() => expect(meta("Winterfest")).toBe("3 of 3 players"));
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    await waitFor(() => expect(meta("Winterfest")).toBe("2 of 3 players"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(document.querySelector(".ng-label")).toBeTruthy());
    expect(cpills()).toEqual(["0 in", "0 out", "2 no reply"]);
  });

  it("puts the switch back and says so when the save fails", async () => {
    // No `save`: the route answers 500.
    await coachSettings(makeData(), { comps: COMPS });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    expect(await screen.findByText("Couldn't save — try again.")).toBeTruthy();
    expect(isOn(inSquadSw("Alex Smith", "Winterfest"))).toBe(false);
    expect(meta("Winterfest")).toBe("2 of 3 players");
    // The next attempt clears the message while it is tried.
    stubFetch({ comps: COMPS, save: echo });
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    await waitFor(() => expect(screen.queryByText("Couldn't save — try again.")).toBeNull());
    await waitFor(() => expect(meta("Winterfest")).toBe("3 of 3 players"));
  });

  it("shows the server's sentence when the save is refused (read-only view, or not a coach)", async () => {
    const refuse = () => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Only coaches can pick a squad." }) });
    await coachSettings(makeData(), { comps: COMPS, save: refuse });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(everyone("Winterfest")));
    expect(await screen.findByText("Only coaches can pick a squad.")).toBeTruthy();
    expect(isOn(everyone("Winterfest"))).toBe(false);
    expect(meta("Winterfest")).toBe("2 of 3 players");
  });

  it("several switches in a row are sent one at a time, each carrying the newest pick", async () => {
    // The first save is held open; two more switches are flipped before it answers.
    let release;
    const held = new Promise((r) => { release = r; });
    let n = 0;
    const save = (body) => (++n === 1 ? held.then(() => echo(body)) : echo(body));
    await coachSettings(makeData({ competitionSquads: { cwinter: ["p1", "p2", "p3"] } }), { comps: COMPS, save });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    fireEvent.click(sw(inSquadSw("Milo Park", "Winterfest")));
    // Both show at once...
    expect(meta("Winterfest")).toBe("1 of 3 players");
    // ...but only the first has been sent.
    expect(savesSent()).toEqual([{ comp: "cwinter", playerIds: ["p1", "p3"] }]);
    await act(async () => { release(); await held; });
    // The second goes once the first has answered, with both changes in it.
    await waitFor(() => expect(savesSent()).toHaveLength(2));
    expect(savesSent()[1]).toEqual({ comp: "cwinter", playerIds: ["p1"] });
    await waitFor(() => expect(meta("Winterfest")).toBe("1 of 3 players"));
    expect(isOn(inSquadSw("Sam Smith", "Winterfest"))).toBe(true);
    expect(isOn(inSquadSw("Alex Smith", "Winterfest"))).toBe(false);
    expect(isOn(inSquadSw("Milo Park", "Winterfest"))).toBe(false);
    expect(screen.queryByText("Couldn't save — try again.")).toBeNull();
  });

  it("when a save fails with another waiting behind it, the list goes back to what is stored and nothing more is sent", async () => {
    let fail;
    const held = new Promise((_, reject) => { fail = reject; });
    const save = () => held;
    await coachSettings(makeData({ competitionSquads: { cwinter: ["p1", "p2", "p3"] } }), { comps: COMPS, save });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest")));
    fireEvent.click(sw(inSquadSw("Milo Park", "Winterfest")));
    expect(meta("Winterfest")).toBe("1 of 3 players");
    await act(async () => { fail(new Error("offline")); await held.catch(() => {}); });
    expect(await screen.findByText("Couldn't save — try again.")).toBeTruthy();
    expect(meta("Winterfest")).toBe("3 of 3 players");
    expect(savesSent()).toHaveLength(1);
  });

  it("one competition's saves do not wait on another's", async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    const save = (body) => (body.comp === "cwinter" ? held.then(() => echo(body)) : echo(body));
    await coachSettings(makeData(), { comps: COMPS, save });
    await screen.findByText("Competition squads");
    fireEvent.click(sw(inSquadSw("Alex Smith", "Winterfest"))); // held open
    fireEvent.click(sw(everyone("Premier Invitational")));
    await waitFor(() => expect(savesSent()).toHaveLength(2));
    expect(savesSent()[1]).toEqual({ comp: "cprem", playerIds: ["p1", "p2", "p3"] });
    await waitFor(() => expect(meta("Premier Invitational")).toBe("3 of 3 players"));
    await act(async () => { release(); await held; });
    await waitFor(() => expect(meta("Winterfest")).toBe("3 of 3 players"));
  });

  it("a team with no other competition has no card; nor does one whose competitions could not be read", async () => {
    await coachSettings(makeData(), { comps: [] });
    await screen.findByText("Parents can see");
    expect(screen.queryByText("Competition squads")).toBeNull();
    cleanup();
    await coachSettings(makeData(), {}); // the read fails
    await screen.findByText("Parents can see");
    expect(screen.queryByText("Competition squads")).toBeNull();
  });
});
