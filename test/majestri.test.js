import { describe, it, expect } from "vitest";
import { parseDob, fixMobile, splitCSV, parsePlayerImport, sanitizePlayers } from "@/lib/majestri";

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
