import { describe, it, expect, vi } from "vitest";
import {
  driblFixturesUrl, sanitizeDriblSource, driblReady, sanitizeDrawRecords,
  normalizeDribl, nextDriblPage, fetchDribl,
  DRIBL_API_HOST, NOT_A_DRIBL_REQUEST, MAX_RECORDS, WHICH_TEAM, NOT_READABLE, UNREACHABLE
} from "@/lib/dribl";

// lib/dribl: a competition whose draw is on Dribl's match centre. The request
// the browser makes for it is stored on the competition; a coach's browser
// fetches it and posts plain records, which the server checks one by one.

const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=RwNlzVMdjr&competition=1pN6pO9pd0&league=RNEQXMoZNv&club=PydoO0nJdD&tenant=1pN6RMBN0g&timezone=Australia%2FBrisbane";

describe("driblFixturesUrl", () => {
  it("keeps a fixtures request as the Network tab shows it", () => {
    expect(driblFixturesUrl(REQUEST)).toBe(REQUEST);
    expect(driblFixturesUrl("  " + REQUEST + "\n")).toBe(REQUEST);
    expect(DRIBL_API_HOST).toBe("mc-api.dribl.com");
  });

  it("stores the same request the same way, whatever order its filters were pasted in", () => {
    const shuffled = "https://mc-api.dribl.com/api/fixtures?tenant=1pN6RMBN0g&club=PydoO0nJdD&timezone=Australia%2FBrisbane&league=RNEQXMoZNv&season=RwNlzVMdjr&competition=1pN6pO9pd0&date_range=all";
    expect(driblFixturesUrl(shuffled)).toBe(REQUEST);
  });

  it("always asks for every date, and for Brisbane time when none was given", () => {
    const upcomingOnly = REQUEST.replace("date_range=all", "date_range=default");
    expect(driblFixturesUrl(upcomingOnly)).toBe(REQUEST);
    const bare = "https://mc-api.dribl.com/api/fixtures?club=PydoO0nJdD&tenant=1pN6RMBN0g";
    expect(driblFixturesUrl(bare)).toBe("https://mc-api.dribl.com/api/fixtures?date_range=all&club=PydoO0nJdD&tenant=1pN6RMBN0g&timezone=Australia%2FBrisbane");
    // Another timezone that was given is kept.
    expect(driblFixturesUrl(bare + "&timezone=Australia%2FSydney")).toContain("timezone=Australia%2FSydney");
  });

  it("drops anything that is not one of the known filters (a page cursor, tracking)", () => {
    expect(driblFixturesUrl(REQUEST + "&cursor=eyJpZCI6MX0&utm_source=x&page=4")).toBe(REQUEST);
    expect(driblFixturesUrl(REQUEST + "#fragment")).toBe(REQUEST);
  });

  it("is only ever a plain https request to Dribl's fixtures API", () => {
    const q = "?tenant=1pN6RMBN0g&club=PydoO0nJdD";
    for (const bad of [
      "http://mc-api.dribl.com/api/fixtures" + q,                    // not https
      "https://mc-api.dribl.com:8443/api/fixtures" + q,              // a port
      "https://user:pass@mc-api.dribl.com/api/fixtures" + q,         // credentials
      "https://user@mc-api.dribl.com/api/fixtures" + q,
      "https://mc-api.dribl.com.evil.example/api/fixtures" + q,      // another host
      "https://evil.example/mc-api.dribl.com/api/fixtures" + q,
      "https://evilmc-api.dribl.com/api/fixtures" + q,               // a host that only ends like Dribl's
      "https://x.mc-api.dribl.com/api/fixtures" + q,
      "https://api.dribl.com/api/fixtures" + q,
      "https://premierinvitational.dribl.com/fixtures" + q,          // the page, not the request
      "https://mc-api.dribl.com/api/fixtures-clubs" + q,             // another of its lists
      "https://mc-api.dribl.com/api/fixtures/../tenants" + q,
      "https://mc-api.dribl.com/api/results" + q,
      "javascript:alert(1)", "//mc-api.dribl.com/api/fixtures" + q, "mc-api.dribl.com/api/fixtures" + q, "not a link", ""
    ]) expect(driblFixturesUrl(bad), bad).toBe("");
  });

  it("needs its tenant, and refuses a filter value that is not a plain id", () => {
    expect(driblFixturesUrl("https://mc-api.dribl.com/api/fixtures?club=PydoO0nJdD&season=RwNlzVMdjr")).toBe("");
    expect(driblFixturesUrl("https://mc-api.dribl.com/api/fixtures?tenant=&club=PydoO0nJdD")).toBe("");
    for (const value of ["<script>", "a&b", "x".repeat(65), "1pN6%00", "a;b", "a'b", 'a"b']) {
      expect(driblFixturesUrl(`https://mc-api.dribl.com/api/fixtures?tenant=1pN6RMBN0g&club=${encodeURIComponent(value)}`), value).toBe("");
    }
  });

  it("is never made from anything but text, and has a length limit", () => {
    for (const bad of [null, undefined, 7, {}, [REQUEST], true]) expect(driblFixturesUrl(bad)).toBe("");
    expect(driblFixturesUrl(REQUEST + "&utm=" + "x".repeat(600))).toBe("");
  });
});

