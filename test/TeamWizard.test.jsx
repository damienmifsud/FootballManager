// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import TeamWizard from "@/components/TeamWizard";

// The team wizard on /admin (Direction C restyle). The restyle is markup
// only, so these pin the requests and payloads it has always sent, through
// the new controls: numbered steps, chips, switches, hairline team rows.
const EMOJI = /\p{Extended_Pictographic}/u;

const U8 = {
  slug: "u8-white", name: "Olympic FC U8 White", ageGroup: "U8", password: "red-kanga-42", calendarKey: "abc123",
  coachEmails: ["coach@a.com"], source: "stored", season: { startISO: "2027-01-01", endISO: "2027-12-31" },
  division: "K1 Central", whatsapp: "", squadi: { competitionId: "1439", divisionId: "10661", teamId: "110013" },
  // Two more competitions: one with its Squadi ids, one whose draw is not published yet.
  competitions: [
    { id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } },
    { id: "c5e6f7a8b", name: "Premier Invitational" }
  ],
  features: { fruitDuty: true, jerseyDuty: true, gkDuty: false, focus: true },
  parentsSee: { planBefore: true }, hasLogo: true, coachPin: "2468",
  staff: [{ role: "Head coach", name: "Dee", mobile: "0400000000", email: "dee@a.com" }, { role: "Physio", name: "Pat", mobile: "", email: "" }]
};
const ENV = { slug: "env-team", name: "Env Team", ageGroup: "U9", password: "env-code-1", calendarKey: "", coachEmails: [], source: "env" };

let teams;
let calls; // { method, body } for every non-GET request
let reply; // optional override: (method, body) => response
beforeEach(() => {
  teams = [U8, ENV];
  calls = [];
  reply = null;
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).includes("/api/teams")) throw new Error("unexpected fetch " + url);
    const method = opts.method || "GET";
    if (method === "GET") return { ok: true, json: async () => ({ teams: JSON.parse(JSON.stringify(teams)) }) };
    const body = JSON.parse(opts.body);
    calls.push({ method, body });
    if (reply) { const r = reply(method, body); if (r) return r; }
    if (method === "POST") {
      const team = { slug: "new-team", name: body.name, password: body.password, source: "stored", coachEmails: [] };
      teams = [...teams, team];
      return { ok: true, json: async () => ({ ok: true, team, playersImported: (body.players || []).length, trainingSeeded: (body.training || []).length }) };
    }
    if (method === "DELETE") teams = teams.filter((t) => t.slug !== body.slug);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "team_slug=; path=/; max-age=0";
});

const open = async (props) => {
  const utils = render(<TeamWizard {...props} />);
  await screen.findByText("Olympic FC U8 White");
  return utils;
};
const row = (name) => screen.getByText(name).closest(".adm-team");
const stepTitles = () => [...document.querySelectorAll(".adm-step")].map((s) => `${s.querySelector(".adm-step-n").textContent} ${s.querySelector(".adm-step-t").textContent}`);
const step = (title) => within(screen.getByRole("heading", { level: 4, name: title }).closest(".adm-step"));
const sw = (title, label) => step(title).getByRole("switch", { name: label });

