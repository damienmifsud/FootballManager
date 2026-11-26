// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import TeamWizard from "@/components/TeamWizard";

// The team wizard, when the Majestri list pasted for a new team has coach and
// manager rows: they are offered for the staff rows under Team identity and
// move there only when asked. In a file of its own; everyone below is made up.
const HEAD = "Role,FirstName,Surname,DateOfBirth,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber";
const LIST = [
  HEAD,
  "Coach,Pat,Lane,02 Feb 1980,Pat,Lane,Pat@Example.com,400000201",
  "Assistant Coach,Sam,Kelly,03 Mar 1982,Sam,Kelly,sam@example.com,0400000202",
  "Trainer,Jo,Marsh,,Robin,Marsh,robin@example.com,0400000301",
  "Player,Leo,Kelly,02/05/2017,Sam,Kelly,sam@example.com,0400000202",
  "Player,Tess,Lane,11/09/2017,Pat,Lane,pat@example.com,0400000201"
].join("\n");

let calls; // { method, body } for every non-GET request
beforeEach(() => {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).includes("/api/teams")) throw new Error("unexpected fetch " + url);
    const method = opts.method || "GET";
    if (method === "GET") return { ok: true, json: async () => ({ teams: [] }) };
    const body = JSON.parse(opts.body);
    calls.push({ method, body });
    const team = { slug: "new-team", name: body.name, password: body.password, source: "stored", coachEmails: [] };
    return { ok: true, json: async () => ({ ok: true, team, playersImported: (body.players || []).length, trainingSeeded: 0 }) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const step = (title) => within(screen.getByRole("heading", { level: 4, name: title }).closest(".adm-step"));
const openNew = async () => {
  render(<TeamWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a team" }));
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Riverside U9 Reds" } });
};
const pasteList = (text = LIST) => fireEvent.change(screen.getByLabelText("Player import"), { target: { value: text } });
const offer = () => step("Players and parents").queryByRole("group", { name: "Staff in this file" });
const useButton = () => step("Players and parents").queryByRole("button", { name: "Use them as this team's staff" });
const field = (label) => screen.getByLabelText(label).value;
const create = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Create team" }));
  await screen.findByText("Riverside U9 Reds is live");
  return calls[0].body;
};

describe("TeamWizard — staff from the player list", () => {
  it("names the staff it found and offers them; nothing moves until asked", async () => {
    await openNew();
    expect(offer()).toBeNull();
    pasteList();
    expect(step("Players and parents").getByText("2 players ready:")).toBeTruthy();
    expect(offer().textContent).toContain("3 staff in this file: Pat Lane (Coach), Sam Kelly (Assistant coach), Jo Marsh (Trainer).");
    expect(offer().textContent).toContain("They are not on the staff list yet.");
    expect(useButton()).toBeTruthy();
    expect(field("Head coach name")).toBe("");
    // Created without pressing it: the players go, the staff do not.
    const body = await create();
    expect(body.players.map((p) => p.name)).toEqual(["Leo K.", "Tess L."]);
    expect(body.staff).toEqual([]);
  });

  it("Use them fills the Head coach and Assistant coach rows and adds the rest, with a login only for an address that is theirs", async () => {
    await openNew();
    pasteList();
    fireEvent.click(useButton());
    expect([field("Head coach name"), field("Head coach mobile"), field("Head coach email")]).toEqual(["Pat Lane", "0400000201", "pat@example.com"]);
    expect([field("Assistant coach name"), field("Assistant coach mobile"), field("Assistant coach email")]).toEqual(["Sam Kelly", "0400000202", "sam@example.com"]);
    expect(field("Manager name")).toBe("");
    // The trainer's contact in the file is someone else, so no address is taken for them.
    expect([field("Title for staff member 4"), field("Trainer name"), field("Trainer mobile"), field("Trainer email")]).toEqual(["Trainer", "Jo Marsh", "", ""]);
    expect(offer().textContent).toContain("Already in the staff list under Team identity.");
    expect(useButton()).toBeNull();
    const body = await create();
    expect(body.staff).toEqual([
      { role: "Head coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com" },
      { role: "Trainer", name: "Jo Marsh", mobile: "", email: "" }
    ]);
    expect(body.players.map((p) => p.name)).toEqual(["Leo K.", "Tess L."]); // staff are never players
    expect(JSON.stringify(body.staff)).not.toMatch(/robin@example\.com|1980|1982/);
  });

  it("rows already typed in are kept as typed and only their blanks are filled; the rows stay editable afterwards", async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText("Head coach name"), { target: { value: "Pat" } });
    fireEvent.change(screen.getByLabelText("Head coach email"), { target: { value: "coach@example.com" } });
    pasteList();
    fireEvent.click(useButton());
    expect([field("Head coach name"), field("Head coach mobile"), field("Head coach email")]).toEqual(["Pat", "0400000201", "coach@example.com"]);
    fireEvent.change(screen.getByLabelText("Assistant coach email"), { target: { value: "" } });
    // Clearing an address by hand is not undone: the offer comes back, it is not re-applied.
    expect(field("Assistant coach email")).toBe("");
    expect(useButton()).toBeTruthy();
    const body = await create();
    expect(body.staff.slice(0, 2)).toEqual([
      { role: "Head coach", name: "Pat", mobile: "0400000201", email: "coach@example.com" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "" }
    ]);
  });

  it("a list with no staff rows, or a simple list, offers nothing", async () => {
    await openNew();
    pasteList([HEAD, "Player,Leo,Kelly,02/05/2017,Sam,Kelly,sam@example.com,0400000202"].join("\n"));
    expect(offer()).toBeNull();
    pasteList("Leo, 9, FWD, Sam, 0400 000 202");
    expect(offer()).toBeNull();
    // Staff rows and no players: the staff are still offered, with no "nothing readable" warning.
    pasteList([HEAD, "Coach,Pat,Lane,,Pat,Lane,pat@example.com,0400000201"].join("\n"));
    expect(offer().textContent).toContain("1 staff member in this file: Pat Lane (Coach).");
    expect(step("Players and parents").queryByText("Nothing readable yet. Check the format.")).toBeNull();
  });
});
