import { describe, it, expect } from "vitest";
import { parseDob, fixMobile, splitCSV, parsePlayerImport, sanitizePlayers, mergeImportedPlayers, mergeImportedStaff, PLAYER_FILE_ACCEPT } from "@/lib/majestri";

describe("parseDob", () => {
  it("accepts ISO, AU dd/mm/yyyy and spelled-month forms", () => {
    expect(parseDob("2018-03-12")).toBe("2018-03-12");
    expect(parseDob("12/03/2018")).toBe("2018-03-12");
    expect(parseDob("12 Mar 2018")).toBe("2018-03-12");
    expect(parseDob("25-Oct-18")).toBe("2018-10-25"); // Excel 2-digit year -> 20xx
    expect(parseDob("garbage")).toBe("");
    expect(parseDob("")).toBe("");
  });
});

describe("fixMobile", () => {
  it("restores stripped leading zeros and unwraps +61", () => {
    expect(fixMobile("400123456")).toBe("0400123456");   // spreadsheet dropped the 0
    expect(fixMobile("+61 400 987 654")).toBe("0400987654");
    expect(fixMobile("0400 123 456")).toBe("0400123456");
    expect(fixMobile("123")).toBe("");
    expect(fixMobile("")).toBe("");
  });
});

describe("splitCSV", () => {
  it("handles quoted fields containing commas and escaped quotes", () => {
    expect(splitCSV('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(splitCSV('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});

const HEADER_CSV = [
  "Role,FirstName,Surname,DateOfBirth,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber,EmergencyContactFirstName,EmergencyContactSurname,EmergencyContactEmailAddress,EmergencyContactMobileNumber",
  "Player,Spencer,Mifsud,12 Mar 2018,Damien,Mifsud,damien@dam.fund,400123456,Jane,Mifsud,jane@dam.fund,61400987654",
  "Coach,Byron,Smith,,,,byron@club.com,0400111222,,,,",
  "Player,Isla,Jones,25-Oct-18,Kate,Jones,kate@jones.com,0400555666,,,,"
].join("\n");

describe("parsePlayerImport — Majestri header CSV", () => {
  it("parses players, skips coach rows, captures guardians and emails", () => {
    const { isMajestri, players } = parsePlayerImport(HEADER_CSV);
    expect(isMajestri).toBe(true);
    expect(players).toHaveLength(2); // coach row skipped
    const [sp, isla] = players;
    expect(sp).toMatchObject({
      name: "Spencer M.", dob: "2018-03-12",
      parentName: "Damien Mifsud", parentContact: "0400123456"
    });
    expect(sp.parentEmails).toEqual(["damien@dam.fund", "jane@dam.fund"]);
    expect(sp.guardians).toHaveLength(2);
    expect(isla).toMatchObject({ name: "Isla J.", dob: "2018-10-25", parentName: "Kate Jones" });
    expect(isla.parentEmails).toEqual(["kate@jones.com"]);
  });
});

describe("parsePlayerImport — headerless Excel copy (positional)", () => {
  it("detects wide tab rows starting with Player/Coach", () => {
    const row = (role, first, last, dob, pf, pl, pe, pm) => [
      role, first, last, dob, "F", "reg", "ffa", "", "group", "school", "", "",
      pf, pl, pe, pm, "", "yes", "", "", "", ""
    ].join("\t");
    const txt = [
      row("Player", "Sam", "Smith", "12/03/2018", "Ann", "Smith", "ann@x.com", "400123456"),
      row("Manager", "Mia", "Brown", "", "", "", "", "")
    ].join("\n");
    const { isMajestri, players } = parsePlayerImport(txt);
    expect(isMajestri).toBe(true);
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ name: "Sam S.", dob: "2018-03-12", parentContact: "0400123456" });
    expect(players[0].parentEmails).toEqual(["ann@x.com"]);
  });
});

describe("parsePlayerImport — simple list", () => {
  it("parses 'Name, number, position, parent, mobile, dob' lines", () => {
    const { isMajestri, players } = parsePlayerImport("Spencer, 6, MID, Damien, 0400 000 000, 12/03/2018\nBillie");
    expect(isMajestri).toBe(false);
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({ name: "Spencer", number: 6, position: "MID", parentName: "Damien", dob: "2018-03-12" });
    expect(players[1]).toMatchObject({ name: "Billie", number: 2, position: "MID" });
  });

  it("returns nothing for empty input", () => {
    expect(parsePlayerImport("").players).toEqual([]);
    expect(parsePlayerImport(null).players).toEqual([]);
  });
});

describe("sanitizePlayers (server-side guard)", () => {
  it("keeps known fields, filters junk emails, regenerates ids", () => {
    const out = sanitizePlayers([
      { id: "evil", name: " Sam ", number: "7", position: "gk", dob: "2018-03-12",
        parentEmails: ["ok@x.com", "not-an-email"], guardians: [{ name: "Ann", email: "ann@x.com", mobile: "0400 123 456" }],
        parentName: "Ann", parentContact: "0400123456", extra: "dropped" },
      { name: "" },
      null
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Sam", number: 7, position: "GK", dob: "2018-03-12", parentEmails: ["ok@x.com"] });
    expect(out[0].id).not.toBe("evil");
    expect(out[0]).not.toHaveProperty("extra");
    expect(out[0].guardians[0]).toEqual({ name: "Ann", email: "ann@x.com", mobile: "0400123456" });
  });

  it("caps the roster size and tolerates non-arrays", () => {
    expect(sanitizePlayers(Array.from({ length: 300 }, (_, i) => ({ name: "P" + i })))).toHaveLength(200);
    expect(sanitizePlayers("junk")).toEqual([]);
  });
});

// Last names. A Majestri player is stored as a short display name (first name
// + initial, for tight spots) plus the full last name in `surname`; the squad
// list shows both. The import used to shorten the surname to its initial and
// throw the rest away.
const NAMES_CSV = [
  "Role,FirstName,Surname,DateOfBirth,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber",
  "Player,Leo,Kelly,02/05/2017,Sam,Kelly,sam@example.com,0400000001",
  "Player,Ana,van Dyk,11/09/2017,Rita,van Dyk,rita@example.com,0400000002",
  "Player,Billie,,,,,,",
  "Coach,Byron,Smith,,,,,"
].join("\n");

describe("parsePlayerImport — last names", () => {
  it("keeps the full last name beside the first-name-and-initial display name", () => {
    const { players } = parsePlayerImport(NAMES_CSV);
    expect(players.map((p) => [p.name, p.surname])).toEqual([["Leo K.", "Kelly"], ["Ana v.", "van Dyk"], ["Billie", undefined]]);
    expect(players[2]).not.toHaveProperty("surname"); // no key at all when the export has none
  });

  it("does the same for a headerless Excel copy", () => {
    const row = (role, first, last) => [role, first, last, "12/03/2018", "F", "reg", "ffa", "", "group", "school", "", "", "Ann", last, "ann@example.com", "400123456", "", "yes", "", "", "", ""].join("\t");
    const { players } = parsePlayerImport([row("Player", "Sam", "  O'Brien "), row("Player", "Mia", "Brown")].join("\n"));
    expect(players.map((p) => [p.name, p.surname])).toEqual([["Sam O.", "O'Brien"], ["Mia B.", "Brown"]]);
  });

  it("a simple list keeps the name exactly as typed and adds no surname", () => {
    const { players } = parsePlayerImport("Leo Kelly, 7\nAna");
    expect(players.map((p) => p.name)).toEqual(["Leo Kelly", "Ana"]);
    for (const p of players) expect(p).not.toHaveProperty("surname");
  });
});

describe("parsePlayerImport — an uploaded file", () => {
  it("reads a file that starts with a byte-order mark: coach rows are still skipped", () => {
    // Left in, the mark hides the first header ("Role") and every row counts as a player.
    const { isMajestri, players } = parsePlayerImport("\uFEFF" + NAMES_CSV);
    expect(isMajestri).toBe(true);
    expect(players.map((p) => p.name)).toEqual(["Leo K.", "Ana v.", "Billie"]);
  });

  it("reads Windows line endings and the extra columns of a full team contact list", () => {
    const head = "Role,FirstName,Surname,DateOfBirth,Gender,RegistrationDate,PlayerFFANumber,PlayerATSIStatus,PlayerPlayingGroup,PlayerSchool,PlayerMedicalConditions,PlayerMedicalNotes,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber,PrimaryContactPhoneNumber,MediaRelease,EmergencyContactFirstName,EmergencyContactSurname,EmergencyContactEmailAddress,EmergencyContactMobileNumber,EmergencyContactPhoneNumber,AdditionalEmailAddresses,DebtStatus";
    const txt = [
      head,
      "Coach,Byron,Smith,20 Oct 1982,,,,,,,,,Byron,Smith,byron@example.com,0400000009,,,,,,,,,",
      "Assistant Coach,Dee,Jones,23 Sep 1980,F,,,,,,,,Dee,Jones,dee@example.com,0400000008,0400000008,,,,,,,,",
      "Player,Leo,Kelly,2 May 2017,M,7 Oct 2026,,No,Under 9,Some School,Yes,Asthmatic,Sam,Kelly,sam@example.com,0400000001,0400000001,Y,Pat,Kelly,PAT@example.com,0400000002,,third@example.com,OUT",
      "Player,Matt,Pestano Perez,4 Nov 2017,M,7 Oct 2026,,No,Under 9,,No,,Aya,Perez,aya@example.com,0400000003,,Y,Ron,Palacios,,0400000004,,,OUT"
    ].join("\r\n") + "\r\n";
    const { isMajestri, players } = parsePlayerImport(txt);
    expect(isMajestri).toBe(true);
    // Coach and assistant coach rows are not players.
    expect(players.map((p) => [p.name, p.surname, p.dob])).toEqual([["Leo K.", "Kelly", "2017-05-02"], ["Matt P.", "Pestano Perez", "2017-11-04"]]);
    // Both contacts come across; every email on the row can sign in, lower-cased, once each.
    expect(players[0].guardians).toEqual([{ name: "Sam Kelly", email: "sam@example.com", mobile: "0400000001" }, { name: "Pat Kelly", email: "pat@example.com", mobile: "0400000002" }]);
    expect(players[0].parentEmails).toEqual(["sam@example.com", "pat@example.com", "third@example.com"]);
    expect(players[1].guardians).toEqual([{ name: "Aya Perez", email: "aya@example.com", mobile: "0400000003" }, { name: "Ron Palacios", email: "", mobile: "0400000004" }]);
    // Medical details never leave the file.
    expect(JSON.stringify(players)).not.toMatch(/Asthmatic|Some School/);
  });

  it("numbers players by their place among the players, not their row in the file", () => {
    // Two staff rows sit above the players in a real export.
    const txt = [
      "Role,FirstName,Surname",
      "Coach,Byron,Smith",
      "Assistant Coach,Dee,Jones",
      "Player,Leo,Kelly",
      "Player,Ana,van Dyk"
    ].join("\n");
    expect(parsePlayerImport(txt).players.map((p) => [p.name, p.number])).toEqual([["Leo K.", 1], ["Ana v.", 2]]);
  });

  it("a headerless copy is recognised whatever the staff roles are called", () => {
    const row = (role, first, last) => [role, first, last, "12/03/2018", "M", "reg", "ffa", "", "group", "school", "", "", "Ann", last, "ann@example.com", "400123456", "", "Y", "", "", "", ""].join("\t");
    const txt = [row("Coach", "Byron", "Smith"), row("Assistant Coach", "Dee", "Jones"), row("Team Manager", "Kit", "Lee"), row("Player", "Leo", "Kelly"), row("Player", "Ana", "van Dyk")].join("\n");
    const { isMajestri, players } = parsePlayerImport(txt);
    expect(isMajestri).toBe(true);
    expect(players.map((p) => [p.name, p.surname, p.number])).toEqual([["Leo K.", "Kelly", 1], ["Ana v.", "van Dyk", 2]]);
    // Wide rows with no Player among them are not a Majestri copy.
    expect(parsePlayerImport([row("Coach", "Byron", "Smith"), row("Manager", "Kit", "Lee")].join("\n")).isMajestri).toBe(false);
  });

  it("the file picker offers CSV under the names phones use for it", () => {
    for (const t of [".csv", "text/csv", "text/comma-separated-values", "text/plain"]) expect(PLAYER_FILE_ACCEPT.split(",")).toContain(t);
  });
});

describe("sanitizePlayers — last names", () => {
  it("keeps a trimmed, capped surname and drops a blank one", () => {
    const out = sanitizePlayers([
      { name: "Leo K.", surname: "  Kelly  " },
      { name: "Ana v.", surname: "x".repeat(90) },
      { name: "Billie", surname: "   " },
      { name: "Kit", surname: 42 }
    ]);
    expect(out[0].surname).toBe("Kelly");
    expect(out[1].surname).toHaveLength(60);
    expect(out[2]).not.toHaveProperty("surname");
    expect(out[3].surname).toBe("42");
  });
});

describe("mergeImportedPlayers", () => {
  const squad = () => [
    { id: "a", name: "Leo K.", number: 9, position: "FWD", dob: "2017-05-02", photo: "data:x", coach: { note: "quick" }, parentEmails: ["sam@example.com"], parentName: "Sam Kelly" },
    { id: "b", name: "Ana v.", number: 4, position: "DEF" },
    { id: "c", name: "Billie", number: 1, position: "GK" }
  ];

  it("pasting the same export again adds nobody: it fills in the missing last names", () => {
    const before = squad();
    const { players: parsed } = parsePlayerImport(NAMES_CSV);
    const res = mergeImportedPlayers(before, parsed);
    expect(res.added).toEqual([]);
    expect(res.updated).toEqual(["Leo K.", "Ana v."]);
    expect(res.unchanged).toBe(1); // Billie: nothing new to add
    expect(res.players).toHaveLength(3);
    expect(res.players.map((p) => [p.id, p.name, p.surname])).toEqual([["a", "Leo K.", "Kelly"], ["b", "Ana v.", "van Dyk"], ["c", "Billie", undefined]]);
    // Never touched: id, name, number, position, photo, coach notes.
    expect(res.players[0]).toMatchObject({ id: "a", number: 9, position: "FWD", photo: "data:x", coach: { note: "quick" } });
    // The input is not mutated.
    expect(before).toEqual(squad());
  });

  it("fills blanks only: an existing birthday, last name or family record is kept", () => {
    const { players: parsed } = parsePlayerImport(NAMES_CSV);
    const res = mergeImportedPlayers([
      { id: "a", name: "Leo K.", surname: "Kelly", parentName: "Someone Else", parentEmails: ["other@example.com"] },
      { id: "b", name: "Ana v." }
    ], parsed.slice(0, 2));
    const [leo, ana] = res.players;
    // Leo: surname and family already there; only the birthday was blank.
    expect(leo).toEqual({ id: "a", name: "Leo K.", surname: "Kelly", parentName: "Someone Else", parentEmails: ["other@example.com"], dob: "2017-05-02" });
    // Ana: no family details at all, so the export's come across whole.
    expect(ana).toMatchObject({ surname: "van Dyk", dob: "2017-09-11", parentName: "Rita van Dyk", parentContact: "0400000002", parentEmails: ["rita@example.com"] });
    expect(ana.guardians).toEqual([{ name: "Rita van Dyk", email: "rita@example.com", mobile: "0400000002" }]);
    expect(res.updated).toEqual(["Leo K.", "Ana v."]);
  });

  it("a player's own email (their login) survives an import, and an import never gives anyone one", () => {
    const { players: parsed } = parsePlayerImport(NAMES_CSV);
    const res = mergeImportedPlayers([
      { id: "a", name: "Leo K.", email: "leo@example.com" },
      { id: "b", name: "Ana v.", surname: "van Dyk", dob: "2017-09-11", parentEmails: ["rita@example.com"], email: "ana@example.com" }
    ], parsed);
    expect(res.players[0]).toMatchObject({ id: "a", surname: "Kelly", email: "leo@example.com" }); // updated, login kept
    expect(res.players[1]).toMatchObject({ id: "b", email: "ana@example.com" });                    // nothing to add, login kept
    expect("email" in res.players[2]).toBe(false);                                                    // Billie, added from the file
    // The export has no column for a player's own address, and the roster guard keeps none either.
    expect(parsed.every((p) => !("email" in p))).toBe(true);
    expect(sanitizePlayers([{ name: "Jo", email: "jo@example.com" }])[0]).not.toHaveProperty("email");
  });

  it("a second paste of an already-complete squad changes nothing", () => {
    const { players: parsed } = parsePlayerImport(NAMES_CSV);
    const once = mergeImportedPlayers([], parsed);
    expect(once.added).toEqual(["Leo K.", "Ana v.", "Billie"]);
    const twice = mergeImportedPlayers(once.players, parsePlayerImport(NAMES_CSV).players);
    expect(twice).toMatchObject({ added: [], updated: [], unchanged: 3 });
    expect(twice.players).toEqual(once.players);
  });

  it("new players are added after the squad, alongside the updates", () => {
    const res = mergeImportedPlayers(squad(), [{ id: "n1", name: "Leo K.", surname: "Kelly" }, { id: "n2", name: "Zed Q.", surname: "Quinn" }]);
    expect(res.added).toEqual(["Zed Q."]);
    expect(res.updated).toEqual(["Leo K."]);
    expect(res.players.map((p) => p.id)).toEqual(["a", "b", "c", "n2"]);
  });

  it("two different children who shorten to the same name are not merged", () => {
    // Different birthdays: a second Leo K. is a new player.
    const byDob = mergeImportedPlayers([{ id: "a", name: "Leo K.", dob: "2017-05-02" }], [{ id: "n", name: "Leo K.", surname: "Knight", dob: "2017-11-30" }]);
    expect(byDob.added).toEqual(["Leo K."]);
    expect(byDob.players).toHaveLength(2);
    expect(byDob.players[0]).not.toHaveProperty("surname");
    // Different last names (no birthdays to go on): also a new player.
    const bySurname = mergeImportedPlayers([{ id: "a", name: "Leo K.", surname: "Kelly" }], [{ id: "n", name: "Leo K.", surname: "Knight" }]);
    expect(bySurname.added).toEqual(["Leo K."]);
    expect(bySurname.players.map((p) => p.surname)).toEqual(["Kelly", "Knight"]);
  });

  it("two squad players with the same display name are matched by birthday, each once", () => {
    const res = mergeImportedPlayers(
      [{ id: "a", name: "Leo K.", dob: "2017-05-02" }, { id: "b", name: "Leo K.", dob: "2017-11-30" }],
      [{ id: "x", name: "Leo K.", surname: "Knight", dob: "2017-11-30" }, { id: "y", name: "Leo K.", surname: "Kelly", dob: "2017-05-02" }]
    );
    expect(res.players.map((p) => [p.id, p.surname])).toEqual([["a", "Kelly"], ["b", "Knight"]]);
    expect(res.added).toEqual([]);
    // The same child pasted twice in one list is only matched once.
    const twice = mergeImportedPlayers([{ id: "a", name: "Leo K." }], [{ id: "x", name: "Leo K.", surname: "Kelly" }, { id: "y", name: "Leo K.", surname: "Kelly" }]);
    expect(twice.players.map((p) => p.id)).toEqual(["a", "y"]);
  });

  it("matching ignores case, spacing and the trailing dot", () => {
    const res = mergeImportedPlayers([{ id: "a", name: "leo  K" }], [{ id: "n", name: "Leo K.", surname: "Kelly" }]);
    expect(res.players).toEqual([{ id: "a", name: "leo  K", surname: "Kelly" }]);
  });

  it("a simple list of full names fills in the squad's short names", () => {
    const res = mergeImportedPlayers(
      [{ id: "a", name: "Leo K." }, { id: "b", name: "Ana v." }, { id: "c", name: "Max Power" }],
      parsePlayerImport("Leo Kelly\nAna van Dyk\nMax Power\nNew Kid").players
    );
    expect(res.players.slice(0, 3)).toEqual([
      { id: "a", name: "Leo K.", surname: "Kelly" },
      { id: "b", name: "Ana v.", surname: "van Dyk" },
      { id: "c", name: "Max Power" } // typed in full already: left exactly as it is
    ]);
    expect(res.updated).toEqual(["Leo K.", "Ana v."]);
    expect(res.unchanged).toBe(1);
    expect(res.added).toEqual(["New Kid"]);
    // A short name that already has a different last name is someone else.
    const other = mergeImportedPlayers([{ id: "a", name: "Leo K.", surname: "Knight" }], parsePlayerImport("Leo Kelly").players);
    expect(other.added).toEqual(["Leo Kelly"]);
  });

  it("tolerates junk input", () => {
    expect(mergeImportedPlayers(null, null)).toEqual({ players: [], added: [], updated: [], unchanged: 0 });
    expect(mergeImportedPlayers([{ id: "a", name: "Leo K." }, null], [null, { name: "  " }, { id: "n", name: "Leo K.", surname: "Kelly" }]).players)
      .toEqual([{ id: "a", name: "Leo K.", surname: "Kelly" }, null]);
  });
});

// ---- Staff rows ------------------------------------------------------------
// The columns of a full team contact list, in the export's own order. Every
// person below is made up.
const FULL_HEAD = "Role,FirstName,Surname,DateOfBirth,Gender,RegistrationDate,PlayerFFANumber,PlayerATSIStatus,PlayerPlayingGroup,PlayerSchool,PlayerMedicalConditions,PlayerMedicalNotes,PrimaryContactFirstName,PrimaryContactSurname,PrimaryContactEmailAddress,PrimaryContactMobileNumber,PrimaryContactPhoneNumber,MediaRelease,EmergencyContactFirstName,EmergencyContactSurname,EmergencyContactEmailAddress,EmergencyContactMobileNumber,EmergencyContactPhoneNumber,AdditionalEmailAddresses,DebtStatus";
// One row of that list: the person, their primary and emergency contacts, and any extra addresses.
const fullRow = ({ role, first, last, dob = "", p = [], e = [], extra = "" }) => [
  role, first, last, dob, "", "", "", "", "", "", "", "",
  p[0] || "", p[1] || "", p[2] || "", p[3] || "", "", "",
  e[0] || "", e[1] || "", e[2] || "", e[3] || "", "", extra, ""
].join(",");
const TEAM_LIST = [
  FULL_HEAD,
  fullRow({ role: "Coach", first: "Pat", last: "Lane", dob: "02 Feb 1980", p: ["Pat", "Lane", "Pat@Example.com", "400000201"] }),
  fullRow({ role: "Assistant Coach", first: "Sam", last: "Kelly", dob: "03 Mar 1982", p: ["Sam", "Kelly", "sam@example.com", "0400 000 202"] }),
  fullRow({ role: "Player", first: "Leo", last: "Kelly", dob: "02 May 2017", p: ["Sam", "Kelly", "sam@example.com", "0400000202"], e: ["Rita", "Kelly", "rita@example.com", "0400000203"] }),
  fullRow({ role: "Player", first: "Tess", last: "Lane", dob: "11 Sep 2017", p: ["Pat", "Lane", "pat@example.com", "0400000201"] })
].join("\r\n");

describe("parsePlayerImport — staff rows", () => {
  it("returns the coach and manager rows as staff, with their own name, mobile and email and nothing else", () => {
    const { isMajestri, players, staff } = parsePlayerImport("﻿" + TEAM_LIST);
    expect(isMajestri).toBe(true);
    expect(staff).toEqual([
      { role: "Coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com" }
    ]);
    // The players are exactly as before: staff rows are not players and do not shift the numbers.
    expect(players.map((p) => [p.name, p.surname, p.number])).toEqual([["Leo K.", "Kelly", 1], ["Tess L.", "Lane", 2]]);
    expect(JSON.stringify(staff)).not.toMatch(/1980|1982|dob/); // no date of birth is kept for an adult
  });

  it("takes a staff member's email and mobile only when the primary contact is that person", () => {
    const list = [
      FULL_HEAD,
      // The contact is someone else: their address must not become this coach's login.
      fullRow({ role: "Coach", first: "Pat", last: "Lane", p: ["Robin", "Lane", "robin@example.com", "0400000301"] }),
      // No contact name at all: the row's own details.
      fullRow({ role: "Manager", first: "Dee", last: "Finch", p: ["", "", "dee@example.com", "0400000302"] }),
      // The same person, typed with other capitals and spacing.
      fullRow({ role: "Assistant Coach", first: "Sam", last: "Kelly", p: [" SAM ", "kelly", "Sam@Example.com", "0400000303"] }),
      // The same first name is not the same person.
      fullRow({ role: "Trainer", first: "Jo", last: "Marsh", p: ["Jo", "Marsh-Reid", "jo@example.com", "0400000304"] }),
      fullRow({ role: "Player", first: "Leo", last: "Kelly", p: ["Sam", "Kelly", "sam@example.com", "0400000303"] })
    ].join("\n");
    expect(parsePlayerImport(list).staff).toEqual([
      { role: "Coach", name: "Pat Lane", mobile: "", email: "" },
      { role: "Manager", name: "Dee Finch", mobile: "0400000302", email: "dee@example.com" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000303", email: "sam@example.com" },
      { role: "Trainer", name: "Jo Marsh", mobile: "", email: "" }
    ]);
  });

  it("never uses another address on a staff row: not the emergency contact's, not the additional ones", () => {
    const list = [
      FULL_HEAD,
      fullRow({ role: "Coach", first: "Pat", last: "Lane", p: ["Pat", "Lane", "not-an-address", "0400000201"], e: ["Robin", "Lane", "robin@example.com", "0400000301"], extra: "other@example.com" }),
      fullRow({ role: "Player", first: "Tess", last: "Lane", p: ["Pat", "Lane", "pat@example.com", "0400000201"], extra: "gran@example.com" })
    ].join("\n");
    const { staff, players } = parsePlayerImport(list);
    expect(staff).toEqual([{ role: "Coach", name: "Pat Lane", mobile: "0400000201", email: "" }]);
    // A player's row still gathers every address on it, as it always has.
    expect(players[0].parentEmails).toEqual(["pat@example.com", "gran@example.com"]);
  });

  it("keeps the file's wording for a title, in sentence case, and skips a row with no first name or no role", () => {
    const list = [
      FULL_HEAD,
      fullRow({ role: "TEAM  MANAGER", first: "Dee", last: "Finch" }),
      fullRow({ role: "first aid officer", first: "Ari", last: "" }),
      fullRow({ role: "Coach", first: "", last: "Nobody" }),
      fullRow({ role: "", first: "Blank", last: "Role" }), // no role: a player, as before
      fullRow({ role: "Player", first: "Leo", last: "Kelly" })
    ].join("\n");
    const { staff, players } = parsePlayerImport(list);
    expect(staff).toEqual([
      { role: "Team manager", name: "Dee Finch", mobile: "", email: "" },
      { role: "First aid officer", name: "Ari", mobile: "", email: "" }
    ]);
    expect(players.map((p) => p.name)).toEqual(["Blank R.", "Leo K."]);
  });

  it("reads staff from a headerless Excel copy too, and a simple list has none", () => {
    const tab = (cells) => cells.join("\t");
    const row = (role, first, last, contact) => { const v = Array(22).fill(""); v[0] = role; v[1] = first; v[2] = last; [v[12], v[13], v[14], v[15]] = contact; return tab(v); };
    const copy = [
      row("Coach", "Pat", "Lane", ["Pat", "Lane", "pat@example.com", "400000201"]),
      row("Player", "Tess", "Lane", ["Pat", "Lane", "pat@example.com", "400000201"])
    ].join("\n");
    const parsed = parsePlayerImport(copy);
    expect(parsed.isMajestri).toBe(true);
    expect(parsed.staff).toEqual([{ role: "Coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com" }]);
    expect(parsed.players).toHaveLength(1);
    expect(parsePlayerImport("Leo, 9, FWD, Sam, 0400 000 202").staff).toEqual([]);
    expect(parsePlayerImport("").staff).toEqual([]);
  });
});

describe("mergeImportedStaff", () => {
  const parsed = () => parsePlayerImport(TEAM_LIST).staff;

  it("adds the file's staff to a team with none: the Coach is its head coach, and both are named as gaining a login", () => {
    const res = mergeImportedStaff([], parsed());
    expect(res.staff).toEqual([
      { role: "Head coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com", photo: "" },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com", photo: "" }
    ]);
    expect(res).toMatchObject({ added: ["Pat Lane", "Sam Kelly"], updated: [], unchanged: 0, logins: ["Pat Lane", "Sam Kelly"] });
    expect(res.people).toEqual([
      { name: "Pat Lane", role: "Head coach", email: "pat@example.com", mobile: "0400000201", change: "add", login: true },
      { name: "Sam Kelly", role: "Assistant coach", email: "sam@example.com", mobile: "0400000202", change: "add", login: true }
    ]);
  });

  it("importing the same file again changes nothing", () => {
    const once = mergeImportedStaff([], parsed());
    const twice = mergeImportedStaff(once.staff, parsed());
    expect(twice).toMatchObject({ added: [], updated: [], unchanged: 2, logins: [] });
    expect(twice.staff).toEqual(once.staff);
    expect(twice.people.map((p) => [p.name, p.change, p.login])).toEqual([["Pat Lane", "none", false], ["Sam Kelly", "none", false]]);
  });

  it("someone already on the staff is filled in where blank and never overwritten", () => {
    const before = [
      { role: "Head coach", name: "pat  lane", mobile: "", email: "", photo: "data:pat" },
      { role: "Kit and oranges", name: "Sam Kelly", mobile: "0499 999 999", email: "work@example.com", photo: "" }
    ];
    const snapshot = JSON.parse(JSON.stringify(before));
    const res = mergeImportedStaff(before, parsed());
    expect(res.staff).toEqual([
      { role: "Head coach", name: "pat  lane", mobile: "0400000201", email: "pat@example.com", photo: "data:pat" }, // their own spelling and photo kept
      { role: "Kit and oranges", name: "Sam Kelly", mobile: "0499 999 999", email: "work@example.com", photo: "" }   // nothing was blank
    ]);
    expect(res).toMatchObject({ added: [], updated: ["Pat Lane"], unchanged: 1, logins: ["Pat Lane"] });
    expect(res.people.map((p) => [p.name, p.role, p.email, p.change, p.login])).toEqual([
      ["Pat Lane", "Head coach", "pat@example.com", "update", true],
      ["Sam Kelly", "Kit and oranges", "work@example.com", "none", false]
    ]);
    expect(res.people.some((p) => "listedAs" in p)).toBe(false); // the same name, whatever its capitals: nothing to point out
    expect(before).toEqual(snapshot); // the list passed in is not changed
  });

  it("the same email is the same person, whatever name the list has them under", () => {
    const res = mergeImportedStaff([{ role: "Manager", name: "Samuel K", mobile: "", email: "SAM@example.com", photo: "" }], parsed().slice(1));
    expect(res.staff).toEqual([{ role: "Manager", name: "Samuel K", mobile: "0400000202", email: "SAM@example.com", photo: "" }]);
    expect(res).toMatchObject({ added: [], updated: ["Sam Kelly"], logins: [] }); // they could already sign in
  });

  it("a row typed with a first name only, or a first name and an initial, is the same person; their name is left as written", () => {
    const res = mergeImportedStaff([
      { role: "Head coach", name: "Pat", mobile: "", email: "", photo: "" },
      { role: "Assistant coach", name: "sam k.", mobile: "0400000202", email: "", photo: "" }
    ], parsed());
    expect(res.staff).toEqual([
      { role: "Head coach", name: "Pat", mobile: "0400000201", email: "pat@example.com", photo: "" },
      { role: "Assistant coach", name: "sam k.", mobile: "0400000202", email: "sam@example.com", photo: "" }
    ]);
    expect(res).toMatchObject({ added: [], updated: ["Pat Lane", "Sam Kelly"], logins: ["Pat Lane", "Sam Kelly"] });
    // The read-back can say which row each was matched to.
    expect(res.people.map((p) => [p.name, p.listedAs])).toEqual([["Pat Lane", "Pat"], ["Sam Kelly", "sam k."]]);
    // Nothing in the file to add to it: the row is found and left alone.
    expect(mergeImportedStaff([{ role: "Head coach", name: "Byron" }], [{ role: "Coach", name: "Byron Smith", mobile: "", email: "" }]))
      .toMatchObject({ staff: [{ role: "Head coach", name: "Byron" }], added: [], updated: [], unchanged: 1 });
  });

  it("a short name that could be two people, or is someone else's, is not assumed to be them", () => {
    // Two rows named Sam: the file's Sam Kelly is added rather than guessed at.
    const two = mergeImportedStaff([{ role: "Head coach", name: "Sam" }, { role: "Manager", name: "Sam" }], parsed().slice(1));
    expect(two.staff.map((s) => [s.role, s.name])).toEqual([["Head coach", "Sam"], ["Manager", "Sam"], ["Assistant coach", "Sam Kelly"]]);
    // Another initial, another surname, or a first name that only starts the same way.
    for (const listed of ["Sam R.", "Sam Rowe", "Samantha", "Sa"]) {
      const res = mergeImportedStaff([{ role: "Manager", name: listed, email: "" }], parsed().slice(1));
      expect(res.added, listed).toEqual(["Sam Kelly"]);
      expect(res.staff[0], listed).toEqual({ role: "Manager", name: listed, email: "" });
    }
    // A full-name match is taken before a short one, so each row is used once.
    const both = mergeImportedStaff([{ role: "Manager", name: "Sam" }, { role: "Assistant coach", name: "Sam Kelly", email: "" }], parsed().slice(1));
    expect(both.staff.map((s) => [s.name, s.email || ""])).toEqual([["Sam", ""], ["Sam Kelly", "sam@example.com"]]);
  });

  it("a team that already has a head coach keeps them: the file's Coach is added as Coach", () => {
    const res = mergeImportedStaff([{ role: "Head coach", name: "Byron Hale", mobile: "", email: "", photo: "" }], parsed());
    expect(res.staff.map((s) => [s.role, s.name])).toEqual([["Head coach", "Byron Hale"], ["Coach", "Pat Lane"], ["Assistant coach", "Sam Kelly"]]);
    // Two coaches in one file: the first is the head coach.
    const two = mergeImportedStaff([], [{ role: "Coach", name: "Pat Lane" }, { role: "Coach", name: "Dee Finch" }]);
    expect(two.staff.map((s) => [s.role, s.name])).toEqual([["Head coach", "Pat Lane"], ["Coach", "Dee Finch"]]);
  });

  it("someone with no email in the file is added without a login", () => {
    const res = mergeImportedStaff([], [{ role: "Manager", name: "Dee Finch", mobile: "400000302", email: "" }, { role: "Trainer", name: "Jo Marsh", email: "not an address" }]);
    expect(res.staff).toEqual([
      { role: "Manager", name: "Dee Finch", mobile: "0400000302", email: "", photo: "" },
      { role: "Trainer", name: "Jo Marsh", mobile: "", email: "", photo: "" }
    ]);
    expect(res.logins).toEqual([]);
    expect(res.people.every((p) => p.login === false && p.change === "add")).toBe(true);
  });

  it("fills the team wizard's unnamed rows by title, keeps what else is on them, and adds the rest after", () => {
    const rows = [
      { role: "Head coach", name: "", mobile: "", email: "", custom: false },
      { role: "Assistant coach", name: "", mobile: "", email: "", custom: false },
      { role: "Manager", name: "", mobile: "", email: "", custom: false }
    ];
    const res = mergeImportedStaff(rows, [...parsed(), { role: "Trainer", name: "Jo Marsh", mobile: "", email: "" }]);
    expect(res.staff).toEqual([
      { role: "Head coach", name: "Pat Lane", mobile: "0400000201", email: "pat@example.com", photo: "", custom: false },
      { role: "Assistant coach", name: "Sam Kelly", mobile: "0400000202", email: "sam@example.com", photo: "", custom: false },
      { role: "Manager", name: "", mobile: "", email: "", custom: false },
      { role: "Trainer", name: "Jo Marsh", mobile: "", email: "", photo: "" }
    ]);
    expect(res.added).toEqual(["Pat Lane", "Sam Kelly", "Jo Marsh"]);
    expect(rows[0].name).toBe(""); // the rows passed in are not changed
  });

  it("tolerates junk input", () => {
    expect(mergeImportedStaff(null, null)).toEqual({ staff: [], added: [], updated: [], unchanged: 0, logins: [], people: [] });
    expect(mergeImportedStaff([null, "x", { role: "Manager", name: "Dee" }], [null, {}, { name: "  " }]).staff).toEqual([{ role: "Manager", name: "Dee" }]);
  });
});