describe("TeamWizard — the team list", () => {
  it("one hairline row per team: name, age group, season and where it came from", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: "Teams" })).toBeTruthy();
    const u8 = within(row("Olympic FC U8 White"));
    expect(u8.getByText("U8")).toBeTruthy();
    expect(u8.getByText("2027")).toBeTruthy();
    expect(u8.getByText("Created here").className).toContain("ok");
    expect(u8.getByText("u8-white")).toBeTruthy();
    expect(u8.getByText("Coaches: coach@a.com")).toBeTruthy();
    const env = within(row("Env Team"));
    expect(env.getByText("Set in the environment")).toBeTruthy();
    // Only wizard-made teams can be removed, and only keyed teams offer the feed.
    expect(env.queryByRole("button", { name: "Remove Env Team" })).toBeNull();
    expect(env.queryByRole("button", { name: "Copy the calendar link for Env Team" })).toBeNull();
    expect(u8.getByRole("button", { name: "Remove Olympic FC U8 White" })).toBeTruthy();
  });

  it("the team code stays hidden until Show, and Copy puts it on the clipboard", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await open();
    const u8 = within(row("Olympic FC U8 White"));
    expect(u8.queryByText("red-kanga-42")).toBeNull();
    fireEvent.click(u8.getByRole("button", { name: "Show the team code for Olympic FC U8 White" }));
    expect(u8.getByText("red-kanga-42")).toBeTruthy();
    fireEvent.click(u8.getByRole("button", { name: "Hide the team code for Olympic FC U8 White" }));
    expect(u8.queryByText("red-kanga-42")).toBeNull();
    fireEvent.click(u8.getByRole("button", { name: "Copy the team code for Olympic FC U8 White" }));
    expect(writeText).toHaveBeenLastCalledWith("red-kanga-42");
    expect(u8.getByRole("button", { name: "Copy the team code for Olympic FC U8 White" }).textContent).toBe("Copied");
    fireEvent.click(u8.getByRole("button", { name: "Copy the calendar link for Olympic FC U8 White" }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/api/calendar?key=abc123`);
    expect(u8.getByRole("button", { name: "Copy the calendar link for Olympic FC U8 White" }).textContent).toBe("Calendar link copied");
  });

  it("Open selects the team (team_slug cookie) before heading to the dashboard, in the strongest role held there", async () => {
    // A role last worn on some other team must not follow them in.
    document.cookie = "act_as=parent; path=/";
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Open Olympic FC U8 White" }));
    expect(document.cookie).toContain("team_slug=u8-white");
    expect(document.cookie).not.toContain("act_as=");
  });

  it("an empty club says so and offers the first team", async () => {
    teams = [];
    render(<TeamWizard />);
    expect(await screen.findByText("No teams yet. Add the first one below.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a team" })).toBeTruthy();
  });

  it("no emoji or glyph icons anywhere, list or form", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.click(screen.getByRole("button", { name: "Add training day" }));
    fireEvent.click(screen.getByRole("button", { name: "Add staff member" }));
    expect(document.body.textContent).not.toMatch(EMOJI);
    expect(document.body.textContent).not.toMatch(/[▸↗←＋↻✕✓]/);
    expect(document.body.innerHTML).not.toMatch(/gradient/);
  });
});

describe("TeamWizard — creating a team", () => {
  it("numbers the eleven steps in order", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    expect(screen.getByRole("heading", { level: 3, name: "New team" })).toBeTruthy();
    expect(stepTitles()).toEqual([
      "1 Team name", "2 Age group", "3 Team code", "4 Extra coach logins", "5 Competitions", "6 Players and parents",
      "7 Season", "8 Weekly training", "9 Features", "10 Parents can see", "11 Team identity"
    ]);
  });

  it("typing never remounts a field (the steps are stable components)", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    const name = screen.getByLabelText("Team name");
    fireEvent.change(name, { target: { value: "O" } });
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Ol" } });
    expect(screen.getByLabelText("Team name")).toBe(name);
    expect(name.value).toBe("Ol");
  });

  it("Create is disabled until there is a name and a code of four characters", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    const create = screen.getByRole("button", { name: "Create team" });
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Over 35s" } });
    expect(create.disabled).toBe(false); // a friendly code is generated on open
    expect(screen.getByLabelText("Team code").value).toMatch(/^[a-z]+-[a-z]+-\d\d$/);
    fireEvent.change(screen.getByLabelText("Team code"), { target: { value: "abc" } });
    expect(create.disabled).toBe(true);
    expect(screen.getByText("over-35s")).toBeTruthy(); // the permanent slug preview
  });

  it("New code swaps in another friendly code", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.change(screen.getByLabelText("Team code"), { target: { value: "typed-by-hand" } });
    fireEvent.click(screen.getByRole("button", { name: "New code" }));
    expect(screen.getByLabelText("Team code").value).toMatch(/^[a-z]+-[a-z]+-\d\d$/);
  });

  it("posts everything the form holds: chips, switches, season, training, staff and the player import", async () => {
    const onTeamsChanged = vi.fn();
    await open({ onTeamsChanged });
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Olympic FC Over 35s" } });
    fireEvent.change(screen.getByLabelText("Division label"), { target: { value: "Masters North" } });
    fireEvent.change(screen.getByLabelText("WhatsApp group link"), { target: { value: "https://chat.whatsapp.com/x" } });
    fireEvent.click(step("Age group").getByRole("button", { name: "U12+" }));
    expect(step("Age group").getByRole("button", { name: "U12+" }).getAttribute("aria-pressed")).toBe("true");
    expect(step("Age group").getByRole("button", { name: "U8" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(screen.getByLabelText("Team code"), { target: { value: "  masters-code  " } });
    fireEvent.change(screen.getByLabelText("Extra coach emails"), { target: { value: "a@x.com, b@x.com" } });
    fireEvent.change(screen.getByLabelText("Squadi competition ID"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Player import"), { target: { value: "Spencer, 6, MID, Damien, 0400 000 000, 12/03/2018\nLevi, 9, FWD, Sam, 0400 000 001, 02/05/2018" } });
    expect(step("Players and parents").getByText("2 players ready:")).toBeTruthy();
    // Season: a year chip fills both dates.
    const thisYear = new Date().getFullYear();
    fireEvent.click(step("Season").getByRole("button", { name: String(thisYear + 1) }));
    expect(screen.getByLabelText("Season starts").value).toBe(`${thisYear + 1}-01-01`);
    expect(screen.getByLabelText("Season finishes").value).toBe(`${thisYear + 1}-12-31`);
    // Training: one day, moved to Thursday at the park.
    fireEvent.click(screen.getByRole("button", { name: "Add training day" }));
    fireEvent.change(screen.getByLabelText("Training day 1"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Training 1 starts"), { target: { value: "18:30" } });
    fireEvent.change(screen.getByLabelText("Training 1 finishes"), { target: { value: "19:30" } });
    fireEvent.change(screen.getByLabelText("Training 1 location"), { target: { value: "Perry Park" } });
    // Switches: defaults shown, then flipped.
    expect(sw("Features", "Fruit duty").getAttribute("aria-checked")).toBe("true");
    expect(sw("Features", "Jersey duty").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw("Features", "Fruit duty"));
    fireEvent.click(sw("Features", "Jersey duty"));
    expect(sw("Features", "Fruit duty").getAttribute("aria-checked")).toBe("false");
    const firstSee = step("Parents can see").getAllByRole("switch")[0];
    const seeBefore = firstSee.getAttribute("aria-checked");
    fireEvent.click(firstSee);
    expect(firstSee.getAttribute("aria-checked")).toBe(seeBefore === "true" ? "false" : "true");
    // Staff: a standard slot, plus a custom title; an empty-named row is dropped.
    fireEvent.change(screen.getByLabelText("Head coach name"), { target: { value: "Damien" } });
    fireEvent.change(screen.getByLabelText("Head coach email"), { target: { value: "damien@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add staff member" }));
    fireEvent.change(screen.getByLabelText("Title for staff member 4"), { target: { value: "Keeper coach" } });
    fireEvent.change(screen.getByLabelText("Keeper coach name"), { target: { value: "Kim" } });
    fireEvent.change(screen.getByLabelText("Keeper coach mobile"), { target: { value: "0400 111 222" } });
    fireEvent.change(screen.getByLabelText("Coach PIN"), { target: { value: "1357" } });

    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText("Olympic FC Over 35s is live")).toBeTruthy();
    expect(calls).toHaveLength(1);
    const { method, body } = calls[0];
    expect(method).toBe("POST");
    expect(body).toMatchObject({
      name: "Olympic FC Over 35s", ageGroup: "U12+", password: "masters-code", coachEmails: "a@x.com, b@x.com",
      division: "Masters North", whatsapp: "https://chat.whatsapp.com/x", coachPin: "1357",
      squadi: { competitionId: "1500", divisionId: "", teamId: "" },
      season: { startISO: `${thisYear + 1}-01-01`, endISO: `${thisYear + 1}-12-31` },
      features: { fruitDuty: false, jerseyDuty: true, gkDuty: true, focus: true },
      training: [{ weekday: 4, time: "18:30", endTime: "19:30", location: "Perry Park" }],
      staff: [
        { role: "Head coach", name: "Damien", mobile: "", email: "damien@x.com" },
        { role: "Keeper coach", name: "Kim", mobile: "0400 111 222", email: "" }
      ]
    });
    expect(body.players.map((p) => p.name)).toEqual(["Spencer", "Levi"]);
    expect(Object.values(body.parentsSee).every((v) => typeof v === "boolean")).toBe(true);
    expect("slug" in body).toBe(false);
    expect("logo" in body).toBe(false); // only sent when a file was chosen
    // The success panel: the code, what was seeded, and the form is closed.
    const live = screen.getByText("Olympic FC Over 35s is live").closest(".adm-msg");
    expect(within(live).getByText("masters-code")).toBeTruthy();
    expect(within(live).getByText(/2 players imported with parent details\./)).toBeTruthy();
    expect(within(live).getByText(/1 weekly training session added to the calendar\./)).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "New team" })).toBeNull();
    expect(onTeamsChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(within(live).getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Olympic FC Over 35s is live")).toBeNull();
  });

  it("a blank season and blank Squadi are sent as nothing, and Clear the season empties both dates", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Plain" } });
    expect(step("Season").queryByRole("button", { name: "Clear the season" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Season starts"), { target: { value: "2027-02-01" } });
    fireEvent.click(step("Season").getByRole("button", { name: "Clear the season" }));
    expect(screen.getByLabelText("Season starts").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.season).toBeNull();
    expect("squadi" in calls[0].body).toBe(false);
    expect("competitions" in calls[0].body).toBe(false);
    expect("players" in calls[0].body).toBe(false);
    expect("training" in calls[0].body).toBe(false);
  });

  it("other competitions: add as many as the team plays in, skip the ids of any not published yet", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Olympic FC U10 Red" } });
    const comps = step("Competitions");
    // The season's ids are the same three fields as ever, under their own label.
    expect(comps.getByText("Season")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Squadi competition ID"), { target: { value: "1439" } });
    expect(comps.queryByLabelText("Competition 1 name")).toBeNull();

    // Winterfest, with its ids.
    fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
    fireEvent.change(comps.getByLabelText("Competition 1 name"), { target: { value: "Winterfest" } });
    // Once named, its fields are known by its name.
    fireEvent.change(comps.getByLabelText("Winterfest competition ID"), { target: { value: " 1750 " } });
    fireEvent.change(comps.getByLabelText("Winterfest division ID"), { target: { value: "20001" } });
    fireEvent.change(comps.getByLabelText("Winterfest team ID"), { target: { value: "300123" } });
    // The Premier Invitational: named now, ids later.
    fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
    fireEvent.change(comps.getByLabelText("Competition 2 name"), { target: { value: "  Premier Invitational " } });
    // A row added and never filled in.
    fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
    expect(comps.getByLabelText("Competition 3 name").value).toBe("");
    // The season's fields were not disturbed by any of that.
    expect(screen.getByLabelText("Squadi competition ID").value).toBe("1439");

    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.squadi).toEqual({ competitionId: "1439", divisionId: "", teamId: "" });
    // New rows carry no id (the server gives them one); the untouched row is not sent.
    expect(calls[0].body.competitions).toEqual([
      { name: "Winterfest", squadi: { competitionId: " 1750 ", divisionId: "20001", teamId: "300123" }, scores: true },
      { name: "Premier Invitational" }
    ]);
  });

  it("a competition row can be removed, typing in one keeps the field, and the list stops at eight", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    const comps = step("Competitions");
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
      const n = comps.getAllByPlaceholderText("Name (e.g. Winterfest)").length;
      fireEvent.change(comps.getByLabelText(`Competition ${n} name`), { target: { value: name } });
    }
    // Typing never remounts the field.
    const field = comps.getByLabelText("Competition 2 name");
    fireEvent.change(field, { target: { value: "Bravo Cup" } });
    expect(comps.getByLabelText("Competition 2 name")).toBe(field);
    // Remove the middle one, by name.
    fireEvent.click(comps.getByRole("button", { name: "Remove Bravo Cup" }));
    expect(comps.getAllByPlaceholderText("Name (e.g. Winterfest)").map((i) => i.value)).toEqual(["Alpha", "Charlie"]);
    expect(comps.getByLabelText("Competition 2 name").value).toBe("Charlie");
    // An unnamed row is removed by its position.
    fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
    fireEvent.click(comps.getByRole("button", { name: "Remove Competition 3" }));
    expect(comps.getAllByPlaceholderText("Name (e.g. Winterfest)")).toHaveLength(2);
    // Eight is the most a team can have.
    for (let i = 0; i < 6; i++) fireEvent.click(comps.getByRole("button", { name: "Add a competition" }));
    expect(comps.getAllByPlaceholderText("Name (e.g. Winterfest)")).toHaveLength(8);
    expect(comps.queryByRole("button", { name: "Add a competition" })).toBeNull();
  });

  it("an unreadable paste says so, and a refused save shows the server's reason and keeps the form", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    // A Majestri export with its header row but no players under it.
    fireEvent.change(screen.getByLabelText("Player import"), { target: { value: "Role,Firstname,Surname,Email" } });
    expect(step("Players and parents").getByText("Majestri export detected.")).toBeTruthy();
    expect(step("Players and parents").getByText("Nothing readable yet. Check the format.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Dupe" } });
    reply = () => ({ ok: false, status: 400, json: async () => ({ error: "That team code is already in use." }) });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That team code is already in use.");
    expect(screen.getByLabelText("Team name").value).toBe("Dupe");
  });

  it("Cancel closes the form without a request", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Team name")).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("TeamWizard — editing a team", () => {
  it("prefills from the team, numbers nine steps and keeps every staff row", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    expect(screen.getByRole("heading", { level: 3, name: "Edit Olympic FC U8 White" })).toBeTruthy();
    expect(stepTitles()).toEqual([
      "1 Team name", "2 Age group", "3 Team code", "4 Extra coach logins", "5 Competitions",
      "6 Season", "7 Features", "8 Parents can see", "9 Team identity"
    ]);
    expect(screen.getByLabelText("Team name").value).toBe("Olympic FC U8 White");
    expect(screen.getByLabelText("Team code").value).toBe("red-kanga-42");
    expect(screen.getByLabelText("Division label").value).toBe("K1 Central");
    expect(screen.getByLabelText("Extra coach emails").value).toBe("coach@a.com");
    expect(screen.getByLabelText("Squadi team ID").value).toBe("110013");
    expect(screen.getByLabelText("Season starts").value).toBe("2027-01-01");
    expect(step("Season").getByRole("button", { name: "2027" }).getAttribute("aria-pressed")).toBe("true");
    expect(sw("Features", "Jersey duty").getAttribute("aria-checked")).toBe("true");
    expect(sw("Features", "Goalkeeper duty").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Logo set")).toBeTruthy();
    expect(screen.getByLabelText("Coach PIN").value).toBe("2468");
    // Existing rows first (the custom "Physio" title included), then the standard slots.
    expect(screen.getByLabelText("Head coach name").value).toBe("Dee");
    expect(screen.getByLabelText("Title for staff member 2").value).toBe("Physio");
    expect(screen.getByLabelText("Physio name").value).toBe("Pat");
    expect(screen.getByLabelText("Assistant coach name").value).toBe("");
    expect(screen.getByLabelText("Manager name").value).toBe("");
    expect(screen.queryByLabelText("Player import")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add training day" })).toBeNull();
  });

  it("saves with PATCH: the slug, never players or training, and tells the page", async () => {
    const onTeamsChanged = vi.fn();
    await open({ onTeamsChanged });
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Olympic FC U9 White" } });
    fireEvent.click(sw("Features", "Goalkeeper duty"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    const { method, body } = calls[0];
    expect(method).toBe("PATCH");
    expect(body).toMatchObject({
      slug: "u8-white", name: "Olympic FC U9 White", ageGroup: "U8", password: "red-kanga-42",
      season: { startISO: "2027-01-01", endISO: "2027-12-31" },
      features: { fruitDuty: true, jerseyDuty: true, gkDuty: true, focus: true },
      staff: [{ role: "Head coach", name: "Dee", mobile: "0400000000", email: "dee@a.com" }, { role: "Physio", name: "Pat", mobile: "", email: "" }]
    });
    expect("players" in body).toBe(false);
    expect("training" in body).toBe(false);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull());
    expect(onTeamsChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/is live/)).toBeNull(); // the success panel is for new teams only
  });

  it("prefills the team's other competitions and sends them back with their ids", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    const comps = step("Competitions");
    expect(comps.getByLabelText("Competition 1 name").value).toBe("Winterfest");
    expect(comps.getByLabelText("Winterfest competition ID").value).toBe("1750");
    expect(comps.getByLabelText("Winterfest division ID").value).toBe("20001");
    expect(comps.getByLabelText("Winterfest team ID").value).toBe("300123");
    // The one skipped at set-up: named, no ids yet.
    expect(comps.getByLabelText("Competition 2 name").value).toBe("Premier Invitational");
    expect(comps.getByLabelText("Premier Invitational competition ID").value).toBe("");

    // Its draw is out now: add the ids. And rename the other.
    fireEvent.change(comps.getByLabelText("Premier Invitational competition ID"), { target: { value: "1800" } });
    fireEvent.change(comps.getByLabelText("Premier Invitational division ID"), { target: { value: "21000" } });
    fireEvent.change(comps.getByLabelText("Premier Invitational team ID"), { target: { value: "310000" } });
    fireEvent.change(comps.getByLabelText("Competition 1 name"), { target: { value: "Winterfest 2027" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("PATCH");
    // Each row keeps the id it came with, so its games stay its games.
    expect(calls[0].body.competitions).toEqual([
      { id: "c1a2b3c4d", name: "Winterfest 2027", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } },
      { id: "c5e6f7a8b", name: "Premier Invitational", squadi: { competitionId: "1800", divisionId: "21000", teamId: "310000" } }
    ]);
  });

  it("an edit always sends the list, so removing the last competition removes it", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    const comps = step("Competitions");
    fireEvent.click(comps.getByRole("button", { name: "Remove Winterfest" }));
    fireEvent.click(comps.getByRole("button", { name: "Remove Premier Invitational" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([]);
    // A team that never had any sends an empty list too, which changes nothing.
    cleanup();
    calls = [];
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Env Team" }));
    expect(step("Competitions").queryByLabelText("Competition 1 name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([]);
  });

  it("rotating the calendar key asks first", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Rotate calendar key" }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Rotate calendar key" }));
    await waitFor(() => expect(calls).toEqual([{ method: "PATCH", body: { slug: "u8-white", rotateCalendarKey: true } }]));
  });

  it("a custom staff row can be removed; the standard slots cannot", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    expect(screen.getAllByRole("button", { name: "Remove staff member" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove staff member" }));
    expect(screen.queryByLabelText("Physio name")).toBeNull();
    expect(screen.getByLabelText("Head coach name").value).toBe("Dee");
  });
});

describe("TeamWizard — removing a team", () => {
  it("asks twice and wipes the stored data when the second answer is yes", async () => {
    const onTeamsChanged = vi.fn();
    await open({ onTeamsChanged });
    fireEvent.click(screen.getByRole("button", { name: "Remove Olympic FC U8 White" }));
    await waitFor(() => expect(screen.queryByText("Olympic FC U8 White")).toBeNull());
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([{ method: "DELETE", body: { slug: "u8-white", purgeData: true } }]);
    expect(onTeamsChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the data when the second answer is no, and does nothing when the first is no", async () => {
    await open();
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove Olympic FC U8 White" }));
    expect(calls).toEqual([]);
    window.confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Remove Olympic FC U8 White" }));
    await waitFor(() => expect(calls).toEqual([{ method: "DELETE", body: { slug: "u8-white", purgeData: false } }]));
  });
});

describe("TeamWizard — two Squadi teams on one squad", () => {
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const NOTE = "Two rows make one squad that plays as two teams each round, like McKay and McKain.";
  const startCreate = async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
  };
  const fillBoth = () => {
    fill("Squadi competition ID", "1844"); fill("Squadi division ID", "12962"); fill("Squadi team ID", "133944");
    fill("Second Squadi competition ID", "1844"); fill("Second Squadi division ID", "12960"); fill("Second Squadi team ID", "133943");
  };

  it("one row with a label input and an Add a second team link; the link reveals a second row and the note", async () => {
    await startCreate();
    expect(screen.getByLabelText("Squadi team label")).toBeTruthy();
    expect(screen.queryByLabelText("Second Squadi team label")).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    expect(screen.getByLabelText("Second Squadi team label")).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a second team" })).toBeNull();
    expect(screen.getByLabelText("Squadi team label").required).toBe(true);
    expect(screen.getByLabelText("Squadi team label").maxLength).toBe(12);
    // The season's rows sit under Competitions, ahead of any other competition.
    const inputs = [...step("Competitions").getAllByRole("textbox")].map((i) => i.getAttribute("aria-label"));
    expect(inputs.slice(0, 6)).toEqual(["Season name", "Squadi team label", "Squadi competition ID", "Squadi division ID", "Squadi team ID", "Squadi website link"]);
    expect(inputs.slice(6, 11)).toEqual(["Second Squadi team label", "Second Squadi competition ID", "Second Squadi division ID", "Second Squadi team ID", "Second Squadi website link"]);
    expect(step("Competitions").getAllByRole("textbox").every((i) => i.className.includes("adm-inp"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove the second team" }));
    expect(screen.queryByLabelText("Second Squadi team label")).toBeNull();
  });

  it("two rows need both labels, and different ones, before anything is sent", async () => {
    await startCreate();
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fillBoth();
    fill("Squadi team label", "McKay");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Give each Squadi team a label, like McKay and McKain.");
    fill("Second Squadi team label", "mckay");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The two Squadi team labels must be different.");
    expect(calls).toEqual([]);
  });

  it("posts two labelled feeds in row order; a lone row is still sent as the single object", async () => {
    await startCreate();
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fillBoth();
    fill("Squadi team label", " McKay "); fill("Second Squadi team label", "McKain");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.squadi).toEqual([
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: "133944" },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: "133943" }
    ]);
    cleanup(); calls = [];
    // A second row left empty, and a label typed on the only filled row: one feed, no label.
    await startCreate();
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fill("Squadi competition ID", "1439"); fill("Squadi division ID", "10661"); fill("Squadi team ID", "110013");
    fill("Squadi team label", "White");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.squadi).toEqual({ competitionId: "1439", divisionId: "10661", teamId: "110013" });
  });

  it("edit loads both rows back and saves them; a single-feed team opens with one row", async () => {
    teams = [{ ...U8, slug: "u9-academy", name: "U9 Academy", squadi: [
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }
    ] }, U8];
    render(<TeamWizard />);
    await screen.findByText("U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Edit U9 Academy" }));
    expect(screen.getByLabelText("Squadi team label").value).toBe("McKay");
    expect(String(screen.getByLabelText("Squadi team ID").value)).toBe("133944");
    expect(screen.getByLabelText("Second Squadi team label").value).toBe("McKain");
    expect(screen.getByLabelText("Second Squadi division ID").value).toBe("12960");
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body.squadi.map((f) => f.label)).toEqual(["McKay", "McKain"]);
    cleanup();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    expect(screen.queryByLabelText("Second Squadi team label")).toBeNull();
    expect(screen.getByRole("button", { name: "Add a second team" })).toBeTruthy();
  });
});

// The two season rows sit in the Competitions step with the team's other
// competitions: one save carries both, and each is loaded back on edit.
describe("TeamWizard — two season feeds and another competition together", () => {
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const step = (title) => within(screen.getByRole("heading", { name: title }).closest(".adm-step"));

  it("the season can be given the name the club knows it by: blank for a new team, as saved on Edit, and sent as typed", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    const s = step("Competitions");
    expect(s.getByLabelText("Season name").value).toBe("");
    expect(s.getByLabelText("Season name").getAttribute("placeholder")).toBe("Name (e.g. FQ Season)");
    expect(s.getByLabelText("Season name").maxLength).toBe(40);
    fireEvent.click(s.getByRole("button", { name: "Add a competition" }));
    expect(s.getAllByText("Competition", { selector: ".adm-fl" })).toHaveLength(1); // each competition's name box is labelled
    expect(s.getByText(/Give the season and each competition the name the club knows it by/).textContent).toMatch(/a name a link fills in can be typed over\./);
  });

  it("a season name typed for a new team is sent, trimmed; on Edit the saved name shows, and emptied it is sent empty", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Riverside U10" } });
    fireEvent.change(step("Competitions").getByLabelText("Season name"), { target: { value: "  Academy League " } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.seasonName).toBe("Academy League");
    cleanup(); calls = [];
    teams = [{ ...U8, seasonName: "Academy League" }, ENV];
    await open();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${U8.name}` }));
    expect(step("Competitions").getByLabelText("Season name").value).toBe("Academy League");
    fireEvent.change(step("Competitions").getByLabelText("Season name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect([calls[0].method, calls[0].body.seasonName]).toEqual(["PATCH", ""]);
  });

  it("the season's rows come first in the Competitions step, under Season, with the competitions below", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    const s = step("Competitions");
    expect(screen.queryByRole("heading", { name: "Squadi sync" })).toBeNull();
    expect(s.getByText("Season", { selector: ".adm-fl" })).toBeTruthy();
    const labels = s.getAllByRole("textbox").map((i) => i.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Season name", "Squadi team label", "Squadi competition ID", "Squadi division ID", "Squadi team ID", "Squadi website link",
      "Competition 1 name", "Winterfest competition ID", "Winterfest division ID", "Winterfest team ID", "Winterfest Dribl fixtures request", "Winterfest website link",
      "Competition 2 name", "Premier Invitational competition ID", "Premier Invitational division ID", "Premier Invitational team ID", "Premier Invitational Dribl fixtures request", "Premier Invitational website link"
    ]);
    // The second team's row goes between the season's first row and the competitions.
    fireEvent.click(s.getByRole("button", { name: "Add a second team" }));
    const after = s.getAllByRole("textbox").map((i) => i.getAttribute("aria-label"));
    expect(after.slice(6, 11)).toEqual(["Second Squadi team label", "Second Squadi competition ID", "Second Squadi division ID", "Second Squadi team ID", "Second Squadi website link"]);
    expect(after[11]).toBe("Competition 1 name");
  });

  it("creating a team sends the two labelled feeds and the competitions in one request", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fill("Squadi team label", "McKay"); fill("Squadi competition ID", "1844"); fill("Squadi division ID", "12962"); fill("Squadi team ID", "133944");
    fill("Second Squadi team label", "McKain"); fill("Second Squadi competition ID", "1844"); fill("Second Squadi division ID", "12960"); fill("Second Squadi team ID", "133943");
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 1 name", "Winterfest");
    fill("Winterfest competition ID", "1750"); fill("Winterfest division ID", "20001"); fill("Winterfest team ID", "300123");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.squadi).toEqual([
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: "133944" },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: "133943" }
    ]);
    expect(calls[0].body.competitions).toEqual([{ name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: "300123" }, scores: true }]);
  });

  it("the label check stops the save before the competitions are sent either", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fill("Squadi competition ID", "1844"); fill("Second Squadi competition ID", "1844");
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 1 name", "Winterfest");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Give each Squadi team a label, like McKay and McKain.");
    expect(calls).toEqual([]);
  });

  it("edit loads the two feeds and the competitions back, and a save keeps each competition's id", async () => {
    teams = [{ ...U8, slug: "u9-academy", name: "U9 Academy", squadi: [
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }
    ] }];
    render(<TeamWizard />);
    await screen.findByText("U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Edit U9 Academy" }));
    expect(screen.getByLabelText("Second Squadi team label").value).toBe("McKain");
    expect(screen.getByLabelText("Competition 1 name").value).toBe("Winterfest");
    expect(String(screen.getByLabelText("Winterfest team ID").value)).toBe("300123");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.squadi.map((f) => [f.label, String(f.teamId)])).toEqual([["McKay", "133944"], ["McKain", "133943"]]);
    expect(calls[0].body.competitions.map((c) => [c.id, c.name])).toEqual([["c1a2b3c4d", "Winterfest"], ["c5e6f7a8b", "Premier Invitational"]]);
  });

  it("removing the second team sends the season as the single feed it was, competitions untouched", async () => {
    teams = [{ ...U8, slug: "u9-academy", name: "U9 Academy", squadi: [
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }
    ] }];
    render(<TeamWizard />);
    await screen.findByText("U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Edit U9 Academy" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the second team" }));
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.squadi).toEqual({ competitionId: "1844", divisionId: "12962", teamId: 133944 });
    expect(calls[0].body.competitions).toHaveLength(2);
  });
});

