// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";

// Import player list, when the file has coach and manager rows: they are read
// back as the team's staff and come across with the players in one save,
// unless the coach switches them off. These render the real component in
// jsdom, like test/Dashboard.test.jsx, in a file of their own. Everyone in
// the lists below is made up.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

const HEAD = "Role,FirstName,Surname,DateOfBirth,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber";
const COACH = "Coach,Pat,Lane,02 Feb 1980,Pat,Lane,Pat@Example.com,400000201";
const ASSISTANT = "Assistant Coach,Sam,Kelly,03 Mar 1982,Sam,Kelly,sam@example.com,0400000202";
const LEO = "Player,Leo,Kelly,02/05/2017,Sam,Kelly,sam@example.com,0400000202";
const TESS = "Player,Tess,Lane,11/09/2017,Pat,Lane,pat@example.com,0400000201";
const LIST = [HEAD, COACH, ASSISTANT, LEO, TESS].join("\n");

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", parentsSee: { planBeforeKickoff: true } },
    players: [], fixtures: [], sessions: [], isSample: false, ...over
  };
}

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  // /api/me and the other endpoints do not exist under test: the team-code view.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const chip = () => screen.getByRole("button", { name: "Viewing as" });
// Load the team, enter coach mode, open Squad and the import sheet.
const openImport = async (data) => {
  storage.get.mockResolvedValue({ value: JSON.stringify(data) });
  render(<App />);
  fireEvent.click(await waitForLoaded());
  fireEvent.click(await screen.findByText("Coach mode"));
  await waitFor(() => expect(chip().textContent).toBe("Coach"));
  fireEvent.click(within(screen.getByRole("navigation")).getByText("Squad"));
  await screen.findByText("Players", { selector: ".label" });
  fireEvent.click(within(document.querySelector(".pr-foot")).getByText("Import player list"));
  await screen.findByText("Import player list", { selector: ".sheet h2" });
};
const paste = (text) => fireEvent.change(screen.getByLabelText("Player list"), { target: { value: text } });
const sheetButton = () => document.querySelector(".sheet .btn");
const saved = () => JSON.parse(storage.set.mock.calls.at(-1)[1]);
const staffBlock = () => screen.queryByRole("group", { name: "Staff in this file" });
const staffSwitch = () => screen.getByRole("switch", { name: "Bring in the staff from this file" });
// Each person read back: [name and title, what happens].
const staffLines = () => [...staffBlock().querySelectorAll(".imp-row span")].map((el) => {
  const [who, what] = el.innerHTML.split(/<br\s*\/?>/);
  const text = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
  return [text(who), text(what)];
});

