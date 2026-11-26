import { describe, it, expect } from "vitest";
import { parseDate, parseTime, parseTimeRange, kindOf, homeAwayOf, parseScheduleImport, onlyGroups, mergeSchedule, scheduleTemplate, stampImport, importBatches, removeImport } from "@/lib/scheduleImport";

// Bulk import of training sessions and games: tolerant parsing of the dates
// and times a coach's spreadsheet actually holds, and a merge that never adds
// the same session or game twice.
const TODAY = "2026-11-26";

describe("parseDate", () => {
  it("reads day-first dates in the usual spellings", () => {
    for (const s of ["12/01/2027", "12-01-2027", "12.1.2027", "12/1/27", "2027-01-12", "12 Jan 2027", "12 January 2027", "12-Jan-27",
      "Tue 12 Jan 2027", "Tuesday, 12 January 2027", "12th Jan 2027", "Jan 12 2027", "Tue, 12/01/2027", "2027-01-12T09:00:00"]) {
      expect(parseDate(s, TODAY), s).toBe("2027-01-12");
    }
  });

  it("a date with no year means its next occurrence", () => {
    expect(parseDate("12 Jan", TODAY)).toBe("2027-01-12");   // already passed this year
    expect(parseDate("12/01", TODAY)).toBe("2027-01-12");
    expect(parseDate("5 Dec", TODAY)).toBe("2026-12-05");    // still to come
    expect(parseDate("20 Nov", TODAY)).toBe("2026-11-20");   // a few days ago: the list has just started
    expect(parseDate("1 Oct", TODAY)).toBe("2027-10-01");    // long gone: next year's
  });

  it("refuses what is not a date", () => {
    for (const s of ["", "   ", "Training", "32/01/2027", "31/02/2027", "12/13/2027", "tomorrow", "5pm", "City"]) expect(parseDate(s, TODAY), s).toBe("");
    expect(parseDate("29/02/2028", TODAY)).toBe("2028-02-29"); // a real leap day
    expect(parseDate("29/02/2027", TODAY)).toBe("");
  });
});

describe("parseTime and parseTimeRange", () => {
  it("reads 24-hour and am/pm times, however they are punctuated", () => {
    expect(parseTime("17:30")).toBe("17:30");
    expect(parseTime("5:30pm")).toBe("17:30");
    expect(parseTime("5.30 PM")).toBe("17:30");
    expect(parseTime("5pm")).toBe("17:00");
    expect(parseTime("5 p")).toBe("17:00");
    expect(parseTime("9am")).toBe("09:00");
    expect(parseTime("12am")).toBe("00:00");
    expect(parseTime("12pm")).toBe("12:00");
    expect(parseTime("0900")).toBe("09:00");
    expect(parseTime("900")).toBe("09:00");
    expect(parseTime("17:00:00")).toBe("17:00");   // Excel adds the seconds
    expect(parseTime("5:00:00 PM")).toBe("17:00");
    expect(parseTime("noon")).toBe("12:00");
  });

  it("takes a bare 1 to 6 o'clock as the afternoon, and leaves the rest alone", () => {
    expect(parseTime("5:30")).toBe("17:30");
    expect(parseTime("4")).toBe("16:00");
    expect(parseTime("6:45")).toBe("18:45");
    expect(parseTime("05:30")).toBe("05:30"); // written with the leading zero: meant
    expect(parseTime("7:30")).toBe("07:30");
    expect(parseTime("8")).toBe("08:00");
    expect(parseTime("10:15")).toBe("10:15");
    expect(parseTime("5am")).toBe("05:00");
  });

  it("refuses what is not a time", () => {
    for (const s of ["", "25:00", "9:75", "13pm", "0am", "Home Ground", "City", "12/01/2027"]) expect(parseTime(s), s).toBe("");
  });

  it("splits a range, lending the finish's pm to a bare start", () => {
    expect(parseTimeRange("5-6pm")).toEqual({ time: "17:00", endTime: "18:00" });
    expect(parseTimeRange("17:00 - 18:30")).toEqual({ time: "17:00", endTime: "18:30" });
    expect(parseTimeRange("5:00pm – 6:15pm")).toEqual({ time: "17:00", endTime: "18:15" });
    expect(parseTimeRange("5pm to 6pm")).toEqual({ time: "17:00", endTime: "18:00" });
    expect(parseTimeRange("9am-10:30am")).toEqual({ time: "09:00", endTime: "10:30" });
    expect(parseTimeRange("11am-1pm")).toEqual({ time: "11:00", endTime: "13:00" });
    expect(parseTimeRange("5pm")).toEqual({ time: "17:00", endTime: "" });
    expect(parseTimeRange("Perry Park")).toEqual({ time: "", endTime: "" });
    expect(parseTimeRange("")).toEqual({ time: "", endTime: "" });
  });
});

