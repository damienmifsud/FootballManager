import { describe, it, expect } from "vitest";
import { familyTeams, hasFamilyOnSeveralTeams, familyItems, familyWeek, FAMILY_DAYS } from "@/lib/familyWeek";
import { isoLocal, addDays } from "@/lib/dashboardData";

// The combined view for a family on more than one team: which teams count,
// and what one fortnight of them looks like. Pure helpers; everyone is made up.

const TODAY = "2026-06-10"; // a Wednesday
const day = (n) => isoLocal(addDays(TODAY, n));
const A = { teamSlug: "u9", teamName: "U9 Reds" };
const B = { teamSlug: "u11", teamName: "U11 Blues" };
const parent = (t, playerId, playerName) => ({ ...t, role: "parent", playerId, playerName });
const player = (t, playerId, playerName) => ({ ...t, role: "player", playerId, playerName });

describe("familyTeams — the teams a login answers for someone on", () => {
  it("lists each team with the family's players there, own record marked", () => {
    const teams = familyTeams([
      parent(A, "p1", "Leo K."), parent(A, "p2", "Ana K."),
      player({ teamSlug: "ff", teamName: "Fast Fives" }, "p7", "Sam K."),
      parent(B, "p3", "Mia K.")
    ]);
    expect(teams).toEqual([
      { teamSlug: "u9", teamName: "U9 Reds", players: [{ id: "p1", name: "Leo K." }, { id: "p2", name: "Ana K." }] },
      { teamSlug: "ff", teamName: "Fast Fives", players: [{ id: "p7", name: "Sam K.", isSelf: true }] },
      { teamSlug: "u11", teamName: "U11 Blues", players: [{ id: "p3", name: "Mia K." }] }
    ]);
  });

  it("a team where the login only coaches, or may only look, is not a family team", () => {
    const m = [
      { ...A, role: "coach", staffRole: "Assistant coach" }, parent(A, "p1", "Leo K."),
      { ...B, role: "coach" },
      { teamSlug: "u13", teamName: "U13 Golds", role: "viewer", clubAdmin: true, club: true },
      { teamSlug: "u15", teamName: "U15", role: "coach", admin: true, club: true }
    ];
    expect(familyTeams(m).map((t) => t.teamSlug)).toEqual(["u9"]);
    expect(hasFamilyOnSeveralTeams(m)).toBe(false);
  });

  it("the combined view is for a family on two or more teams", () => {
    expect(hasFamilyOnSeveralTeams([parent(A, "p1", "Leo"), parent(B, "p3", "Mia")])).toBe(true);
    expect(hasFamilyOnSeveralTeams([parent(A, "p1", "Leo"), parent(A, "p2", "Ana")])).toBe(false); // two children, one team
    expect(hasFamilyOnSeveralTeams([parent(A, "p1", "Leo"), player(B, "p7", "Sam")])).toBe(true);  // their child's team and their own
    expect(hasFamilyOnSeveralTeams([])).toBe(false);
    expect(hasFamilyOnSeveralTeams(undefined)).toBe(false);
  });
});

