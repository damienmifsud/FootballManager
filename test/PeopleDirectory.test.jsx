// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import PeopleDirectory from "@/components/PeopleDirectory";

// The people page in club admin: one card per login with their roles as
// pills; opening a card changes a role on a team, adds a team, makes a club
// admin or starts view-as. Reads /api/people, writes through /api/access.

const coachHat = (over = {}) => ({ role: "coach", playerIds: [], playerNames: [], ...over });
const parentHat = (...names) => ({ role: "parent", playerIds: names.map((_, i) => "p" + i), playerNames: names });
const viewHat = (over = {}) => ({ role: "viewer", playerIds: [], playerNames: [], ...over });
const team = (slug, name, hats) => ({ teamSlug: slug, teamName: name, hats, mine: hats.some((h) => !h.club) });
const TEAMS = [{ slug: "u9", name: "Riverside FC U9 Reds" }, { slug: "u11", name: "Riverside FC U11 Blues" }, { slug: "u13", name: "Riverside FC U13 Golds" }];
const sam = () => ({
  email: "sam@example.com", name: "Sam Kelly", superAdmin: false, clubAdmin: null, overrides: {},
  teams: [team("u9", "Riverside FC U9 Reds", [coachHat({ staffRole: "Assistant coach" }), parentHat("Leo K.")]), team("u11", "Riverside FC U11 Blues", [parentHat("Mia K.")])]
});
const rita = () => ({
  email: "rita@example.com", name: "Rita van Dyk", superAdmin: false, clubAdmin: "stored", overrides: { u13: "blocked" },
  teams: [team("u9", "Riverside FC U9 Reds", [parentHat("Ana V.")]), team("u11", "Riverside FC U11 Blues", [viewHat({ clubAdmin: true, club: true })])]
});
const owner = () => ({
  email: "owner@example.com", name: "", superAdmin: true, clubAdmin: null, overrides: {},
  teams: TEAMS.map((t) => team(t.slug, t.name, [coachHat({ admin: true, club: true })]))
});