describe("kindOf and homeAwayOf", () => {
  it("reads the type a row names", () => {
    expect(kindOf("Training")).toBe("training");
    expect(kindOf("training session")).toBe("training");
    expect(kindOf("Game")).toBe("game");
    expect(kindOf("Friendly match")).toBe("game");
    expect(kindOf("Trial game")).toBe("game");
    expect(kindOf("Carnival")).toBe("carnival");
    expect(kindOf("Team photo")).toBe("event");
    expect(kindOf("Event")).toBe("event");
    expect(kindOf("")).toBe("");
    expect(kindOf("???")).toBe("");
  });

  it("reads home and away", () => {
    expect(["H", "home", "Home"].map(homeAwayOf)).toEqual(["H", "H", "H"]);
    expect(["A", "away", "@"].map(homeAwayOf)).toEqual(["A", "A", "A"]);
    expect(homeAwayOf("Perry Park")).toBe("");
  });
});

describe("parseScheduleImport — training", () => {
  it("reads a file with a header, in any column order, ignoring columns it does not know", () => {
    const txt = [
      "Venue,Date,Coach,Start,Finish,Title,Notes",
      "Home Ground,12/01/2027,Byron,5:00pm,6:00pm,Training,Bring water",
      "Perry Park,Thu 14 Jan 2027,Dee,17:30,18:45,,",
      ",,,,,,",
      "Home Ground,19/01/2027,Byron,5-6pm,,Skills night,"
    ].join("\r\n");
    const { sessions, fixtures, problems, hasHeader } = parseScheduleImport("﻿" + txt, { todayISO: TODAY });
    expect(hasHeader).toBe(true);
    expect(fixtures).toEqual([]);
    expect(problems).toEqual([]);
    expect(sessions.map(({ id, ...s }) => s)).toEqual([
      { title: "Training", kind: "training", time: "17:00", endTime: "18:00", location: "Home Ground", notes: "Bring water", recur: "once", dateISO: "2027-01-12" },
      { title: "Training", kind: "training", time: "17:30", endTime: "18:45", location: "Perry Park", notes: "", recur: "once", dateISO: "2027-01-14" },
      { title: "Skills night", kind: "training", time: "17:00", endTime: "18:00", location: "Home Ground", notes: "", recur: "once", dateISO: "2027-01-19" }
    ]);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(3);
  });

  it("reads a plain list with no header: date, start, finish, location, title", () => {
    const { sessions, hasHeader } = parseScheduleImport("12/01/2027, 5pm, 6pm, Home Ground\n14/01/2027, 5:30pm, Perry Park, Fitness\n16/01/2027", { todayISO: TODAY });
    expect(hasHeader).toBe(false);
    expect(sessions.map((s) => [s.dateISO, s.time, s.endTime, s.location, s.title])).toEqual([
      ["2027-01-12", "17:00", "18:00", "Home Ground", "Training"],
      ["2027-01-14", "17:30", "", "Perry Park", "Fitness"],
      ["2027-01-16", "", "", "", "Training"]
    ]);
  });

  it("a Repeat of weekly makes one weekly session from the date to Until, on that weekday", () => {
    const { sessions, problems } = parseScheduleImport("Date,Start,Finish,Venue,Repeat,Until\n12/01/2027,5pm,6pm,Home Ground,weekly,25/03/2027\n14/01/2027,5pm,6pm,Home Ground,Weekly,\n19/01/2027,5pm,6pm,,weekly,01/01/2027", { todayISO: TODAY });
    expect(sessions.map(({ id, ...s }) => s)).toEqual([
      { title: "Training", kind: "training", time: "17:00", endTime: "18:00", location: "Home Ground", notes: "", recur: "weekly", weekday: 2, startISO: "2027-01-12", untilISO: "2027-03-25", dateISO: "" },
      { title: "Training", kind: "training", time: "17:00", endTime: "18:00", location: "Home Ground", notes: "", recur: "weekly", weekday: 4, startISO: "2027-01-14", untilISO: "", dateISO: "" }
    ]);
    expect(problems).toEqual([{ row: 4, text: "19/01/2027,5pm,6pm,,weekly,01/01/2027", reason: "an Until date before its start" }]);
  });

  it("the Type column makes events and carnivals; a carnival never repeats", () => {
    const { sessions } = parseScheduleImport("Type,Date,Start,Title,Venue,Repeat\nEvent,20/02/2027,10am,Team photo,Clubhouse,\nCarnival,06/03/2027,8am,Summer carnival,Ripley,weekly\nTraining,09/03/2027,5pm,,,", { todayISO: TODAY });
    expect(sessions.map((s) => [s.kind, s.title, s.recur, s.dateISO])).toEqual([
      ["event", "Team photo", "once", "2027-02-20"], ["carnival", "Summer carnival", "once", "2027-03-06"], ["training", "Training", "once", "2027-03-09"]
    ]);
  });

  it("reports the rows it could not use, by row number, and keeps the rest", () => {
    const { sessions, problems } = parseScheduleImport("Date,Start,Venue\n12/01/2027,5pm,Home Ground\nsoon,5pm,Home Ground\n,6pm,\n14/01/2027,5pm,", { todayISO: TODAY });
    expect(sessions.map((s) => s.dateISO)).toEqual(["2027-01-12", "2027-01-14"]);
    expect(problems).toEqual([
      { row: 3, text: "soon,5pm,Home Ground", reason: "no date it can read" },
      { row: 4, text: ",6pm,", reason: "no date it can read" }
    ]);
  });

  it("reads a copy straight out of a spreadsheet (tabs)", () => {
    const { sessions } = parseScheduleImport("Date\tStart\tFinish\tVenue\n12/01/2027\t5:00 PM\t6:00 PM\tHome Ground, field 2", { todayISO: TODAY });
    expect(sessions[0]).toMatchObject({ dateISO: "2027-01-12", time: "17:00", endTime: "18:00", location: "Home Ground, field 2" });
  });

  it("returns nothing for empty input", () => {
    expect(parseScheduleImport("", { todayISO: TODAY })).toMatchObject({ sessions: [], fixtures: [], problems: [], hasHeader: false, groups: [] });
    expect(parseScheduleImport(null).sessions).toEqual([]);
  });
});