describe("sanitizeDriblSource", () => {
  it("nothing entered is no source at all", () => {
    for (const none of [null, undefined, {}, { url: "" }, { url: "   " }, { team: "Olympic FC U9" }, "junk", [], 7]) expect(sanitizeDriblSource(none)).toBeNull();
  });

  it("a fixtures request is stored tidied, with the team's name only when one was given", () => {
    expect(sanitizeDriblSource({ url: REQUEST })).toEqual({ url: REQUEST });
    expect(sanitizeDriblSource({ url: REQUEST + "&cursor=abc", team: "  Olympic  FC   U9 White " })).toEqual({ url: REQUEST, team: "Olympic FC U9 White" });
    expect(sanitizeDriblSource({ url: REQUEST, team: "   " })).toEqual({ url: REQUEST });
    expect(sanitizeDriblSource({ url: REQUEST, team: 7 })).toEqual({ url: REQUEST });
    expect(sanitizeDriblSource({ url: REQUEST, team: "x".repeat(200) }).team).toHaveLength(80);
    // Nothing else rides along.
    expect(sanitizeDriblSource({ url: REQUEST, secret: "x", squadi: { teamId: 1 } })).toEqual({ url: REQUEST });
  });

  it("a link that is not a Dribl fixtures request is an error the admin can read, never stored", () => {
    for (const url of ["https://premierinvitational.dribl.com/fixtures?season=x", "https://evil.example/api/fixtures?tenant=a", "not a link", 7 && "7"]) {
      expect(sanitizeDriblSource({ url })).toEqual({ error: NOT_A_DRIBL_REQUEST });
    }
    expect(NOT_A_DRIBL_REQUEST).toBe("That is not a Dribl fixtures request. It should start with https://mc-api.dribl.com/api/fixtures?");
  });

  it("driblReady: only a source whose stored request is still a real one", () => {
    expect(driblReady({ url: REQUEST })).toBe(true);
    expect(driblReady({ url: REQUEST, team: "Olympic" })).toBe(true);
    for (const no of [null, undefined, {}, { url: "" }, { url: "https://evil.example/x" }, "x", [REQUEST]]) expect(driblReady(no)).toBe(false);
  });
});