describe("Import player list — the file's staff", () => {
  it("reads the coach and assistant coach back as the team's staff, saying who will be able to sign in", async () => {
    await openImport(makeData());
    expect(screen.getByText(/Coach and manager rows are offered as the team's staff, and you choose whether they come in\./)).toBeTruthy();
    expect(staffBlock()).toBeNull(); // nothing pasted yet
    paste(LIST);
    expect(within(staffBlock()).getByText(/staff in this file\. Bring them in as the team's staff\./).textContent).toBe("2 staff in this file. Bring them in as the team's staff.");
    expect(staffSwitch().getAttribute("aria-checked")).toBe("true");
    expect(staffLines()).toEqual([
      ["Pat Lane · Head coach", "Will be added, and can sign in as pat@example.com."],
      ["Sam Kelly · Assistant coach", "Will be added, and can sign in as sam@example.com."]
    ]);
    expect(within(staffBlock()).getByText("Staff who can sign in can edit this team: fixtures, scores, the squad and its settings. Check each address is theirs.")).toBeTruthy();
    expect(sheetButton().textContent).toBe("Add 2 players, add 2 staff");
    // The players' own read-back is as it always was: the staff are not players.
    expect(screen.getByRole("status").textContent).toContain("Ready to add 2: Leo K., Tess L.");
  });

  it("one save carries the squad and the staff list, and leaves the rest of the team's settings alone", async () => {
    await openImport(makeData());
    paste(LIST);
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    const doc = saved();
    expect(doc.players.map((p) => [p.name, p.surname])).toEqual([["Leo K.", "Kelly"], ["Tess L.", "Lane"]]);
    expect(doc.team.staff).toEqual([
      { role: "Head coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com", photo: "" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com", photo: "" }
    ]);
    expect(doc.team).toMatchObject({ name: "Test FC", division: "Div 1", ageGroup: "U9", parentsSee: { planBeforeKickoff: true } });
    expect(JSON.stringify(doc.team.staff)).not.toMatch(/1980|1982/); // no date of birth comes across for staff
    expect(document.querySelector(".sheet")).toBeNull();
    // They are on the Squad tab's coaches card straight away.
    expect(await screen.findByText("Pat Lane")).toBeTruthy();
    expect(screen.getByText("Sam Kelly")).toBeTruthy();
  });

  it("switched off, only the players come in and the staff list is not written", async () => {
    const data = makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", headCoach: "Byron" } });
    await openImport(data);
    paste(LIST);
    expect(sheetButton().textContent).toBe("Add 2 players, add 2 staff");
    fireEvent.click(staffSwitch());
    expect(staffSwitch().getAttribute("aria-checked")).toBe("false");
    expect(staffBlock().querySelectorAll(".imp-row")).toHaveLength(0);
    expect(within(staffBlock()).getByText("The staff list is left as it is.")).toBeTruthy();
    expect(sheetButton().textContent).toBe("Add 2 players");
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(saved().players).toHaveLength(2);
    expect(saved().team).toEqual(data.team); // no staff array written
  });

  it("someone already on the staff is matched, by full name or by the first name they were typed under, and only their blanks are filled", async () => {
    await openImport(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", staff: [
      { role: "Head coach", name: "Pat", mobile: "", email: "", photo: "data:pat" },
      { role: "Kit and oranges", name: "sam kelly", mobile: "0499999999", email: "work@example.com", photo: "" }
    ] } }));
    paste(LIST);
    expect(staffLines()).toEqual([
      ["Pat Lane · Head coach", "Already on the staff as Pat. Adding their email, pat@example.com, so they can sign in."],
      ["Sam Kelly · Kit and oranges", "Already on the staff."]
    ]);
    expect(sheetButton().textContent).toBe("Add 2 players, update 1 staff");
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(saved().team.staff).toEqual([
      { role: "Head coach", name: "Pat", mobile: "0400000201", email: "pat@example.com", photo: "data:pat" },
      { role: "Kit and oranges", name: "sam kelly", mobile: "0499999999", email: "work@example.com", photo: "" }
    ]);
  });

  it("a team set up with the older coach fields keeps those people when the list is first written", async () => {
    await openImport(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", headCoach: "Byron Hale", headCoachContact: "0400 000 900", manager: "Dee" } }));
    paste(LIST);
    expect(staffLines().map((l) => l[0])).toEqual(["Pat Lane · Coach", "Sam Kelly · Assistant coach"]); // Byron stays the head coach
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(saved().team.staff.map((s) => [s.role, s.name, s.mobile, s.email])).toEqual([
      ["Head coach", "Byron Hale", "0400 000 900", ""],
      ["Manager", "Dee", "", ""],
      ["Coach", "Pat Lane", "0400000201", "pat@example.com"],
      ["Assistant coach", "Sam Kelly", "0400000202", "sam@example.com"]
    ]);
  });

  it("when the players are already up to date the staff can still come in on their own", async () => {
    await openImport(makeData({ players: [
      { id: "p1", name: "Leo K.", surname: "Kelly", dob: "2017-05-02", number: 1, position: "MID", parentName: "Sam Kelly", parentEmails: ["sam@example.com"] },
      { id: "p2", name: "Tess L.", surname: "Lane", dob: "2017-09-11", number: 2, position: "MID", parentName: "Pat Lane", parentEmails: ["pat@example.com"] }
    ] }));
    paste(LIST);
    expect(screen.getByRole("status").textContent).toContain("2 already up to date.");
    expect(sheetButton().textContent).toBe("Add 2 staff");
    expect(sheetButton().disabled).toBe(false);
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(saved().team.staff.map((s) => s.name)).toEqual(["Pat Lane", "Sam Kelly"]);
    expect(saved().players.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("importing the same file again has nothing to do, and says so", async () => {
    await openImport(makeData({
      team: { name: "Test FC", division: "Div 1", ageGroup: "U9", coachPin: "", staff: [
        { role: "Head coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com", photo: "" },
        { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com", photo: "" }
      ] },
      players: [
        { id: "p1", name: "Leo K.", surname: "Kelly", dob: "2017-05-02", number: 1, position: "MID", parentName: "Sam Kelly", parentEmails: ["sam@example.com"] },
        { id: "p2", name: "Tess L.", surname: "Lane", dob: "2017-09-11", number: 2, position: "MID", parentName: "Pat Lane", parentEmails: ["pat@example.com"] }
      ]
    }));
    paste(LIST);
    expect(staffLines().map((l) => l[1])).toEqual(["Already on the staff.", "Already on the staff."]);
    expect(within(staffBlock()).queryByText(/Staff who can sign in/)).toBeNull(); // nobody gains a login
    expect(sheetButton().textContent).toBe("Nothing to change");
    expect(sheetButton().disabled).toBe(true);
    fireEvent.click(sheetButton());
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("a staff member whose contact in the file is someone else comes in without a login", async () => {
    await openImport(makeData());
    paste([HEAD, "Manager,Dee,Finch,,Robin,Finch,robin@example.com,0400000301", LEO].join("\n"));
    expect(within(staffBlock()).getByText(/in this file/).textContent).toBe("1 staff member in this file. Bring them in as the team's staff.");
    expect(staffLines()).toEqual([["Dee Finch · Manager", "Will be added. No email for them in the file, so no login yet."]]);
    expect(within(staffBlock()).queryByText(/Staff who can sign in/)).toBeNull();
    expect(sheetButton().textContent).toBe("Add 1 player, add 1 staff");
    fireEvent.click(sheetButton());
    await waitFor(() => expect(storage.set).toHaveBeenCalledTimes(1));
    expect(saved().team.staff).toEqual([{ role: "Manager", name: "Dee Finch", mobile: "", email: "", photo: "" }]);
    expect(JSON.stringify(saved().team.staff)).not.toContain("robin@example.com");
  });

  it("a file with staff and no players is still readable; a simple list offers no staff", async () => {
    await openImport(makeData());
    paste([HEAD, COACH].join("\n"));
    expect(screen.queryByText("Nothing readable yet. Check the format.")).toBeNull();
    expect(sheetButton().textContent).toBe("Add 1 staff");
    paste("Leo, 9, FWD, Sam, 0400 000 202");
    expect(staffBlock()).toBeNull();
    expect(sheetButton().textContent).toBe("Add 1 player");
    paste("Role,Firstname,Surname,Email"); // a header and nothing under it
    expect(screen.getByText("Nothing readable yet. Check the format.")).toBeTruthy();
    expect(sheetButton().disabled).toBe(true);
  });
});