// An XPS Network import file, the layout a coach already keeps their schedule
// in: it should go in as it is.
const XPS_HEAD = "Session Type (Game/Practice/Event),Team/Group,Date,Time,Duration (minutes),Arrive X min before,Label,Color (1-12),Notes,Coach's Notes,Location,Location Description,Notify Athletes Now (Yes/No),Notify Family Now (Yes/No)";
describe("parseScheduleImport — an XPS import file", () => {
  it("reads practices: Label is the title, Duration gives the finish, Location the place", () => {
    const txt = [
      XPS_HEAD,
      "Practice,U9 Reds,16/11/2026,16:30,60,5,Squad training,,,,Riverside Park,,No,No",
      "Practice,U9 Reds,13/01/2027,16:30,75,0,Squad training,3,Bring boots,,Riverside Park,Far field,No,No",
      "Event,U9 Reds,20/02/2027,10:00,,,Team photo,,,,Clubhouse,,No,No"
    ].join("\n") + "\n";
    const { sessions, fixtures, problems, hasHeader, groups } = parseScheduleImport(txt, { todayISO: TODAY });
    expect(hasHeader).toBe(true);
    expect(problems).toEqual([]);
    expect(fixtures).toEqual([]);
    expect(groups).toEqual(["U9 Reds"]);
    expect(sessions.map(({ id, ...s }) => s)).toEqual([
      { title: "Squad training", kind: "training", time: "16:30", endTime: "17:30", location: "Riverside Park", notes: "Arrive 5 minutes early.", recur: "once", dateISO: "2026-11-16" },
      { title: "Squad training", kind: "training", time: "16:30", endTime: "17:45", location: "Riverside Park", notes: "Bring boots Far field", recur: "once", dateISO: "2027-01-13" },
      { title: "Team photo", kind: "event", time: "10:00", endTime: "", location: "Clubhouse", notes: "", recur: "once", dateISO: "2027-02-20" }
    ]);
    // The group a row named is kept beside the items, never saved on them.
    for (const s of sessions) expect(s).not.toHaveProperty("group");
  });

  it("never reads the Coach's Notes column: session notes are shown to everyone", () => {
    const txt = [XPS_HEAD, "Practice,U9 Reds,16/11/2026,16:30,60,,Training,,For parents,PRIVATE: watch the left side,Riverside Park,,No,No"].join("\n");
    const { sessions } = parseScheduleImport(txt, { todayISO: TODAY });
    expect(sessions[0].notes).toBe("For parents");
    expect(JSON.stringify(sessions)).not.toMatch(/PRIVATE|left side/);
  });

  it("a Game row takes its opponent from the Label", () => {
    const txt = [XPS_HEAD, "Game,U9 Reds,06/02/2027,09:00,50,30,vs City,,,,City Park,,No,No", "Game,U9 Reds,13/02/2027,09:00,50,,,,,,Home Ground,,No,No"].join("\n");
    const { fixtures, sessions, problems } = parseScheduleImport(txt, { todayISO: TODAY });
    expect(sessions).toEqual([]);
    expect(fixtures.map((f) => [f.dateISO, f.time, f.opponent, f.venue, f.notes])).toEqual([["2027-02-06", "09:00", "City", "City Park", "Arrive 30 minutes early."]]);
    expect(problems).toEqual([{ row: 3, text: "Game,U9 Reds,13/02/2027,09:00,50,,,,,,Home Ground,,No,No", reason: "no opponent" }]);
  });

  it("a file for several teams can be narrowed to the ones wanted", () => {
    const txt = [XPS_HEAD,
      "Practice,U9 Reds,16/11/2026,16:30,60,,Training,,,,Riverside Park,,No,No",
      "Practice,U10 Blues,17/11/2026,16:30,60,,Training,,,,Riverside Park,,No,No",
      "Game,U10 Blues,21/11/2026,09:00,40,,vs City,,,,City Park,,No,No"].join("\n");
    const parsed = parseScheduleImport(txt, { todayISO: TODAY });
    expect(parsed.groups).toEqual(["U9 Reds", "U10 Blues"]);
    const reds = onlyGroups(parsed, ["U9 Reds"]);
    expect([reds.sessions.map((s) => s.dateISO), reds.fixtures.length]).toEqual([["2026-11-16"], 0]);
    const blues = onlyGroups(parsed, ["U10 Blues"]);
    expect([blues.sessions.map((s) => s.dateISO), blues.fixtures.map((f) => f.opponent)]).toEqual([["2026-11-17"], ["City"]]);
    expect(onlyGroups(parsed, []).sessions).toEqual([]);
  });

  it("Finish wins over Duration, and a duration never runs past midnight", () => {
    const { sessions } = parseScheduleImport("Date,Start,Finish,Duration\n12/01/2027,5pm,6:15pm,90\n13/01/2027,23:30,,90\n14/01/2027,,,60", { todayISO: TODAY });
    expect(sessions.map((s) => [s.time, s.endTime])).toEqual([["17:00", "18:15"], ["23:30", "23:59"], ["", ""]]);
  });
});