// What a browser posts after reading a draw. It is a coach's browser, not
// Dribl, so every record is checked before it can become a game.
describe("sanitizeDrawRecords", () => {
  const game = (over = {}) => ({
    squadiId: "dribl:KmqxVbvdRy", round: 3, dateISO: "2027-03-14", time: "09:30", opponent: "Lions FC", homeAway: "A",
    venue: "Lions Park – Field 2", opponentLogo: "https://cdn.example/lions.png", ourLogo: "https://cdn.example/us.png", ...over
  });

  it("keeps a well-formed game exactly, with only the known fields", () => {
    expect(sanitizeDrawRecords([game()])).toEqual([game()]);
    expect(sanitizeDrawRecords([{ ...game(), availability: { p1: { status: "in" } }, us: 9, them: 0, id: "f1", comp: "cother", notes: "x" }])).toEqual([game()]);
  });

  it("is not a list of records at all unless it is a list", () => {
    for (const bad of [null, undefined, {}, "x", 7, { 0: game(), length: 1 }]) expect(sanitizeDrawRecords(bad)).toBeNull();
    expect(sanitizeDrawRecords([])).toEqual([]);
  });

  it("drops a record without a Dribl id of its own, and keeps each id once", () => {
    for (const squadiId of [undefined, "", 12345, "KmqxVbvdRy", "squadi:1", "dribl:", "dribl:has space", "dribl:" + "x".repeat(49), "dribl:<b>"]) {
      expect(sanitizeDrawRecords([game({ squadiId })]), String(squadiId)).toEqual([]);
    }
    const twice = sanitizeDrawRecords([game(), game({ opponent: "Someone else" })]);
    expect(twice).toHaveLength(1);
    expect(twice[0].opponent).toBe("Lions FC");
  });

  it("drops a game without a real date or an opponent", () => {
    for (const dateISO of [undefined, "", "14/03/2027", "2027-3-14", "2027-02-30", "2027-13-01", "2027-03-14T09:30", 20270314]) {
      expect(sanitizeDrawRecords([game({ dateISO })]), String(dateISO)).toEqual([]);
    }
    for (const opponent of [undefined, "", "   ", 7, { name: "Lions" }]) expect(sanitizeDrawRecords([game({ opponent })])).toEqual([]);
  });

  it("a kick-off that is not a time is to be confirmed, not an error", () => {
    for (const time of [undefined, "", "TBC", "9:30", "24:00", "09:60", 930]) expect(sanitizeDrawRecords([game({ time })])[0].time).toBe("");
    expect(sanitizeDrawRecords([game({ time: "00:00" })])[0].time).toBe("00:00");
    expect(sanitizeDrawRecords([game({ time: "23:59" })])[0].time).toBe("23:59");
  });

  it("a round is a small whole number or nothing; home unless it says away", () => {
    for (const round of [undefined, null, 0, -1, 2.5, "3", 100, NaN]) expect(sanitizeDrawRecords([game({ round })])[0].round).toBeNull();
    expect(sanitizeDrawRecords([game({ round: 99 })])[0].round).toBe(99);
    for (const homeAway of ["H", undefined, "home", "a", 1]) expect(sanitizeDrawRecords([game({ homeAway })])[0].homeAway).toBe("H");
    expect(sanitizeDrawRecords([game({ homeAway: "A" })])[0].homeAway).toBe("A");
  });

  it("cuts names to size and tidies their spacing", () => {
    const [r] = sanitizeDrawRecords([game({ opponent: "  Lions \n FC  " + "x".repeat(200), venue: " Lions   Park " + "y".repeat(200) })]);
    expect(r.opponent.startsWith("Lions FC x")).toBe(true);
    expect(r.opponent).toHaveLength(80);
    expect(r.venue.startsWith("Lions Park y")).toBe(true);
    expect(r.venue).toHaveLength(120);
    expect(sanitizeDrawRecords([game({ venue: undefined })])[0].venue).toBe("");
  });

  it("a crest is only ever a plain https address", () => {
    for (const logo of ["http://cdn.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "//cdn.example/a.png", "cdn.example/a.png", "https://user:pw@cdn.example/a.png", "https://cdn.example/" + "a".repeat(400), 7, null, undefined]) {
      const [r] = sanitizeDrawRecords([game({ opponentLogo: logo, ourLogo: logo })]);
      expect([r.opponentLogo, r.ourLogo], String(logo)).toEqual(["", ""]);
    }
  });

  it("a bye is kept as a bye, with nothing else on it", () => {
    expect(sanitizeDrawRecords([{ squadiId: "dribl:bye1", round: 4, bye: true, opponent: "Bye", dateISO: "2027-03-21" }])).toEqual([{ squadiId: "dribl:bye1", round: 4, bye: true }]);
    // Only the value true makes a bye.
    expect(sanitizeDrawRecords([game({ bye: "true" })])).toEqual([game()]);
  });

  it("skips anything that is not a record, and stops at the cap", () => {
    expect(sanitizeDrawRecords([null, "x", 7, [game()], game()])).toEqual([game()]);
    const many = Array.from({ length: MAX_RECORDS + 25 }, (_, i) => game({ squadiId: "dribl:g" + i }));
    expect(sanitizeDrawRecords(many)).toHaveLength(MAX_RECORDS);
    expect(MAX_RECORDS).toBe(300);
  });

  it("never changes what it was given", () => {
    const sent = [game({ opponent: "  Lions  FC " })];
    const before = JSON.stringify(sent);
    sanitizeDrawRecords(sent);
    expect(JSON.stringify(sent)).toBe(before);
  });
});


// ---- Reading Dribl's answer -------------------------------------------------
// Dribl publishes no description of its fixtures answer. This is the layout
// the reader was written for; an answer it cannot read is an error that names
// the fields it found, never a quiet "no games".
const item = (id, over = {}) => ({
  type: "fixtures", hash_id: id,
  attributes: {
    date: "2027-03-13T23:30:00.000000Z", // Sunday 14 March, 09:30 in Brisbane
    round: "R1", full_round: "Round 1",
    home_team_name: "Olympic FC U9 White", away_team_name: "Lions FC U9",
    home_logo: "https://cdn.example/olympic.png", away_logo: "https://cdn.example/lions.png",
    ground_name: "Goodwin Park", field_name: "Field 2", bye_flag: false, status: "pending",
    ...over
  }
});
const BRISBANE = { timeZone: "Australia/Brisbane" };
// A draw of one game does not show which of its two teams is ours, so the
// one-game examples below name it, as the competition's set-up would.
const US = "Olympic FC U9 White";
const OURS = { ...BRISBANE, team: US };

describe("normalizeDribl", () => {
  it("turns a home game into the record a sync applies", () => {
    expect(normalizeDribl([item("KmqxVbvdRy")], OURS)).toEqual([{
      squadiId: "dribl:KmqxVbvdRy", round: 1, dateISO: "2027-03-14", time: "09:30",
      opponent: "Lions FC U9", opponentLogo: "https://cdn.example/lions.png", ourLogo: "https://cdn.example/olympic.png",
      homeAway: "H", venue: "Goodwin Park – Field 2"
    }]);
  });

  it("an away game swaps the sides: their name and crest are the opponent's", () => {
    const games = [item("a1"), item("a2", { home_team_name: "Tigers U9", away_team_name: "Olympic FC U9 White", home_logo: "https://cdn.example/tigers.png", away_logo: "https://cdn.example/olympic.png", round: "R2", full_round: "Round 2" })];
    const [, away] = normalizeDribl(games, BRISBANE);
    expect(away).toMatchObject({ squadiId: "dribl:a2", round: 2, homeAway: "A", opponent: "Tigers U9", opponentLogo: "https://cdn.example/tigers.png", ourLogo: "https://cdn.example/olympic.png" });
  });

  it("reads the kick-off in the draw's own timezone, whatever the day is in UTC", () => {
    const at = (date, timeZone) => { const [r] = normalizeDribl([item("x", { date })], { timeZone, team: US }); return `${r.dateISO} ${r.time}`; };
    expect(at("2027-03-13T23:30:00.000000Z", "Australia/Brisbane")).toBe("2027-03-14 09:30");
    expect(at("2027-03-13T23:30:00.000000Z", "Australia/Sydney")).toBe("2027-03-14 10:30"); // daylight saving
    expect(at("2027-06-19T22:00:00Z", "Australia/Brisbane")).toBe("2027-06-20 08:00");
    expect(at("2027-06-20T14:00:00.000Z", "Australia/Brisbane")).toBe("2027-06-21 00:00");   // midnight is 00:00, not 24:00
  });

  it("a time with no zone on it is the draw's own clock, taken as it stands", () => {
    const at = (date, timeZone = "Australia/Brisbane") => { const [r] = normalizeDribl([item("x", { date })], { timeZone, team: US }); return `${r.dateISO} ${r.time}`; };
    expect(at("2027-03-14 09:30:00")).toBe("2027-03-14 09:30");
    expect(at("2027-03-14T09:30:00")).toBe("2027-03-14 09:30");
    expect(at("2027-03-14T09:30:00.000000")).toBe("2027-03-14 09:30");
    expect(at("2027-03-14 00:05")).toBe("2027-03-14 00:05");
    // Whatever timezone the draw is in, and wherever the browser is: nothing is shifted.
    expect(at("2027-03-14 09:30:00", "Australia/Perth")).toBe("2027-03-14 09:30");
    // A date alone is a game with its time still to come.
    expect(at("2027-03-14")).toBe("2027-03-14 ");
    expect(normalizeDribl([item("x", { date: "2027-03-14" })], OURS)[0].time).toBe("");
    // An offset is an instant like any other.
    expect(at("2027-03-14T09:30:00+10:00")).toBe("2027-03-14 09:30");
    expect(at("2027-03-14T09:30:00+11:00")).toBe("2027-03-14 08:30");
    // A date that is no date, or a time that is no time, is not read.
    for (const date of ["2027-02-30 09:30:00", "2027-13-01", "2027-03-14 25:00:00", "2027-03-14 09:61", "", null, 20270314]) {
      expect(() => normalizeDribl([item("x", { date })], OURS), String(date)).toThrow(NOT_READABLE);
    }
  });

  it("a round is its number wherever Dribl puts it; a final has none", () => {
    const round = (over) => normalizeDribl([item("x", over)], OURS)[0].round;
    expect(round({ round: "R7", full_round: "Round 7" })).toBe(7);
    expect(round({ round: "12", full_round: "" })).toBe(12);
    expect(round({ round: 3, full_round: undefined })).toBe(3);
    expect(round({ round: "SF", full_round: "Semi Final" })).toBeNull();
    expect(round({ round: "", full_round: "" })).toBeNull();
    expect(round({ round: "R0", full_round: "Round 0" })).toBeNull();
  });

  it("the ground and the field make the venue; either alone will do", () => {
    const venue = (over) => normalizeDribl([item("x", over)], OURS)[0].venue;
    expect(venue({})).toBe("Goodwin Park – Field 2");
    expect(venue({ field_name: "" })).toBe("Goodwin Park");
    expect(venue({ ground_name: null })).toBe("Field 2");
    expect(venue({ ground_name: "", field_name: "" })).toBe("");
  });

  it("works out which team is ours: the one name that is in every game", () => {
    const games = [item("a"), item("b", { home_team_name: "Tigers U9", away_team_name: "Olympic FC U9 White" }), item("c", { away_team_name: "Wests U9" })];
    expect(normalizeDribl(games, BRISBANE).map((r) => [r.homeAway, r.opponent])).toEqual([["H", "Lions FC U9"], ["A", "Tigers U9"], ["H", "Wests U9"]]);
  });

  it("with two of the club's teams in the draw, asks for the team's name, and uses it once given", () => {
    const games = [item("a"), item("b", { home_team_name: "Olympic FC U9 Red", away_team_name: "Tigers U9" }), item("c", { home_team_name: "Wests U9", away_team_name: "Olympic FC U9 White" })];
    expect(() => normalizeDribl(games, BRISBANE)).toThrow(WHICH_TEAM);
    expect(WHICH_TEAM).toBe("This Dribl draw does not show which team is yours. Add your team's name as Dribl shows it to the competition's set-up.");
    // The other team's game is not ours.
    expect(normalizeDribl(games, { ...BRISBANE, team: "Olympic FC U9 White" }).map((r) => r.squadiId)).toEqual(["dribl:a", "dribl:c"]);
    // Capitals and spacing are not what makes a name.
    expect(normalizeDribl(games, { ...BRISBANE, team: "  olympic fc   u9 red " }).map((r) => r.squadiId)).toEqual(["dribl:b"]);
    // Part of the name is enough when it can only mean one team...
    expect(normalizeDribl(games, { ...BRISBANE, team: "U9 Red" }).map((r) => r.squadiId)).toEqual(["dribl:b"]);
    // ...and not when it could mean two, or none.
    expect(() => normalizeDribl(games, { ...BRISBANE, team: "Olympic" })).toThrow('More than one team in this Dribl draw has "Olympic" in its name. Use the whole name as Dribl shows it.');
    expect(() => normalizeDribl(games, { ...BRISBANE, team: "Rovers" })).toThrow('No team called "Rovers" is in this Dribl draw.');
  });

  it("the whole name wins over a longer name that contains it", () => {
    const games = [item("a", { home_team_name: "Olympic FC U9" }), item("b", { home_team_name: "Olympic FC U9 White", away_team_name: "Tigers U9" })];
    expect(normalizeDribl(games, { ...BRISBANE, team: "Olympic FC U9" }).map((r) => r.squadiId)).toEqual(["dribl:a"]);
    expect(normalizeDribl(games, { ...BRISBANE, team: "olympic fc u9 white" }).map((r) => r.squadiId)).toEqual(["dribl:b"]);
  });

  it("a draw of one game, or of the same two teams each time, does not show which is ours: asks, never guesses", () => {
    expect(() => normalizeDribl([item("a")], BRISBANE)).toThrow(WHICH_TEAM);
    const twice = [item("a"), item("b", { home_team_name: "Lions FC U9", away_team_name: "Olympic FC U9 White", round: "R2", full_round: "Round 2" })];
    expect(() => normalizeDribl(twice, BRISBANE)).toThrow(WHICH_TEAM);
    // Named, each is read from its own side.
    expect(normalizeDribl(twice, OURS).map((r) => [r.homeAway, r.opponent])).toEqual([["H", "Lions FC U9"], ["A", "Lions FC U9"]]);
    expect(normalizeDribl(twice, { ...BRISBANE, team: "Lions FC U9" }).map((r) => [r.homeAway, r.opponent])).toEqual([["A", "Olympic FC U9 White"], ["H", "Olympic FC U9 White"]]);
  });

  it("reads a name as one line of text however Dribl spaced it", () => {
    const games = [item("a", { home_team_name: "  Olympic FC  U9 White ", away_team_name: "Lions  FC U9" }), item("b", { away_team_name: "Tigers U9" })];
    expect(normalizeDribl(games, BRISBANE).map((r) => r.opponent)).toEqual(["Lions FC U9", "Tigers U9"]);
  });

  it("a bye is ours only when we are the side in it", () => {
    const games = [item("a"), item("bye1", { away_team_name: "", bye_flag: true, round: "R2", full_round: "Round 2" }), item("bye2", { home_team_name: "Tigers U9", away_team_name: "", bye_flag: true })];
    expect(normalizeDribl(games, OURS)).toEqual([
      expect.objectContaining({ squadiId: "dribl:a" }),
      { squadiId: "dribl:bye1", round: 2, bye: true }
    ]);
  });

  it("a draw that is nothing but byes is read as byes: there is no game to tell the teams apart by", () => {
    const byes = [item("bye1", { away_team_name: "", bye_flag: true }), item("bye2", { away_team_name: "", bye_flag: true, round: "R2", full_round: "Round 2" })];
    expect(normalizeDribl(byes, BRISBANE)).toEqual([{ squadiId: "dribl:bye1", round: 1, bye: true }, { squadiId: "dribl:bye2", round: 2, bye: true }]);
  });

  it("an empty draw is no games, and that is not an error", () => {
    expect(normalizeDribl([], BRISBANE)).toEqual([]);
  });

  it("an answer it cannot read is an error naming what a game there is made of, never a quiet nothing", () => {
    const other = [{ id: 7, match: { home: "Olympic", away: "Lions", kickoff: "2027-03-14 09:30" } }];
    expect(() => normalizeDribl(other, BRISBANE)).toThrow(`${NOT_READABLE} A game there has: id, match.`);
    const renamed = [{ type: "fixtures", hash_id: "abc", attributes: { homeTeam: "Olympic", awayTeam: "Lions", start: "2027-03-14" } }];
    expect(() => normalizeDribl(renamed, BRISBANE)).toThrow(`${NOT_READABLE} A game there has: type, hash_id, attributes; attributes: homeTeam, awayTeam, start.`);
    expect(() => normalizeDribl(["x", 7], BRISBANE)).toThrow(NOT_READABLE);
    expect(NOT_READABLE).toBe("Dribl's answer was not in the form this app reads.");
    // A date it cannot make sense of on one of our games is the same kind of mismatch.
    expect(() => normalizeDribl([item("a", { date: "next Sunday" })], OURS)).toThrow(`${NOT_READABLE} A game's date reads: "next Sunday".`);
    expect(() => normalizeDribl([item("a", { date: undefined })], OURS)).toThrow(`${NOT_READABLE} A game's date reads: null.`);
    for (const notAList of [null, undefined, {}, "x"]) expect(() => normalizeDribl(notAList, BRISBANE)).toThrow("Unexpected Dribl response shape");
  });

  it("skips an item with no usable id, and reads a flat item as well as one with attributes", () => {
    const flat = { hash_id: "flat1", date: "2027-03-13T23:30:00Z", round: "R1", home_team_name: "Olympic FC U9 White", away_team_name: "Lions FC U9", ground_name: "Goodwin Park" };
    expect(normalizeDribl([flat, item("ok"), { ...item("bad id!"), hash_id: "bad id!" }, { ...item("x"), hash_id: "" }], OURS).map((r) => r.squadiId)).toEqual(["dribl:flat1", "dribl:ok"]);
  });

  it("makes records the server's check accepts unchanged", () => {
    const records = normalizeDribl([item("a"), item("b", { home_team_name: "Tigers U9", away_team_name: "Olympic FC U9 White", round: "SF", full_round: "Semi Final" })], BRISBANE);
    expect(sanitizeDrawRecords(records)).toEqual(records);
  });
});

describe("nextDriblPage", () => {
  const REQ = "https://mc-api.dribl.com/api/fixtures?date_range=all&club=CL1&tenant=T1&timezone=Australia%2FBrisbane";

  it("adds the cursor to the stored request, from meta or from the next link", () => {
    expect(nextDriblPage({ meta: { next_cursor: "eyJpZCI6MzB9" } }, REQ)).toBe(REQ + "&cursor=eyJpZCI6MzB9");
    expect(nextDriblPage({ links: { next: "https://mc-api.dribl.com/api/fixtures?tenant=T1&cursor=abc123" } }, REQ)).toBe(REQ + "&cursor=abc123");
  });

  it("is nothing on the last page", () => {
    for (const last of [{}, null, { meta: {} }, { meta: { next_cursor: null } }, { links: { next: null } }, { meta: { next_cursor: "" }, links: { next: "" } }]) expect(nextDriblPage(last, REQ)).toBe("");
  });

  it("never follows a link anywhere else: only the cursor is taken from it", () => {
    expect(nextDriblPage({ links: { next: "https://evil.example/steal?cursor=abc123" } }, REQ)).toBe(REQ + "&cursor=abc123");
    expect(nextDriblPage({ links: { next: "https://evil.example/steal" } }, REQ)).toBe("");
    expect(nextDriblPage({ meta: { next_cursor: "a b<script>" } }, REQ)).toBe("");
    expect(nextDriblPage({ meta: { next_cursor: "x".repeat(401) } }, REQ)).toBe("");
  });
});

describe("fetchDribl", () => {
  const REQ = "https://mc-api.dribl.com/api/fixtures?date_range=all&club=CL1&tenant=T1&timezone=Australia%2FBrisbane";
  const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

  it("asks Dribl plainly: one GET, no cookies, nothing but an Accept header", async () => {
    const fetchImpl = vi.fn(async () => answer({ data: [item("a")] }));
    const records = await fetchDribl({ url: REQ, team: US }, fetchImpl);
    expect(records.map((r) => r.squadiId)).toEqual(["dribl:a"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]).toEqual([REQ, { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" }]);
  });

  it("follows the cursor to the end of the draw and reads it as one", async () => {
    const pages = {
      [REQ]: { data: [item("a")], meta: { next_cursor: "p2" } },
      [REQ + "&cursor=p2"]: { data: [item("b", { away_team_name: "Tigers U9" })], links: { next: "https://mc-api.dribl.com/api/fixtures?cursor=p3" } },
      [REQ + "&cursor=p3"]: { data: [item("c", { away_team_name: "Wests U9" })], meta: { next_cursor: null } }
    };
    const fetchImpl = vi.fn(async (url) => answer(pages[url]));
    const records = await fetchDribl({ url: REQ }, fetchImpl);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([REQ, REQ + "&cursor=p2", REQ + "&cursor=p3"]);
    expect(records.map((r) => r.opponent)).toEqual(["Lions FC U9", "Tigers U9", "Wests U9"]);
  });

  it("stops after 20 pages however long Dribl keeps saying there is more", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => answer({ data: [item("g" + ++n)], meta: { next_cursor: "more" + n } }));
    const records = await fetchDribl({ url: REQ, team: US }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(20);
    expect(records).toHaveLength(20);
  });

  it("uses the stored request's timezone and the team's name from the set-up", async () => {
    const sydney = REQ.replace("Australia%2FBrisbane", "Australia%2FSydney");
    const fetchImpl = vi.fn(async () => answer({ data: [item("a"), item("b", { home_team_name: "Olympic FC U9 Red", away_team_name: "Tigers U9" })] }));
    const records = await fetchDribl({ url: sydney, team: "Olympic FC U9 White" }, fetchImpl);
    expect(records).toHaveLength(1);
    expect(records[0].time).toBe("10:30");
  });

  it("says what went wrong: Dribl's status, an answer that is not a draw, a request that is not Dribl's", async () => {
    await expect(fetchDribl({ url: REQ }, vi.fn(async () => answer(null, false, 403)))).rejects.toThrow("Dribl responded 403");
    for (const body of [null, [], "x", { data: null }, { data: {} }, { fixtures: [] }]) {
      await expect(fetchDribl({ url: REQ }, vi.fn(async () => answer(body)))).rejects.toThrow("Unexpected Dribl response shape");
    }
    // A page where data was expected (a security check, say) is not a draw either.
    await expect(fetchDribl({ url: REQ }, vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'"); } })))).rejects.toThrow("Unexpected Dribl response shape");
    // A request the browser could not make reads as a sentence, not as "Failed to fetch".
    await expect(fetchDribl({ url: REQ }, vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).rejects.toThrow(UNREACHABLE);
    expect(UNREACHABLE).toBe("Dribl could not be reached from this browser.");
    // A failure part-way through a long draw fails the draw: half of one is never applied.
    const second = vi.fn(async (url) => { if (url !== REQ) throw new TypeError("Failed to fetch"); return answer({ data: [item("a")], meta: { next_cursor: "p2" } }); });
    await expect(fetchDribl({ url: REQ, team: US }, second)).rejects.toThrow(UNREACHABLE);
    const never = vi.fn();
    for (const url of ["https://evil.example/api/fixtures?tenant=T1", "", undefined]) await expect(fetchDribl({ url }, never)).rejects.toThrow("Not a Dribl fixtures request");
    await expect(fetchDribl(null, never)).rejects.toThrow("Not a Dribl fixtures request");
    expect(never).not.toHaveBeenCalled();
  });

  it("an empty draw is no games; a second page is never asked of anything but the stored request", async () => {
    expect(await fetchDribl({ url: REQ }, vi.fn(async () => answer({ data: [] })))).toEqual([]);
    const fetchImpl = vi.fn(async (url) => answer(url === REQ ? { data: [item("a")], links: { next: "https://evil.example/x?cursor=zz" } } : { data: [] }));
    await fetchDribl({ url: REQ, team: US }, fetchImpl);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([REQ, REQ + "&cursor=zz"]);
  });
});