// Each draw (the season's row or rows, and every other competition) can carry
// a website link: a copy of the page the draw is on, kept beside its ids.
describe("TeamWizard — a website link beside each draw", () => {
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const SEASON_LINK = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=b0e92958&competitionUniqueKey=4a2f&divisionId=10661&teamId=110013";
  const WINTER_LINK = "https://footballqueensland.com.au/winterfest/draw/";
  const PREMIER_LINK = "https://premierinvitational.dribl.com/fixtures?season=RwNlzVMdjr&club=PydoO0nJdD";
  const linked = () => ({
    ...U8, squadi: { ...U8.squadi, link: SEASON_LINK },
    competitions: [{ ...U8.competitions[0], link: WINTER_LINK }, { ...U8.competitions[1], link: PREMIER_LINK }]
  });
  const edit = async () => { await open(); fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" })); };
  const save = async () => { fireEvent.click(screen.getByRole("button", { name: /^Save/ })); await waitFor(() => expect(calls).toHaveLength(1)); return calls[0].body; };
  const opener = (who) => screen.queryByRole("link", { name: `Open the ${who} website link in a new tab` });

  it("every draw's row has the field, and a note says what it is for", async () => {
    await edit();
    for (const who of ["Squadi", "Winterfest", "Premier Invitational"]) {
      const field = screen.getByLabelText(`${who} website link`);
      expect(field.value).toBe("");
      expect(field.getAttribute("placeholder")).toBe("Paste the draw's page link (https://…)");
      expect(field.getAttribute("inputmode")).toBe("url");
    }
    expect(step("Competitions").getByText(/The link is kept with its draw/).textContent)
      .toBe("The link is kept with its draw and shown on the team's league page, so families can open the draw. A link to any other site can go here too: it is kept and nothing is read from it.");
    expect(screen.getByRole("heading", { level: 4, name: "Competitions" }).closest(".adm-step").textContent).not.toMatch(EMOJI);
  });

  it("a new team's links are sent with their rows, trimmed; a row with only a link is still a row", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fill("Squadi website link", "  " + SEASON_LINK + "  ");
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 1 website link", WINTER_LINK);
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 2 name", "Premier Invitational");
    fill("Premier Invitational competition ID", "1900");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    // The season's draw page is known before its ids: the row is sent with the link alone.
    expect(calls[0].body.squadi).toEqual({ competitionId: "", divisionId: "", teamId: "", link: SEASON_LINK });
    expect(calls[0].body.competitions).toEqual([
      { name: "", link: WINTER_LINK },
      { name: "Premier Invitational", squadi: { competitionId: "1900", divisionId: "", teamId: "" }, scores: true }
    ]);
  });

  it("two season rows each send their own link", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Add a second team" }));
    fill("Squadi team label", "McKay"); fill("Squadi competition ID", "1844"); fill("Squadi division ID", "12962"); fill("Squadi team ID", "133944");
    fill("Second Squadi team label", "McKain"); fill("Second Squadi competition ID", "1844"); fill("Second Squadi division ID", "12960"); fill("Second Squadi team ID", "133943");
    fill("Squadi website link", SEASON_LINK);
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.squadi).toEqual([
      { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: "133944", link: SEASON_LINK },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: "133943" }
    ]);
  });

  it("edit loads each link back, and saving unchanged sends them as they were", async () => {
    teams = [linked(), ENV];
    await edit();
    expect(screen.getByLabelText("Squadi website link").value).toBe(SEASON_LINK);
    expect(screen.getByLabelText("Winterfest website link").value).toBe(WINTER_LINK);
    expect(screen.getByLabelText("Premier Invitational website link").value).toBe(PREMIER_LINK);
    const body = await save();
    expect(body.squadi).toEqual({ competitionId: "1439", divisionId: "10661", teamId: "110013", link: SEASON_LINK });
    expect(body.competitions).toEqual([
      { id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 }, link: WINTER_LINK },
      { id: "c5e6f7a8b", name: "Premier Invitational", link: PREMIER_LINK }
    ]);
  });

  it("a saved link can be opened from its row: a new tab, to that address and nowhere else", async () => {
    teams = [linked(), ENV];
    await edit();
    for (const [who, href] of [["Squadi", SEASON_LINK], ["Winterfest", WINTER_LINK], ["Premier Invitational", PREMIER_LINK]]) {
      const a = opener(who);
      expect(a.getAttribute("href")).toBe(href);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.textContent).toBe("Open");
      // It sits straight after its field, inside the same row.
      expect(a.previousElementSibling).toBe(screen.getByLabelText(`${who} website link`));
    }
  });

  it("the Open link follows what is typed, and is only there for a web address", async () => {
    await edit();
    expect(opener("Winterfest")).toBeNull();
    fill("Winterfest website link", "footballqueensland.com.au/winterfest");
    expect(opener("Winterfest")).toBeNull();
    for (const notOne of ["http://footballqueensland.com.au/winterfest", "javascript:alert(1)", "https://fixtures", "https://user:pw@footballqueensland.com.au/x", "   "]) {
      fill("Winterfest website link", notOne);
      expect(opener("Winterfest"), notOne).toBeNull();
    }
    fill("Winterfest website link", "  " + WINTER_LINK + " ");
    expect(opener("Winterfest").getAttribute("href")).toBe(WINTER_LINK);
    // Only this row's: the others have none.
    expect(opener("Squadi")).toBeNull();
    expect(opener("Premier Invitational")).toBeNull();
    expect(screen.getAllByRole("link", { name: /website link in a new tab$/ })).toHaveLength(1);
  });

  it("clearing a link sends its row without one, so it is removed", async () => {
    teams = [linked(), ENV];
    await edit();
    fill("Squadi website link", "");
    fill("Winterfest website link", "  ");
    const body = await save();
    expect(body.squadi).toEqual({ competitionId: "1439", divisionId: "10661", teamId: "110013" });
    expect(body.competitions[0]).toEqual({ id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } });
    expect(body.competitions[1].link).toBe(PREMIER_LINK);
  });

  it("on an edit the season is always sent: emptying every field of it removes it, link and all", async () => {
    teams = [{ ...U8, squadi: { competitionId: "", divisionId: "", teamId: 0, link: SEASON_LINK } }, ENV];
    await edit();
    expect(screen.getByLabelText("Squadi competition ID").value).toBe("");
    fill("Squadi website link", "");
    expect((await save()).squadi).toEqual({});
  });

  it("an edit of a team with no season sends an empty one, which changes nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Env Team" }));
    expect((await save()).squadi).toEqual({});
  });

  it("shows the server's sentence when a link is refused, and keeps what was typed", async () => {
    reply = (method) => (method === "PATCH" ? { ok: false, status: 400, json: async () => ({ error: "Winterfest: A website link should be a full address starting with https://" }) } : null);
    await edit();
    fill("Winterfest website link", "footballqueensland.com.au/winterfest");
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Winterfest: A website link should be a full address starting with https://");
    expect(screen.getByLabelText("Winterfest website link").value).toBe("footballqueensland.com.au/winterfest");
    expect(calls[0].body.competitions[0].link).toBe("footballqueensland.com.au/winterfest");
  });
});