describe("parseScheduleImport — files as spreadsheets save them", () => {
  it("a byte-order mark at the start does not hide the first header", () => {
    const out = parseScheduleImport("\uFEFFDate,Start,Finish,Venue\n12/01/2027,5:00pm,6:00pm,Home Ground", { todayISO: TODAY });
    expect(out.hasHeader).toBe(true);
    expect(out.sessions.map((s) => [s.dateISO, s.time, s.endTime, s.location])).toEqual([["2027-01-12", "17:00", "18:00", "Home Ground"]]);
  });

  it("Windows line endings and blank lines are ignored", () => {
    const out = parseScheduleImport("Date,Start,Venue\r\n\r\n12/01/2027,17:00,Home Ground\r\n\r\n14/01/2027,17:00,Home Ground\r\n", { todayISO: TODAY });
    expect(out.sessions.map((s) => s.dateISO)).toEqual(["2027-01-12", "2027-01-14"]);
    expect(out.sessions.every((s) => s.location === "Home Ground")).toBe(true);
    expect(out.problems).toEqual([]);
  });

  it("a note typed over two lines stays one row, and reads with a space where the break was", () => {
    const out = parseScheduleImport(['Date,Start,Notes,Venue', '12/01/2027,17:00,"Bring boots', 'and a water bottle, please",Home Ground', '14/01/2027,17:00,,Home Ground'].join("\n"), { todayISO: TODAY });
    expect(out.problems).toEqual([]);
    expect(out.sessions.map((s) => [s.dateISO, s.notes, s.location])).toEqual([
      ["2027-01-12", "Bring boots and a water bottle, please", "Home Ground"],
      ["2027-01-14", "", "Home Ground"]
    ]);
  });

  it("a quote that never closes does not swallow the rows after it", () => {
    const out = parseScheduleImport(['12/01/2027, 5pm, 6pm, The "Shed', '14/01/2027, 5pm, 6pm, Home Ground'].join("\n"), { todayISO: TODAY });
    expect(out.sessions.map((s) => s.dateISO)).toEqual(["2027-01-12", "2027-01-14"]);
  });

  it("a skipped row is reported by its place in the file, blank lines and all", () => {
    const withHeader = parseScheduleImport("Date,Start\n12/01/2027,17:00\n\nnot a date,17:00\n14/01/2027,17:00", { todayISO: TODAY });
    expect(withHeader.problems.map((p) => [p.row, p.reason])).toEqual([[4, "no date it can read"]]);
    const plain = parseScheduleImport("12/01/2027, 5pm\n\n\nsometime, 5pm", { todayISO: TODAY });
    expect(plain.problems.map((p) => p.row)).toEqual([4]);
  });
});