let doc;      // what GET /api/people answers with
let posts;    // every POST body to /api/access, in order
let failNext; // { error } for the next POST
beforeEach(() => {
  doc = { teams: TEAMS, people: [owner(), rita(), sam()] };
  posts = [];
  failNext = null;
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/people")) return { ok: true, json: async () => JSON.parse(JSON.stringify(doc)) };
    if (!u.includes("/api/access") || opts.method !== "POST") throw new Error("unexpected fetch " + u);
    const body = JSON.parse(opts.body);
    posts.push(body);
    if (failNext) { const f = failNext; failNext = null; return { ok: false, status: 400, json: async () => ({ error: f.error }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const show = async (props = {}) => {
  render(<PeopleDirectory {...props} />);
  await screen.findByLabelText("Search people");
};
const cards = () => [...document.querySelectorAll(".adm-person")];
const titles = () => cards().map((c) => c.querySelector(".who b").textContent);
const cardOf = (title) => cards().find((c) => c.querySelector(".who b").textContent === title);
const pills = (title) => [...cardOf(title).querySelectorAll(".adm-person-pills .adm-pill")].map((p) => p.textContent);
const open = (title) => fireEvent.click(cardOf(title).querySelector(".adm-person-head"));
const teamRows = (title) => [...cardOf(title).querySelectorAll(".adm-person-team")].map((r) => [r.querySelector(".t b").textContent, r.querySelector(".t span").textContent, r.querySelector("select").value]);

describe("People — the list", () => {
  it("shows a quiet loading card, then one card per person in the order the club gave", async () => {
    render(<PeopleDirectory />);
    expect(screen.getByText("Loading people…")).toBeTruthy();
    await screen.findByLabelText("Search people");
    expect(screen.queryByText("Loading people…")).toBeNull();
    expect(titles()).toEqual(["owner@example.com", "Rita van Dyk", "Sam Kelly"]);
    expect(screen.getByRole("status").textContent).toBe("3 people with a login");
  });

  it("a card names the person, their email and initials; someone with no name on record goes by their email", async () => {
    await show();
    const s = cardOf("Sam Kelly");
    expect(s.querySelector(".who span").textContent).toBe("sam@example.com");
    expect(s.querySelector(".disc").textContent).toBe("SK");
    const o = cardOf("owner@example.com");
    expect(o.querySelector(".who span")).toBeNull();
    expect(o.querySelector(".disc").textContent).toBe("OW");
  });

  it("pills read role then team, with the club's name dropped, and tell club, staff and family apart", async () => {
    await show();
    expect(pills("Sam Kelly")).toEqual(["Assistant coach · U9 Reds", "Parent of Leo · U9 Reds", "Parent of Mia · U11 Blues"]);
    expect(pills("Rita van Dyk")).toEqual(["Club admin", "Parent of Ana · U9 Reds", "No access · U13 Golds"]);
    // The super admin is not listed as on every team.
    expect(pills("owner@example.com")).toEqual(["Super admin"]);
    const tone = (title, text) => [...cardOf(title).querySelectorAll(".adm-pill")].find((p) => p.textContent === text).className;
    expect(tone("Sam Kelly", "Assistant coach · U9 Reds")).toContain(" ok");
    expect(tone("Sam Kelly", "Parent of Mia · U11 Blues")).toContain(" info");
    expect(tone("Rita van Dyk", "Club admin")).toContain(" bad");
    expect(tone("Rita van Dyk", "No access · U13 Golds")).toContain(" warn");
  });

  it("search narrows by name, email, role or team and says how many are left", async () => {
    await show();
    const box = screen.getByLabelText("Search people");
    // A team's name finds the people on it: not the club admin or super admin who can merely open it.
    fireEvent.change(box, { target: { value: "blues" } });
    expect(titles()).toEqual(["Sam Kelly"]);
    expect(screen.getByRole("status").textContent).toBe("1 of 3 people");
    fireEvent.change(box, { target: { value: "reds" } });
    expect(titles()).toEqual(["Rita van Dyk", "Sam Kelly"]);
    expect(screen.getByRole("status").textContent).toBe("2 of 3 people");
    fireEvent.change(box, { target: { value: "assistant" } });
    expect(titles()).toEqual(["Sam Kelly"]);
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(titles()).toEqual([]);
    expect(screen.getByText("Nobody matches that search.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "" } });
    expect(titles().length).toBe(3);
  });

  it("an empty club says where people come from", async () => {
    doc = { teams: [], people: [] };
    await show();
    expect(screen.getByRole("status").textContent).toBe("Nobody has a login yet.");
    expect(screen.getByText("People appear here once their email is on a team's staff list or on a player's record.")).toBeTruthy();
    expect(cards()).toEqual([]);
  });

  it("one person is one person, not one people", async () => {
    doc = { teams: TEAMS, people: [sam()] };
    await show();
    expect(screen.getByRole("status").textContent).toBe("1 person with a login");
  });

  it("a failed load is an alert, not an endless spinner", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) }));
    render(<PeopleDirectory />);
    expect((await screen.findByRole("alert")).textContent).toBe("forbidden");
    expect(screen.queryByText("Loading people…")).toBeNull();
  });
});

describe("People — opening a person", () => {
  it("a card opens to its teams and closes again; opening another closes the first", async () => {
    await show();
    const head = (title) => cardOf(title).querySelector(".adm-person-head");
    expect(head("Sam Kelly").getAttribute("aria-expanded")).toBe("false");
    expect(cardOf("Sam Kelly").querySelector(".adm-person-body")).toBeNull();
    open("Sam Kelly");
    expect(head("Sam Kelly").getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(head("Sam Kelly").getAttribute("aria-controls"))).toBe(cardOf("Sam Kelly").querySelector(".adm-person-body"));
    open("Rita van Dyk");
    expect(head("Sam Kelly").getAttribute("aria-expanded")).toBe("false");
    expect(head("Rita van Dyk").getAttribute("aria-expanded")).toBe("true");
    open("Rita van Dyk");
    expect(cards().some((c) => c.querySelector(".adm-person-body"))).toBe(false);
  });

  it("lists the teams they have a role of their own on, or that the club has ruled on, with the role menu on what is set", async () => {
    await show();
    open("Sam Kelly");
    expect(teamRows("Sam Kelly")).toEqual([
      ["Riverside FC U11 Blues", "Parent of Mia", ""],
      ["Riverside FC U9 Reds", "Assistant coach · Parent of Leo", ""]
    ]);
    open("Rita van Dyk");
    // U11 is only hers as a club admin, so it is not a row; U13 is, because she is shut out of it.
    expect(teamRows("Rita van Dyk")).toEqual([
      ["Riverside FC U13 Golds", "No access", "blocked"],
      ["Riverside FC U9 Reds", "Parent of Ana", ""]
    ]);
    const menu = within(cardOf("Rita van Dyk")).getByLabelText("Role for Rita van Dyk on Riverside FC U13 Golds");
    expect([...menu.options].map((o) => o.textContent)).toEqual(["As listed", "Coach", "Parent only", "View only", "No access"]);
  });

  it("the super admin's card explains itself and offers nothing to change", async () => {
    await show();
    open("owner@example.com");
    const body = cardOf("owner@example.com").querySelector(".adm-person-body");
    expect(body.textContent).toBe("Super admin, set in the site's settings. A super admin has coach access to every team, so there is nothing to change here.");
    expect(body.querySelector("select")).toBeNull();
    expect(body.querySelector("button")).toBeNull();
  });
});

describe("People — changing what someone can do", () => {
  it("choosing a role on a team saves it for that person on that team, and As listed clears it", async () => {
    const onChanged = vi.fn();
    await show({ onChanged });
    open("Sam Kelly");
    const menu = () => within(cardOf("Sam Kelly")).getByLabelText("Role for Sam Kelly on Riverside FC U11 Blues");
    doc.people[2].overrides = { u11: "blocked" }; // what the reload will show
    fireEvent.change(menu(), { target: { value: "blocked" } });
    await waitFor(() => expect(menu().value).toBe("blocked"));
    expect(posts).toEqual([{ action: "setOverride", email: "sam@example.com", teamSlug: "u11", role: "blocked" }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The card stays open on the same person after the reload.
    expect(cardOf("Sam Kelly").querySelector(".adm-person-head").getAttribute("aria-expanded")).toBe("true");
    doc.people[2].overrides = {};
    fireEvent.change(menu(), { target: { value: "" } });
    await waitFor(() => expect(menu().value).toBe(""));
    expect(posts[1]).toEqual({ action: "setOverride", email: "sam@example.com", teamSlug: "u11", role: null });
  });

  it("adds them to a team they are not on: only those teams are offered, and Add waits for a choice", async () => {
    await show();
    open("Sam Kelly");
    const c = within(cardOf("Sam Kelly"));
    const pick = c.getByLabelText("Add Sam Kelly to a team");
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Add to a team…", "Riverside FC U13 Golds"]);
    expect([...c.getByLabelText("Role on that team").options].map((o) => o.textContent)).toEqual(["Coach", "View only", "No access"]);
    const add = c.getByRole("button", { name: "Add" });
    expect(add.disabled).toBe(true);
    fireEvent.change(pick, { target: { value: "u13" } });
    fireEvent.change(c.getByLabelText("Role on that team"), { target: { value: "viewer" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(posts).toEqual([{ action: "setOverride", email: "sam@example.com", teamSlug: "u13", role: "viewer" }]));
  });

  it("someone on every team has no team left to be added to", async () => {
    doc.people[2].overrides = { u13: "coach" };
    doc.people[2].teams.push(team("u13", "Riverside FC U13 Golds", [coachHat()]));
    await show();
    open("Sam Kelly");
    expect(within(cardOf("Sam Kelly")).queryByLabelText("Add Sam Kelly to a team")).toBeNull();
    expect(teamRows("Sam Kelly").map((r) => r[2])).toEqual(["", "coach", ""]);
  });

  it("makes and removes a club admin; one set in the site's settings can only be read", async () => {
    await show();
    open("Sam Kelly");
    fireEvent.click(within(cardOf("Sam Kelly")).getByRole("button", { name: "Make club admin" }));
    await waitFor(() => expect(posts).toEqual([{ action: "addClubAdmin", email: "sam@example.com" }]));
    open("Rita van Dyk");
    expect(within(cardOf("Rita van Dyk")).queryByRole("button", { name: "Make club admin" })).toBeNull();
    fireEvent.click(within(cardOf("Rita van Dyk")).getByRole("button", { name: "Remove club admin" }));
    await waitFor(() => expect(posts[1]).toEqual({ action: "removeClubAdmin", email: "rita@example.com" }));
    cleanup();
    doc.people[1].clubAdmin = "env";
    await show();
    open("Rita van Dyk");
    const c = within(cardOf("Rita van Dyk"));
    expect(c.getByText("Club admin, set in the site's settings.")).toBeTruthy();
    expect(c.queryByRole("button", { name: /club admin/i })).toBeNull();
  });

  it("View as starts view-as for that person, by first name when there is one", async () => {
    await show();
    open("Sam Kelly");
    fireEvent.click(within(cardOf("Sam Kelly")).getByRole("button", { name: "View as Sam" }));
    await waitFor(() => expect(posts).toEqual([{ action: "viewAs", email: "sam@example.com" }]));
    cleanup();
    doc.people = [{ ...sam(), name: "" }];
    await show();
    open("sam@example.com");
    expect(within(cardOf("sam@example.com")).getByRole("button", { name: "View as them" })).toBeTruthy();
  });

  it("a refusal is shown as an alert, nothing is reported as changed, and the controls work again", async () => {
    const onChanged = vi.fn();
    await show({ onChanged });
    open("Sam Kelly");
    failNext = { error: "no such team" };
    const menu = () => within(cardOf("Sam Kelly")).getByLabelText("Role for Sam Kelly on Riverside FC U9 Reds");
    fireEvent.change(menu(), { target: { value: "viewer" } });
    expect((await screen.findByRole("alert")).textContent).toBe("no such team");
    expect(onChanged).not.toHaveBeenCalled();
    await waitFor(() => expect(menu().disabled).toBe(false));
    expect(menu().value).toBe(""); // still what the club has on record
  });
});

describe("People — the footnote", () => {
  it("says where roles come from and what a change here does", async () => {
    await show();
    expect(document.querySelector(".adm-people-foot").textContent).toBe("Roles come from each team's own staff and squad lists. Choosing a role here sets it for that person on that team only; As listed goes back to the team's lists.");
  });
});
