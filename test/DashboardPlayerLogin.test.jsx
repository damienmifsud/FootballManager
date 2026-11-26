// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";

// Player logins in the dashboard: the coach's field for a player's own email,
// and what someone signed in with that email sees. They wear the same family
// hat a parent does (role "parent" from /api/me) with their own record listed
// in selfIds, so the screens say "you" where a parent reads their child's
// name. These render the real component in jsdom, like
// test/Dashboard.test.jsx, in a file of their own.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const weekday = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long" });

const SQUAD = [
  { id: "p1", name: "Jo P.", surname: "Park", number: 7, position: "FWD", email: "jo@example.com" },
  { id: "p2", name: "Leo P.", surname: "Park", number: 8, position: "MID", guardians: [{ name: "Jo Park", mobile: "0400 000 001", email: "jo@example.com" }], parentEmails: ["jo@example.com"] },
  { id: "p3", name: "Kim L.", surname: "Lane", number: 9, position: "DEF" }
];
const game = (over = {}) => ({ id: "f1", round: 7, status: "upcoming", dateISO: daysFromNow(5), time: "19:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });

function makeData(over = {}) {
  return {
    team: { name: "Fast Fives", division: "Social", ageGroup: "Seniors", coachPin: "", headCoach: "Byron" },
    players: SQUAD, fixtures: [game()], sessions: [], isSample: false, ...over
  };
}

// /api/me in the shape the route sends (lib/hats hats).
const coachHat = { role: "coach", playerIds: [], playerNames: [] };
const familyHat = (ids, names, selfIds) => ({ role: "parent", playerIds: ids, playerNames: names, ...(selfIds ? { selfIds } : {}) });
const account = (hats, role = hats[0].role) => {
  const worn = hats.find((h) => h.role === role) || hats[0];
  return {
    mode: "account", email: "jo@example.com", admin: false, clubAdmin: false, teamSlug: "ff", teamName: "Fast Fives", role: worn.role,
    playerIds: worn.playerIds, playerNames: worn.playerNames, ...(worn.selfIds ? { selfIds: worn.selfIds } : {}),
    hats, teams: [{ teamSlug: "ff", teamName: "Fast Fives", hats, mine: true }], canSwitch: hats.length > 1, memberships: []
  };
};
const PLAYER = account([familyHat(["p1"], ["Jo P."], ["p1"])]);
const PLAYER_AND_PARENT = account([familyHat(["p1", "p2"], ["Jo P.", "Leo P."], ["p1"])]);
const COACH = account([coachHat]);

let storage;
let routes; // what the narrow routes answer: { rsvp: true | false, duty: { ok, status, json } }
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  routes = { rsvp: true, duty: { ok: true, status: 200, json: { ok: true } } };
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

const signIn = (me) => fetch.mockImplementation((url) => {
  const u = String(url);
  if (me && u.includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
  if (u.includes("/api/rsvp")) return Promise.resolve({ ok: routes.rsvp, status: routes.rsvp ? 200 : 403, json: async () => ({ ok: routes.rsvp }) });
  if (u.includes("/api/duty")) return Promise.resolve({ ok: routes.duty.ok, status: routes.duty.status, json: async () => routes.duty.json });
  return Promise.resolve({ ok: false, json: async () => ({}) });
});
const bodies = (path) => fetch.mock.calls.filter((c) => String(c[0]).includes(path)).map((c) => JSON.parse(c[1].body));

const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const chip = () => screen.getByRole("button", { name: "Viewing as" });
const expectChip = (label) => waitFor(() => expect(chip().textContent).toBe(label));
const headerTitle = () => document.querySelector(".head .hname")?.textContent;
const load = async (me, data = makeData()) => {
  signIn(me);
  storage.get.mockResolvedValue({ value: JSON.stringify(data) });
  render(<App />);
  await waitForLoaded();
};
const nav = (label) => fireEvent.click(within(screen.getByRole("navigation")).getByText(label));
const sheet = () => within(document.querySelector(".sheet"));
const saved = () => JSON.parse(storage.set.mock.calls.at(-1)[1]);
const replyRows = () => [...document.querySelectorAll(".replyrow")];
const rowText = (row) => [row.querySelector(".rr-name").textContent, row.querySelector(".rr-hint").textContent, row.querySelector(".rr-btn").textContent];
const openPlayer = async (fullName) => {
  nav("Squad");
  fireEvent.click((await screen.findByText(fullName, { selector: ".pr-name b" })).closest(".prow"));
  await waitFor(() => expect(headerTitle()).toBe(fullName));
};
const openEditor = async (fullName) => {
  await openPlayer(fullName);
  fireEvent.click(screen.getByText("Edit", { selector: ".ph-edit" }));
  await screen.findByText("Edit player", { selector: ".sheet h2" });
};
const ownEmail = () => screen.getByLabelText("Player's own email (optional)");

describe("Player logins — the coach's field on a player's record", () => {
  it("the editor has the player's own email, saved trimmed and in lower case, with a plain note on who it is for", async () => {
    await load(COACH);
    await expectChip("Coach");
    await openEditor("Kim Lane");
    expect(ownEmail().value).toBe("");
    expect(ownEmail().getAttribute("type")).toBe("email");
    const note = document.getElementById(ownEmail().getAttribute("aria-describedby")).textContent;
    expect(note).toMatch(/For adult teams and older players\./);
    expect(note).toMatch(/Leave it blank for a young player, whose parents reply for them\./);
    expect(note).toMatch(/Only the coaches and this player's family can see it\./);
    fireEvent.change(ownEmail(), { target: { value: "  Kim.Lane@Example.COM " } });
    fireEvent.click(screen.getByText("Save player"));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect(saved().players[2]).toMatchObject({ id: "p3", name: "Kim L.", surname: "Lane", email: "kim.lane@example.com" });
    // Nobody else's record is touched by it.
    expect(saved().players[0].email).toBe("jo@example.com");
    expect("email" in saved().players[1]).toBe(false);
  });

  it("clearing it takes the login away: the key is removed, not saved empty", async () => {
    await load(COACH);
    await openEditor("Jo Park");
    expect(ownEmail().value).toBe("jo@example.com");
    fireEvent.change(ownEmail(), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save player"));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect("email" in saved().players[0]).toBe(false);
    expect(saved().players[0]).toMatchObject({ id: "p1", name: "Jo P.", surname: "Park" });
  });

  it("something that is not an address is refused with a reason, and nothing is saved until it is fixed", async () => {
    await load(COACH);
    await openEditor("Kim Lane");
    fireEvent.change(ownEmail(), { target: { value: "kim at example" } });
    fireEvent.click(screen.getByText("Save player"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("That doesn't look like an email address.");
    expect(ownEmail().getAttribute("aria-invalid")).toBe("true");
    expect(storage.set).not.toHaveBeenCalled();
    expect(document.querySelector(".sheet")).toBeTruthy(); // still open, nothing lost
    // Typing again clears the message; a proper address then saves.
    fireEvent.change(ownEmail(), { target: { value: "kim@example.com" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(ownEmail().getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(screen.getByText("Save player"));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect(saved().players[2].email).toBe("kim@example.com");
  });

  it("one login cannot be two players: an address that is already another player's own is refused, naming them", async () => {
    await load(COACH);
    await openEditor("Kim Lane");
    fireEvent.change(ownEmail(), { target: { value: "JO@example.com" } });
    fireEvent.click(screen.getByText("Save player"));
    expect((await screen.findByRole("alert")).textContent).toBe("That email is already Jo Park's own login. An address a family shares belongs under Parents / guardians.");
    expect(storage.set).not.toHaveBeenCalled();
    // Saving a player again with their own address is not a clash with themselves.
    cleanup();
    await load(COACH);
    await openEditor("Jo Park");
    fireEvent.click(screen.getByText("Save player"));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect(saved().players[0].email).toBe("jo@example.com");
  });

  it("the coach sees a player's own login on their page: with the family when there is one, as Contact when there is not", async () => {
    await load(COACH, makeData({ players: [SQUAD[0], { ...SQUAD[1], email: "leo@example.com" }, SQUAD[2]] }));
    await openPlayer("Jo Park");
    let card = document.querySelector(".card.family");
    expect(card.querySelector(".label").textContent).toBe("Contact");
    expect([...card.querySelectorAll(".fam-name")].map((n) => n.textContent)).toEqual(["Jo's own login"]);
    expect(card.querySelector(".fam-mail").getAttribute("href")).toBe("mailto:jo@example.com");
    expect(within(card).queryByText("No family contacts yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openPlayer("Leo Park");
    card = document.querySelector(".card.family");
    expect(card.querySelector(".label").textContent).toBe("Family");
    expect([...card.querySelectorAll(".fam-name")].map((n) => n.textContent)).toEqual(["Leo's own login", "Jo Park"]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openPlayer("Kim Lane");
    card = document.querySelector(".card.family");
    expect(card.querySelector(".label").textContent).toBe("Family");
    expect(within(card).getByText("No family contacts yet.")).toBeTruthy();
  });

  it("team-code mode has no logins, so no field; an email already on the record survives a save there", async () => {
    await load(null);
    await expectChip("Parent");
    fireEvent.click(chip());
    fireEvent.click(await screen.findByText("Coach mode"));
    await expectChip("Coach");
    await openEditor("Jo Park");
    expect(screen.queryByLabelText("Player's own email (optional)")).toBeNull();
    expect(screen.getByText("Family PIN (optional)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Parker" } });
    fireEvent.click(screen.getByText("Save player"));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    expect(saved().players[0]).toMatchObject({ surname: "Parker", email: "jo@example.com" });
  });
});

describe("Player logins — signed in as the player", () => {
  it("the chip and the Viewing-as sheet read Player, replying for yourself", async () => {
    await load(PLAYER);
    await expectChip("Player");
    fireEvent.click(chip());
    await screen.findByText("Viewing as", { selector: ".hs-title" });
    expect(screen.getByText("Your role on this team.")).toBeTruthy();
    expect([...document.querySelectorAll(".hs-list .hs-row b")].map((b) => b.textContent)).toEqual(["Player"]);
    expect(screen.getByText("Reply for yourself and see the team")).toBeTruthy();
    expect(document.querySelector(".hs-row .disc.on").textContent).toBe("JP");
    expect(screen.queryByText("Team settings")).toBeNull();
    expect(screen.queryByText("Coach mode")).toBeNull();
  });

  it("Home asks them for their own reply: You, Your reply, You're in, and the same again to clear it", async () => {
    await load(PLAYER);
    await waitFor(() => expect(replyRows().length).toBe(1));
    expect(rowText(replyRows()[0])).toEqual(["You", "Tap to reply", "Reply"]);
    expect(replyRows()[0].querySelector(".avatar").textContent).toBe("JP");
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Your reply", { selector: ".rs-title" })).toBeTruthy();
    expect(screen.queryByText(/Reply for/, { selector: ".rs-title" })).toBeNull();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    expect(await screen.findByText(`You're in for ${weekday(daysFromNow(5))}`)).toBeTruthy();
    await waitFor(() => expect(bodies("/api/rsvp")[0]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: "in" }));
    expect(rowText(replyRows()[0])).toEqual(["You", "Tap to change", "In"]);
    // The week's row for the game says it in the second person too.
    expect([...document.querySelectorAll(".wk-pill")].map((x) => x.textContent)).toContain("You're in");

    fireEvent.click(within(replyRows()[0]).getByRole("button", { name: "In" }));
    fireEvent.click(await sheet().findByRole("button", { name: "In" }));
    expect(await screen.findByText("Your reply is cleared")).toBeTruthy();
    await waitFor(() => expect(bodies("/api/rsvp")[1]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: null }));
  });

  it("Out, and a reply the server refuses, are told to them as theirs", async () => {
    await load(PLAYER);
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.click(await sheet().findByRole("button", { name: "Out" }));
    expect(await screen.findByText(`You're out for ${weekday(daysFromNow(5))}`)).toBeTruthy();
    expect([...document.querySelectorAll(".wk-pill")].map((x) => x.textContent)).toContain("You're out");
    routes.rsvp = false;
    fireEvent.click(within(replyRows()[0]).getByRole("button", { name: "Out" }));
    fireEvent.click(await sheet().findByRole("button", { name: "In" }));
    expect(await screen.findByText("Couldn't save your reply. Try again.")).toBeTruthy();
    await waitFor(() => expect(rowText(replyRows()[0])[2]).toBe("Out")); // put back
  });

  it("their own page asks Are you playing?, shows their login as theirs, and keeps a team-mate's details private", async () => {
    await load(PLAYER);
    await openPlayer("Jo Park");
    const reply = document.querySelector(".preply .replyrow");
    expect(rowText(reply)).toEqual(["Are you playing?", "Tap to reply", "Reply"]);
    const card = document.querySelector(".card.family");
    expect(card.querySelector(".label").textContent).toBe("Contact");
    expect(within(card).getByText("Your login")).toBeTruthy();
    expect(within(card).getByText("jo@example.com")).toBeTruthy();
    expect(screen.queryByText("Edit", { selector: ".ph-edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openPlayer("Kim Lane");
    expect(document.querySelector(".card.family")).toBeNull();
    expect(screen.getByText("Contact details are only shown to the family and the coaches.")).toBeTruthy();
    expect(document.querySelector(".preply")).toBeNull(); // no replying for a team-mate
  });

  it("Squad: the reply control sits on their own row only", async () => {
    await load(PLAYER);
    nav("Squad");
    await screen.findByText("Jo Park", { selector: ".pr-name b" });
    const rows = [...document.querySelectorAll(".prow")];
    expect(rows.map((r) => !!r.querySelector(".rr-btn"))).toEqual([true, false, false]);
  });

  it("claims fruit in their own name: You're on fruit, Yours, and a sheet that says You're on fruit this round", async () => {
    await load(PLAYER);
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    const slot = () => screen.getByText("Fruit duty", { selector: ".dc-label" }).closest(".du-slot");
    fireEvent.click(within(slot()).getByRole("button", { name: "I'll do it" }));
    await waitFor(() => expect(bodies("/api/duty")).toEqual([{ fixtureId: "f1", duty: "fruit", playerId: "p1" }]));
    expect(document.querySelector(".toast").textContent).toBe("You're on fruit for Round 7");
    fireEvent.click(within(slot()).getByText("Yours"));
    expect(await sheet().findByText("You're on fruit this round. Thanks!")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "Can't do it after all" }));
    await waitFor(() => expect(bodies("/api/duty")[1]).toEqual({ fixtureId: "f1", duty: "fruit", playerId: "" }));
    expect(document.querySelector(".toast").textContent).toBe("Fruit duty cleared for Round 7");
  });
});

describe("Player logins — a player whose child is in the same team", () => {
  it("one role covers both: the chip names the child, and Home lists You and the child by name", async () => {
    await load(PLAYER_AND_PARENT);
    await expectChip("Player and parent of Leo");
    await waitFor(() => expect(replyRows().length).toBe(2));
    expect(replyRows().map(rowText)).toEqual([["You", "Tap to reply", "Reply"], ["Leo P.", "Reply for Leo", "Reply"]]);
    expect([...document.querySelectorAll(".wk-pill")].map((x) => x.textContent)).toEqual(expect.arrayContaining(["You: no reply", "Leo: no reply"]));
    fireEvent.click(chip());
    await screen.findByText("Viewing as", { selector: ".hs-title" });
    expect(screen.getByText("Reply for yourself and Leo, and see the team")).toBeTruthy();
    expect([...document.querySelectorAll(".hs-list .hs-row b")].map((b) => b.textContent)).toEqual(["Player and parent of Leo"]);
  });

  it("replying for the child keeps the child's name; replying for themselves says you", async () => {
    await load(PLAYER_AND_PARENT);
    await waitFor(() => expect(replyRows().length).toBe(2));
    fireEvent.click(within(replyRows()[1]).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Leo", { selector: ".rs-title" })).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    expect(await screen.findByText(`Leo's in for ${weekday(daysFromNow(5))}`)).toBeTruthy();
    await waitFor(() => expect(bodies("/api/rsvp")[0]).toEqual({ kind: "game", id: "f1", playerId: "p2", status: "in" }));
    fireEvent.click(within(replyRows()[0]).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Your reply", { selector: ".rs-title" })).toBeTruthy();
  });

  it("Who's in names who they may reply for; the duty sheet offers You or the child's family", async () => {
    await load(PLAYER_AND_PARENT);
    fireEvent.click(await screen.findByText("Details"));
    fireEvent.click(await screen.findByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(document.querySelector(".wi-foot").textContent).toBe("You can reply for yourself and Leo. Coaches can reply for anyone.");
    expect([...document.querySelectorAll(".av-row.mine .av-name span:first-child")].map((n) => n.textContent)).toEqual(["Jo P.", "Leo P."]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Duties" }));
    await screen.findByText(/each week:/);
    fireEvent.click(within(screen.getByText("Fruit duty", { selector: ".dc-label" }).closest(".du-slot")).getByRole("button", { name: "I'll do it" }));
    const chips = await sheet().findAllByRole("radio");
    expect(chips.map((c) => c.textContent.trim())).toEqual(["You", "Leo P.'s family"]);
    fireEvent.click(chips[1]);
    fireEvent.click(sheet().getByRole("button", { name: "Yes, I'll bring fruit" }));
    await waitFor(() => expect(bodies("/api/duty")).toEqual([{ fixtureId: "f1", duty: "fruit", playerId: "p2" }]));
    expect(document.querySelector(".toast").textContent).toBe("Leo P.'s family on fruit for Round 7");
  });
});

describe("Player logins — the same person as coach, and an ordinary parent", () => {
  it("a player who also coaches opens as coach, with both roles in the sheet and no You rows until they switch", async () => {
    await load(account([coachHat, familyHat(["p1"], ["Jo P."], ["p1"])]));
    await expectChip("Coach");
    await screen.findByText("Next game · Round 7 · Home");
    expect(replyRows()).toEqual([]);
    fireEvent.click(chip());
    await screen.findByText("Viewing as", { selector: ".hs-title" });
    expect(screen.getByText("Your roles on this team. Tap one to switch.")).toBeTruthy();
    expect([...document.querySelectorAll(".hs-list .hs-row b")].map((b) => b.textContent).slice(0, 2)).toEqual(["Coach", "Player"]);
  });

  it("a parent is still asked by their child's name everywhere", async () => {
    await load(account([familyHat(["p2"], ["Leo P."])]));
    await expectChip("Parent of Leo");
    await waitFor(() => expect(replyRows().length).toBe(1));
    expect(rowText(replyRows()[0])).toEqual(["Leo P.", "Reply for Leo", "Reply"]);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Leo", { selector: ".rs-title" })).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    expect(await screen.findByText(`Leo's in for ${weekday(daysFromNow(5))}`)).toBeTruthy();
    expect([...document.querySelectorAll(".wk-pill")].map((x) => x.textContent)).toContain("Leo's in");
    fireEvent.click(chip());
    expect(await screen.findByText("Reply for Leo and see the team")).toBeTruthy();
  });
});

// A game in a competition with a picked squad (data.competitionSquads) is for
// those players only. A signed-in player left out of one is told so as "You".
describe("Player logins — a competition squad they are, or are not, in", () => {
  const WINTER = { comp: "cwinter", compName: "Winterfest" };
  // The season game is in five days; the Winterfest game is sooner.
  const winter = (over = {}) => game({ id: "w2", round: 2, dateISO: daysFromNow(3), time: "10:30", opponent: "Lions", homeAway: "A", venue: "Lion Park", ...WINTER, ...over });
  const withSquad = (ids) => makeData({ fixtures: [game(), winter()], competitionSquads: { cwinter: ids } });
  const squadNote = () => document.querySelector(".squadnote")?.textContent || null;
  const homeRows = () => replyRows().map((r) => r.querySelector(".rr-name").textContent);
  const openGame = async (opponent, title) => {
    nav("Results");
    const card = screen.getByText("Fixtures", { selector: ".label" }).closest(".card");
    fireEvent.click([...card.querySelectorAll(".mrow")].find((r) => r.textContent.includes(opponent)));
    await waitFor(() => expect(headerTitle()).toBe(title));
  };
  const whosInFoot = async () => {
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    return document.querySelector(".wi-foot").textContent;
  };

  it("left out themselves: Home moves on to their own next game, and the Winterfest game says You aren't in the squad", async () => {
    await load(PLAYER, withSquad(["p2", "p3"]));
    await screen.findByText("Next game · Round 7 · Home");
    expect(homeRows()).toEqual(["You"]);
    expect(squadNote()).toBeNull();
    await openGame("Lions", "Winterfest · Round 2");
    expect(document.querySelector(".whosin .replyrow")).toBeNull();
    expect(squadNote()).toBe("You aren't in the Winterfest squad.");
    expect(await whosInFoot()).toBe("You aren't in the Winterfest squad.");
    expect(document.querySelector(".av-row .rr-btn")).toBeNull();
  });

  it("in it themselves, their child not: they reply as You and the child is named as left out", async () => {
    await load(PLAYER_AND_PARENT, withSquad(["p1", "p3"]));
    await screen.findByText("Next game · Winterfest · Round 2 · Away");
    expect(homeRows()).toEqual(["You"]);
    expect(squadNote()).toBe("Leo isn't in the Winterfest squad.");
    await openGame("Lions", "Winterfest · Round 2");
    expect(await whosInFoot()).toBe("You can reply for yourself. Coaches can reply for anyone.");
    expect(document.querySelectorAll(".av-row .rr-btn")).toHaveLength(1);
  });

  it("their child in it, themselves not: they reply for the child and are told You aren't in it", async () => {
    await load(PLAYER_AND_PARENT, withSquad(["p2", "p3"]));
    await screen.findByText("Next game · Winterfest · Round 2 · Away");
    expect(homeRows()).toEqual(["Leo P."]);
    expect(squadNote()).toBe("You aren't in the Winterfest squad.");
    await openGame("Lions", "Winterfest · Round 2");
    expect(await whosInFoot()).toBe("You can reply for Leo. Coaches can reply for anyone.");
  });

  it("neither of them in it: both are named, You first; the season game still asks them both", async () => {
    await load(PLAYER_AND_PARENT, withSquad(["p3"]));
    await screen.findByText("Next game · Round 7 · Home");
    expect(homeRows()).toEqual(["You", "Leo P."]);
    await openGame("Lions", "Winterfest · Round 2");
    expect(squadNote()).toBe("You and Leo aren't in the Winterfest squad.");
    expect(await whosInFoot()).toBe("You and Leo aren't in the Winterfest squad.");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await openGame("Wests", "Round 7");
    expect(await whosInFoot()).toBe("You can reply for yourself and Leo. Coaches can reply for anyone.");
  });
});