describe("parseScheduleImport — games", () => {
  it("reads a games file: opponent, home or away, venue, round, and a score makes it played", () => {
    const txt = "Date,Time,Opponent,Home or away,Venue,Round,Score,Notes\n14/02/2027,9:00am,City,Home,Home Ground,1,,\n21/02/2027,10:15am,vs Rovers,Away,Rovers Park,2,,Arrive early\n07/02/2027,9am,Wests,H,,,3-1,";
    const { fixtures, sessions, problems } = parseScheduleImport(txt, { mode: "games", todayISO: TODAY });
    expect(sessions).toEqual([]);
    expect(problems).toEqual([]);
    expect(fixtures.map(({ id, ...f }) => f)).toEqual([
      { round: 1, dateISO: "2027-02-14", time: "09:00", opponent: "City", venue: "Home Ground", homeAway: "H", status: "upcoming", us: null, them: null, fruit: "", gk: "", goals: [], assists: [], notes: "", video: "", chapters: [], manual: true },
      { round: 2, dateISO: "2027-02-21", time: "10:15", opponent: "Rovers", venue: "Rovers Park", homeAway: "A", status: "upcoming", us: null, them: null, fruit: "", gk: "", goals: [], assists: [], notes: "Arrive early", video: "", chapters: [], manual: true },
      { round: null, dateISO: "2027-02-07", time: "09:00", opponent: "Wests", venue: "", homeAway: "H", status: "played", us: 3, them: 1, fruit: "", gk: "", goals: [], assists: [], notes: "", video: "", chapters: [], manual: true }
    ]);
  });

  it("reads a plain list: date, time, opponent, home or away, venue, round", () => {
    const { fixtures } = parseScheduleImport("14/02/2027, 9am, City, Home, Home Ground, 1\n21/02/2027, @ Rovers, Rovers Park\n28/02/2027, 10:15, vs Wests", { mode: "games", todayISO: TODAY });
    expect(fixtures.map((f) => [f.dateISO, f.time, f.opponent, f.homeAway, f.venue, f.round])).toEqual([
      ["2027-02-14", "09:00", "City", "H", "Home Ground", 1],
      ["2027-02-21", "", "Rovers", "A", "Rovers Park", null],
      ["2027-02-28", "10:15", "Wests", "H", "", null]
    ]);
  });

  it("one file can hold both: a row with an opponent or a game Type is a game, the rest are sessions", () => {
    const txt = "Type,Date,Start,Finish,Title,Opponent,Home or away,Venue\nTraining,12/01/2027,5pm,6pm,,,,Home Ground\nGame,16/01/2027,9am,,,City,Away,City Park\n,19/01/2027,5pm,6pm,,,,Home Ground\n,23/01/2027,9am,,,Rovers,,";
    const { sessions, fixtures } = parseScheduleImport(txt, { todayISO: TODAY });
    expect(sessions.map((s) => s.dateISO)).toEqual(["2027-01-12", "2027-01-19"]);
    expect(fixtures.map((f) => [f.dateISO, f.opponent, f.homeAway])).toEqual([["2027-01-16", "City", "A"], ["2027-01-23", "Rovers", "H"]]);
  });

  it("separate Us and Them columns work as a score; a game with no opponent is reported", () => {
    const { fixtures, problems } = parseScheduleImport("Date,Opponent,Us,Them\n07/02/2027,Wests,2,2\n14/02/2027,,,", { mode: "games", todayISO: TODAY });
    expect(fixtures.map((f) => [f.status, f.us, f.them])).toEqual([["played", 2, 2]]);
    expect(problems).toEqual([{ row: 3, text: "14/02/2027,,,", reason: "no opponent" }]);
  });
});

