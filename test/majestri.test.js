import { describe, it, expect } from "vitest";
import { parseDob, fixMobile, splitCSV, parsePlayerImport, sanitizePlayers, mergeImportedPlayers, PLAYER_FILE_ACCEPT } from "@/lib/majestri";

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