describe("familyItems — one team's fortnight for one family", () => {
  const team = { teamSlug: "u9", teamName: "U9 Reds", players: [{ id: "p1", name: "Leo K." }, { id: "p2", name: "Ana K." }] };
  const doc = (over = {}) => ({
    team: { name: "U9 Reds", season: { startISO: "2026-01-01", endISO: "2026-12-31" }, rules: [{ id: "r1" }], coachPin: "9999" },
    players: [
      { id: "p1", name: "Leo K.", surname: "Kelly", coach: { note: "Left foot only" }, parentEmails: ["sam@example.com"] },
      { id: "p2", name: "Ana K.", surname: "Kelly" },
      { id: "p9", name: "Other", guardians: [{ name: "Someone", mobile: "0400000999", email: "someone@example.com" }] }
    ],
    fixtures: [
      { id: "f1", round: 7, status: "upcoming", dateISO: day(3), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park",
        availability: { p1: { status: "in", by: "Leo K.", at: 1 }, p2: { status: "out", reason: "Away", by: "Ana K.", at: 2 }, p9: { status: "in", by: "Other", at: 3 } },
        plan: { assignments: [{ GK: "p9" }] }, record: { minutes: [{ pid: "p9", min: 30 }] }, notes: "coach's note" }
    ],
    sessions: [{ id: "s1", title: "Training", kind: "training", recur: "weekly", weekday: 4, time: "17:00", endTime: "18:00", location: "Field 3",
      availability: { [day(1)]: { p2: { status: "in", by: "Ana K.", at: 4 }, p9: { status: "out", reason: "Sick" } } } }],
    ...over
  });

  it("games and training in order, each with the family's own replies and nobody else's", () => {
    const items = familyItems(team, doc(), TODAY);
    expect(items.map((i) => [i.dateISO, i.kind, i.what, i.title])).toEqual([
      [day(1), "session", "training", "Training"],
      [day(3), "game", "game", "vs Wests"],
      [day(8), "session", "training", "Training"]
    ]);
    expect(items[1]).toEqual({
      teamSlug: "u9", teamName: "U9 Reds", kind: "game", what: "game", id: "f1",
      dateISO: day(3), time: "09:00", title: "vs Wests", place: "Perry Park", label: "Round 7",
      opponent: "Wests", homeAway: "H", // who the crest is for, and whether it is at home
      replies: [{ playerId: "p1", name: "Leo K.", status: "in" }, { playerId: "p2", name: "Ana K.", status: "out", reason: "Away" }]
    });
    expect(items[0]).toEqual({
      teamSlug: "u9", teamName: "U9 Reds", kind: "session", what: "training", id: "s1", occ: day(1),
      dateISO: day(1), time: "17:00", endTime: "18:00", title: "Training", place: "Field 3", label: "",
      replies: [{ playerId: "p1", name: "Leo K.", status: null }, { playerId: "p2", name: "Ana K.", status: "in" }]
    });
    // Nothing of the rest of the document rides along.
    expect(JSON.stringify(items)).not.toMatch(/p9|Other|someone@example|0400000999|Left foot|9999|coach's note|assignments|minutes|sam@example|Sick/);
  });

  it("looks a fortnight ahead: today counts, the fifteenth day does not", () => {
    const items = familyItems(team, doc({
      sessions: [],
      fixtures: [
        { id: "y", status: "upcoming", dateISO: day(-1), time: "09:00", opponent: "Yesterday" },
        { id: "t", status: "upcoming", dateISO: day(0), time: "18:30", opponent: "Today" },
        { id: "l", status: "upcoming", dateISO: day(FAMILY_DAYS - 1), time: "09:00", opponent: "Last day" },
        { id: "x", status: "upcoming", dateISO: day(FAMILY_DAYS), time: "09:00", opponent: "Too far" },
        { id: "n", status: "upcoming", dateISO: "", opponent: "No date yet" }
      ]
    }), TODAY);
    expect(items.map((i) => i.title)).toEqual(["vs Today", "vs Last day"]);
    expect(familyItems(team, doc(), TODAY, 2).map((i) => i.dateISO)).toEqual([day(1)]);
  });

  it("a game already played is not coming up; a cancelled one is shown and asks nobody", () => {
    const items = familyItems(team, doc({
      sessions: [],
      fixtures: [
        { id: "p", status: "played", dateISO: day(0), time: "08:00", opponent: "Done", us: 2, them: 1 },
        { id: "c", status: "cancelled", dateISO: day(2), time: "09:00", opponent: "Rained off", availability: { p1: { status: "in" } } }
      ]
    }), TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "c", title: "vs Rained off", cancelled: true, replies: [] });
  });

  it("a player left out of a competition's squad, or a guest outside their dates, is not asked", () => {
    const items = familyItems(team, doc({
      players: [{ id: "p1", name: "Leo K." }, { id: "p2", name: "Ana K.", guest: true, fromISO: day(5), untilISO: day(20) }],
      competitionSquads: { cwinter: ["p2"] },
      sessions: [],
      fixtures: [
        { id: "s", round: 7, status: "upcoming", dateISO: day(2), time: "09:00", opponent: "Season" },
        { id: "w", round: 1, status: "upcoming", dateISO: day(6), time: "10:00", opponent: "Winter", comp: "cwinter", compName: "Winterfest" }
      ]
    }), TODAY);
    expect(items.map((i) => [i.title, i.label, i.replies.map((r) => r.name)])).toEqual([
      ["vs Season", "Round 7", ["Leo K."]],            // Ana's guest spell has not started
      ["vs Winter", "Winterfest · Round 1", ["Ana K."]] // Leo is not in the Winterfest squad
    ]);
  });

  it("a two-team squad's paired round is two rows marked as answered together, each named by its side", () => {
    const items = familyItems(team, doc({
      team: { name: "U9", sides: ["Red", "Blue"] }, sessions: [],
      fixtures: [
        { id: "r", round: 4, side: "Red", status: "upcoming", dateISO: day(3), time: "09:00", opponent: "Wests", availability: { p1: { status: "in" } } },
        { id: "b", round: 4, side: "Blue", status: "upcoming", dateISO: day(3), time: "10:00", opponent: "Easts", availability: { p1: { status: "in" } } }
      ]
    }), TODAY);
    expect(items.map((i) => [i.id, i.label, i.paired, i.replies[0].status])).toEqual([["r", "Round 4 · Red", true, "in"], ["b", "Round 4 · Blue", true, "in"]]);
  });

  it("a paired round's game lists both games, in the team's own side order, so one reply shows where each is", () => {
    const fixtures = [
      // Stored Blue first; the team's order is Red then Blue.
      { id: "b", round: 4, side: "Blue", status: "upcoming", dateISO: day(3), time: "10:00", opponent: "Wests", homeAway: "A", venue: " Perry Park – Field 4D ", availability: {} },
      { id: "r", round: 4, side: "Red", status: "upcoming", dateISO: day(3), time: "09:00", opponent: "Wests", homeAway: "A", availability: {} },
      { id: "solo", round: 5, side: "Red", status: "upcoming", dateISO: day(5), time: "09:00", opponent: "Easts", homeAway: "somewhere", venue: "Easts Oval", availability: {} }
    ];
    const items = familyItems(team, doc({ team: { name: "U9", sides: ["Red", "Blue"] }, sessions: [], fixtures }), TODAY);
    const both = [{ side: "Red", time: "09:00", place: "" }, { side: "Blue", time: "10:00", place: "Perry Park – Field 4D" }];
    expect(items.map((i) => [i.id, i.sides])).toEqual([["r", both], ["b", both], ["solo", undefined]]);
    // A round with one game is an ordinary game: no sides, and home or away only when the fixture says which.
    expect(items[2]).toMatchObject({ opponent: "Easts", place: "Easts Oval" });
    expect("paired" in items[2] || "homeAway" in items[2]).toBe(false);
    expect(items[0].homeAway).toBe("A");
    // One reply covers both games, so home or away is only said when both are the same.
    const split = familyItems(team, doc({ team: { name: "U9", sides: ["Red", "Blue"] }, sessions: [], fixtures: [fixtures[0], { ...fixtures[1], homeAway: "H" }] }), TODAY);
    expect(split.map((i) => "homeAway" in i)).toEqual([false, false]);
  });

  it("training, an activity or a carnival day names no opponent", () => {
    const items = familyItems(team, doc({ fixtures: [] }), TODAY);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !("opponent" in i) && !("homeAway" in i) && !("sides" in i))).toBe(true);
  });

  it("a carnival or other event is a session to reply to; birthdays are not events", () => {
    const items = familyItems(team, doc({
      players: [{ id: "p1", name: "Leo K.", dob: `2017-${day(2).slice(5)}` }, { id: "p2", name: "Ana K." }],
      fixtures: [],
      sessions: [
        { id: "c1", title: "Winter carnival", kind: "carnival", dateISO: day(4), time: "08:00", endTime: "14:00", location: "Perry Park", availability: { [day(4)]: { p1: { status: "out", reason: "Holiday" } } } },
        { id: "e1", title: "Team photo", kind: "event", dateISO: day(5), time: "16:30", location: "Clubhouse" }
      ]
    }), TODAY);
    expect(items.map((i) => [i.what, i.kind, i.title, i.occ])).toEqual([["carnival", "session", "Winter carnival", day(4)], ["event", "session", "Team photo", day(5)]]);
    expect(items[0].replies[0]).toEqual({ playerId: "p1", name: "Leo K.", status: "out", reason: "Holiday" });
  });

  it("someone signed in as a player is marked as themselves; a player no longer on the team is skipped", () => {
    const mine = { teamSlug: "ff", teamName: "Fast Fives", players: [{ id: "p7", name: "Sam K.", isSelf: true }, { id: "gone", name: "Left" }] };
    const items = familyItems(mine, { team: {}, players: [{ id: "p7", name: "Sam K." }], sessions: [], fixtures: [{ id: "f", status: "upcoming", dateISO: day(1), time: "19:10", opponent: "Rovers" }] }, TODAY);
    expect(items[0].replies).toEqual([{ playerId: "p7", name: "Sam K.", isSelf: true, status: null }]);
  });

  it("tolerates a team with nothing in it, or a damaged document", () => {
    expect(familyItems(team, null, TODAY)).toEqual([]);
    expect(familyItems(team, {}, TODAY)).toEqual([]);
    expect(familyItems(team, { players: [null], fixtures: [null, { id: "f", status: "upcoming", dateISO: day(1), opponent: "X" }], sessions: "nope" }, TODAY)).toEqual([
      { teamSlug: "u9", teamName: "U9 Reds", kind: "game", what: "game", id: "f", dateISO: day(1), time: "", title: "vs X", place: "", label: "", opponent: "X", replies: [] }
    ]);
    expect(familyItems(null, doc(), TODAY)).toEqual([]);
  });

  it("does not change the document it reads", () => {
    const d = doc();
    const before = JSON.stringify(d);
    familyItems(team, d, TODAY);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("familyWeek — every team's fortnight in the order it happens", () => {
  it("merges the teams by date and time, an event with no time first that day, then by team name", () => {
    const teams = [
      { teamSlug: "u9", teamName: "U9 Reds", players: [{ id: "p1", name: "Leo K." }] },
      { teamSlug: "u11", teamName: "U11 Blues", players: [{ id: "p3", name: "Mia K." }] }
    ];
    const game = (id, n, time, opponent) => ({ id, status: "upcoming", dateISO: day(n), time, opponent });
    const docs = [
      { team: {}, players: [{ id: "p1", name: "Leo K." }], sessions: [], fixtures: [game("a1", 3, "10:30", "Wests"), game("a2", 1, "", "Time to come"), game("a3", 3, "07:00", "Early")] },
      { team: {}, players: [{ id: "p3", name: "Mia K." }], sessions: [], fixtures: [game("b1", 3, "08:15", "Lions"), game("b2", 3, "10:30", "Easts")] }
    ];
    expect(familyWeek(teams, docs, TODAY).map((i) => [i.teamName, i.title, i.replies[0].name])).toEqual([
      ["U9 Reds", "vs Time to come", "Leo K."],
      ["U9 Reds", "vs Early", "Leo K."],     // the time decides before the team does
      ["U11 Blues", "vs Lions", "Mia K."],
      ["U11 Blues", "vs Easts", "Mia K."],   // the same minute as the next: by team name
      ["U9 Reds", "vs Wests", "Leo K."]
    ]);
    expect(familyWeek(teams, [docs[0], null], TODAY)).toHaveLength(3); // one team with no document yet
    expect(familyWeek([], [], TODAY)).toEqual([]);
    expect(familyWeek(undefined, undefined, TODAY)).toEqual([]);
  });
});