describe("mergeSchedule", () => {
  const data = () => ({
    sessions: [
      { id: "s1", title: "Training", kind: "training", recur: "once", dateISO: "2027-01-12", time: "17:00", endTime: "", location: "", notes: "", availability: { "2027-01-12": { p1: { status: "in" } } } },
      { id: "s2", title: "Training", kind: "training", recur: "weekly", weekday: 4, startISO: "2027-01-14", untilISO: "", time: "17:00", endTime: "18:00", location: "Home Ground", notes: "" }
    ],
    fixtures: [
      { id: "f1", round: 1, dateISO: "2027-02-14", time: "", opponent: "City", venue: "", homeAway: "H", status: "upcoming", availability: { p1: { status: "in" } }, gk: "p1" }
    ]
  });
  const parse = (txt, mode) => parseScheduleImport(txt, { mode, todayISO: TODAY });

  it("adds what is new and never adds the same session or game twice", () => {
    const src = data();
    const before = JSON.parse(JSON.stringify(src));
    const res = mergeSchedule(src, parse("Date,Start,Finish,Venue\n12/01/2027,5pm,6pm,Home Ground\n19/01/2027,5pm,6pm,Home Ground"));
    expect(res.addedSessions.map((s) => s.dateISO)).toEqual(["2027-01-19"]);
    expect(res.sessions).toHaveLength(3);
    // The one already there kept its id and its replies; only its blanks were filled.
    expect(res.sessions[0]).toEqual({ ...before.sessions[0], endTime: "18:00", location: "Home Ground" });
    expect(res.updated).toBe(1);
    expect(src).toEqual(before); // the document is not mutated
    // Importing the same file again changes nothing.
    const again = mergeSchedule({ ...src, sessions: res.sessions }, parse("Date,Start,Finish,Venue\n12/01/2027,5pm,6pm,Home Ground\n19/01/2027,5pm,6pm,Home Ground"));
    expect(again).toMatchObject({ addedSessions: [], addedFixtures: [], updated: 0, unchanged: 2 });
  });

  it("a different start time or title on the same day is a different session", () => {
    const res = mergeSchedule(data(), parse("Date,Start,Title\n12/01/2027,7am,Training\n12/01/2027,5pm,Fitness"));
    expect(res.addedSessions.map((s) => [s.time, s.title])).toEqual([["07:00", "Training"], ["17:00", "Fitness"]]);
  });

  it("a weekly session already there is not added again", () => {
    const res = mergeSchedule(data(), parse("Date,Start,Finish,Venue,Repeat\n14/01/2027,5pm,6pm,Home Ground,weekly"));
    expect(res).toMatchObject({ addedSessions: [], unchanged: 1 });
  });

  it("games: fills a blank time, venue or round on the one already there, and keeps its replies and duties", () => {
    const res = mergeSchedule(data(), parse("Date,Time,Opponent,Venue,Round\n14/02/2027,9am,city,Home Ground,5\n21/02/2027,9am,Rovers,,", "games"));
    expect(res.fixtures[0]).toEqual({ id: "f1", round: 1, dateISO: "2027-02-14", time: "09:00", opponent: "City", venue: "Home Ground", homeAway: "H", status: "upcoming", availability: { p1: { status: "in" } }, gk: "p1" });
    expect(res.addedFixtures.map((f) => f.opponent)).toEqual(["Rovers"]);
    expect(res.updated).toBe(1);
  });

  it("two games against the same club on one day are two games when their times differ", () => {
    const src = { sessions: [], fixtures: [{ id: "f1", dateISO: "2027-03-06", time: "09:00", opponent: "City" }] };
    const res = mergeSchedule(src, parse("Date,Time,Opponent\n06/03/2027,9am,City\n06/03/2027,11am,City", "games"));
    expect(res.addedFixtures.map((f) => f.time)).toEqual(["11:00"]);
    expect(res.unchanged).toBe(1);
  });

  it("a dated session on a weekly session's own day and time is already on the calendar", () => {
    // Thursdays at 17:00 from 14 Jan (s2). The list repeats those dates and adds a Tuesday.
    const season = { startISO: "2027-01-01", endISO: "2027-12-31" };
    const res = mergeSchedule(data(), parse("Date,Start,Finish,Title\n14/01/2027,5pm,6pm,Squad training\n21/01/2027,5pm,6pm,Squad training\n21/01/2027,7am,8am,Extra\n26/01/2027,5pm,6pm,Squad training"), { season });
    expect(res.covered).toBe(2);
    expect(res.addedSessions.map((s) => [s.dateISO, s.time])).toEqual([["2027-01-21", "07:00"], ["2027-01-26", "17:00"]]);
    // Outside the season the weekly session does not run, so the dated one is needed.
    const short = mergeSchedule(data(), parse("Date,Start\n21/01/2027,5pm"), { season: { startISO: "2026-01-01", endISO: "2027-01-15" } });
    expect(short).toMatchObject({ covered: 0 });
    expect(short.addedSessions).toHaveLength(1);
    // An event at the same time is not training: it is added.
    expect(mergeSchedule(data(), parse("Type,Date,Start,Title\nEvent,21/01/2027,5pm,Team photo"), { season }).addedSessions).toHaveLength(1);
  });

  it("tolerates a document with no lists yet", () => {
    const res = mergeSchedule({}, parse("12/01/2027, 5pm"));
    expect(res.sessions).toHaveLength(1);
    expect(mergeSchedule(null, null)).toMatchObject({ sessions: [], fixtures: [], updated: 0, unchanged: 0 });
  });
});