// A competition whose draw is on Dribl takes its fixtures request instead of
// Squadi ids, with the team's name as Dribl shows it.
describe("TeamWizard — a competition on Dribl", () => {
  const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=S1&competition=C1&league=L1&club=CL1&tenant=T1&timezone=Australia%2FBrisbane";
  const startCreate = async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 1 name", "Premier Invitational");
  };

  it("each competition has a field for its Dribl request; the team-name field appears once there is one", async () => {
    await startCreate();
    const request = screen.getByLabelText("Premier Invitational Dribl fixtures request");
    expect(request.className).toContain("adm-inp");
    expect(request.getAttribute("placeholder")).toBe("Or, for a draw on Dribl, its fixtures request (https://mc-api.dribl.com/api/fixtures?…)");
    expect(screen.queryByLabelText("Premier Invitational team name on Dribl")).toBeNull();
    fill("Premier Invitational Dribl fixtures request", REQUEST);
    expect(screen.getByLabelText("Premier Invitational team name on Dribl").getAttribute("placeholder")).toBe("Your team's name as Dribl shows it");
    // The step explains where a request typed by hand comes from, and when a Dribl draw is synced.
    expect(screen.getByText(/Everything a link fills in can also be typed by hand/).textContent)
      .toMatch(/A Dribl fixtures request is the address of the request that starts with\s+https:\/\/mc-api\.dribl\.com\/api\/fixtures, in DevTools under Network on the competition's Dribl fixtures page; add your\s+team's name as Dribl shows it when the draw has more than one of your club's teams\.$/);
    expect(screen.getByText(/Add a competition for anything played alongside the season/).textContent)
      .toMatch(/A draw on Squadi or Majestri syncs for everyone; a draw on Dribl is kept in step whenever a coach opens the team\. The season's scores are entered by hand\./);
  });

  it("sends the request, trimmed, with the team's name; no Squadi ids are invented for it", async () => {
    await startCreate();
    fill("Premier Invitational Dribl fixtures request", "  " + REQUEST + "  ");
    fill("Premier Invitational team name on Dribl", " Olympic FC U9 White ");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([{ name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic FC U9 White" }, scores: true }]);
  });

  it("a row with only its Dribl request is still a row; one with Squadi ids and no request sends no dribl at all", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
    fill("Team name", "U9 Academy");
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 1 Dribl fixtures request", REQUEST);
    fireEvent.click(screen.getByRole("button", { name: "Add a competition" }));
    fill("Competition 2 name", "Winterfest");
    fill("Winterfest competition ID", "1750");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([
      { name: "", dribl: { url: REQUEST, team: "" }, scores: true },
      { name: "Winterfest", squadi: { competitionId: "1750", divisionId: "", teamId: "" }, scores: true }
    ]);
  });

  it("shows the server's sentence when the link is not a Dribl request, and keeps the form as it was", async () => {
    reply = (method) => (method === "POST" ? { ok: false, status: 400, json: async () => ({ error: "Premier Invitational: That is not a Dribl fixtures request. It should start with https://mc-api.dribl.com/api/fixtures?" }) } : null);
    await startCreate();
    fill("Premier Invitational Dribl fixtures request", "https://premierinvitational.dribl.com/fixtures?season=S1");
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Premier Invitational: That is not a Dribl fixtures request. It should start with https://mc-api.dribl.com/api/fixtures?");
    expect(screen.getByLabelText("Premier Invitational Dribl fixtures request").value).toBe("https://premierinvitational.dribl.com/fixtures?season=S1");
  });

  it("edit loads the request and the team's name back, and a save keeps the competition's id", async () => {
    teams = [{ ...U8, competitions: [
      { id: "cprem0001", name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic FC U9 White" } },
      { id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } }
    ] }];
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    expect(screen.getByLabelText("Premier Invitational Dribl fixtures request").value).toBe(REQUEST);
    expect(screen.getByLabelText("Premier Invitational team name on Dribl").value).toBe("Olympic FC U9 White");
    // The Squadi competition beside it has an empty Dribl field and no team-name field.
    expect(screen.getByLabelText("Winterfest Dribl fixtures request").value).toBe("");
    expect(screen.queryByLabelText("Winterfest team name on Dribl")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([
      { id: "cprem0001", name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic FC U9 White" } },
      { id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } }
    ]);
  });

  it("clearing the request on edit sends the competition with no source, so the server drops it", async () => {
    teams = [{ ...U8, competitions: [{ id: "cprem0001", name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic FC U9 White" } }] }];
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Olympic FC U8 White" }));
    fill("Premier Invitational Dribl fixtures request", "");
    expect(screen.queryByLabelText("Premier Invitational team name on Dribl")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body.competitions).toEqual([{ id: "cprem0001", name: "Premier Invitational" }]);
  });
});