describe("taking an import back", () => {
  const typed = { id: "s0", title: "Training", kind: "training", recur: "once", dateISO: "2027-01-05", time: "17:00", endTime: "18:00", location: "", notes: "" };
  const game0 = { id: "f0", dateISO: "2027-02-07", time: "09:00", opponent: "Wests", status: "upcoming", us: null, them: null };
  const doc = { sessions: [typed], fixtures: [game0] };
  const text = ["Type,Date,Start,Opponent,Title", "Training,12/01/2027,17:00,,", "Training,14/01/2027,17:00,,", "Game,14/02/2027,09:00,City,"].join("\n");
  const imported = (stamp, from = doc, t = text) => stampImport(mergeSchedule(from, parseScheduleImport(t, { todayISO: TODAY })), stamp);

  it("stamps only what the import added, the same stamp on each", () => {
    const out = imported("2026-11-26T10:15:00");
    expect(out.sessions.map((s) => s.imported)).toEqual([undefined, "2026-11-26T10:15:00", "2026-11-26T10:15:00"]);
    expect(out.fixtures.map((f) => f.imported)).toEqual([undefined, "2026-11-26T10:15:00"]);
    expect(out.sessions[0]).toBe(typed); // what was there is not copied or changed
  });

  it("an item the import only filled in is not stamped: it was not the import's to remove", () => {
    const blank = { ...typed, id: "s9", dateISO: "2027-01-12", endTime: "" };
    const out = stampImport(mergeSchedule({ sessions: [blank], fixtures: [] }, parseScheduleImport("Date,Start,Finish\n12/01/2027,17:00,18:00", { todayISO: TODAY })), "x");
    expect(out.sessions).toEqual([{ ...blank, endTime: "18:00" }]);
  });

  it("lists the imports still there, newest first, counting sessions, games and played games apart", () => {
    const first = imported("2026-11-26T10:15:00");
    const second = imported("2026-11-27T08:00:00", first, "Date,Start\n21/01/2027,17:00");
    expect(importBatches(second)).toEqual([
      { stamp: "2026-11-27T08:00:00", sessions: 1, games: 0, played: 0 },
      { stamp: "2026-11-26T10:15:00", sessions: 2, games: 1, played: 0 }
    ]);
    const played = { ...second, fixtures: second.fixtures.map((f) => (f.imported ? { ...f, status: "played", us: 2, them: 1 } : f)) };
    expect(importBatches(played)[1]).toEqual({ stamp: "2026-11-26T10:15:00", sessions: 2, games: 0, played: 1 });
    expect(importBatches(doc)).toEqual([]);
    expect(importBatches(null)).toEqual([]);
  });

  it("removes one import and nothing else: what was typed in and other imports stay", () => {
    const first = imported("2026-11-26T10:15:00");
    const second = imported("2026-11-27T08:00:00", first, "Date,Start\n21/01/2027,17:00");
    const out = removeImport(second, "2026-11-26T10:15:00");
    expect(out.sessions.map((s) => s.dateISO)).toEqual(["2027-01-05", "2027-01-21"]);
    expect(out.fixtures).toEqual([game0]);
    expect(importBatches(out).map((b) => b.stamp)).toEqual(["2026-11-27T08:00:00"]);
  });

  it("a played game stays, and an import with only played games left is no longer listed", () => {
    const first = imported("2026-11-26T10:15:00");
    const played = { ...first, fixtures: first.fixtures.map((f) => (f.imported ? { ...f, status: "played", us: 2, them: 1 } : f)) };
    const out = removeImport(played, "2026-11-26T10:15:00");
    expect(out.sessions).toEqual([typed]);
    expect(out.fixtures.map((f) => f.opponent)).toEqual(["Wests", "City"]);
    expect(importBatches(out)).toEqual([]);
  });

  it("games of a removed carnival become ordinary fixtures", () => {
    const withCarnival = stampImport(mergeSchedule(doc, parseScheduleImport("Type,Date,Start,Title\nCarnival,20/03/2027,08:00,Summer Cup", { todayISO: TODAY })), "c1");
    const carnival = withCarnival.sessions.find((s) => s.kind === "carnival");
    const linked = { ...withCarnival, fixtures: [{ ...game0, carnivalId: carnival.id }, { id: "f2", opponent: "Souths", carnivalId: "another" }] };
    const out = removeImport(linked, "c1");
    expect(out.sessions).toEqual([typed]);
    expect(out.fixtures).toEqual([game0, { id: "f2", opponent: "Souths", carnivalId: "another" }]);
  });
});

describe("scheduleTemplate", () => {
  it("each starter file reads back through the importer with no problems", () => {
    const t = parseScheduleImport(scheduleTemplate("training"), { todayISO: TODAY });
    expect(t.problems).toEqual([]);
    expect(t.sessions.map((s) => s.recur)).toEqual(["once", "weekly"]);
    const g = parseScheduleImport(scheduleTemplate("games"), { mode: "games", todayISO: TODAY });
    expect(g.problems).toEqual([]);
    expect(g.fixtures.map((f) => [f.opponent, f.homeAway, f.round])).toEqual([["City", "H", 1], ["Rovers", "A", 2]]);
  });
});
