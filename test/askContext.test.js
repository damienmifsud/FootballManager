import { describe, it, expect } from "vitest";
import { askTeamData, brisbaneToday, MAX_GAMES } from "@/lib/askContext";

// lib/askContext: what Ask is told about the team besides its documents.
// Every name here is made up.
const TODAY = "2026-06-10"; // a Wednesday
const players = [
  { id: "p1", name: "Sam Example", parentEmails: ["sam.family@example.com"], parentName: "Pat Example", mobile: "0400 000 000" },
  { id: "p2", name: "Alex Sample" },
  { id: "p3", name: "Jo" }
];
const game = (id, over) => ({ id, status: "upcoming", round: 1, dateISO: "2026-06-13", time: "09:00", opponent: "Valley Wanderers U10", homeAway: "H", venue: "Riverside Park – Field 2", ...over });
const doc = (over = {}) => ({ team: { name: "Riverside FC U10", ageGroup: "U10", division: "Academy 1", strip: "Red" }, players, fixtures: [], sessions: [], ...over });
const linesOf = (text) => text.split("\n");
const gameLine = (text, needle) => linesOf(text).find((l) => l.startsWith("- ") && l.includes(needle));

describe("brisbaneToday", () => {
  it("is the date in Brisbane, ten hours ahead of UTC all year", () => {
    expect(brisbaneToday(Date.parse("2026-11-27T13:59:00Z"))).toBe("2026-11-27");
    expect(brisbaneToday(Date.parse("2026-11-27T14:00:00Z"))).toBe("2026-11-28");
    expect(brisbaneToday(Date.parse("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("askTeamData — the head of the data", () => {
  it("opens with today's date, the team and its kit", () => {
    const head = linesOf(askTeamData(doc(), TODAY)).slice(0, 3);
    expect(head).toEqual([
      "Today is Wednesday 10 June 2026 (Brisbane).",
      "Team: Riverside FC U10 (U10, Academy 1).",
      "Kit: the club's home kit is red and its away kit is blue. This team wears the red home kit, unless a game below says it was switched."
    ]);
    expect(askTeamData(doc({ team: { name: "Riverside FC U10", strip: "Blue" } }), TODAY)).toContain("This team wears the blue away kit");
    expect(askTeamData(doc({ team: { name: "Riverside FC U10" } }), TODAY)).toContain("This team's usual kit isn't set; a game below names its kit when the coach set one.");
  });

  it("names the next game: the soonest still to come, whatever its competition", () => {
    const text = askTeamData(doc({ fixtures: [
      game("a", { round: 2, dateISO: "2026-06-20" }),
      game("b", { round: null, dateISO: "2026-06-11", time: "17:10", comp: "c5", compName: "Summer Fives", opponent: "Coastal FC" }),
      game("c", { round: 1, dateISO: "2026-06-06", status: "played", us: 1, them: 0 })
    ] }), TODAY);
    expect(text).toContain("Next game: Thu 11 Jun 2026 17:10, Summer Fives, vs Coastal FC.");
  });
});

describe("askTeamData — every game", () => {
  it("gives a played game its date, competition and round, opponent, ground and result, ours first", () => {
    const text = askTeamData(doc({ fixtures: [game("a", { round: 3, dateISO: "2026-05-02", status: "played", us: 2, them: 5 })] }), TODAY);
    expect(gameLine(text, "Valley")).toBe("- Sat 2 May 2026 09:00 | Season, round 3 | home vs Valley Wanderers U10 | ground: Riverside Park – Field 2 | lost 2–5");
    expect(text).toContain("GAMES (oldest first; scores are ours first):");
  });

  it("says a game was called off, and that one played without a score has none", () => {
    const text = askTeamData(doc({ fixtures: [
      game("a", { round: 6, dateISO: "2026-03-08", status: "cancelled", homeAway: "A", opponent: "Ridge FC" }),
      game("b", { round: 7, dateISO: "2026-03-15", status: "played", opponent: "Seaside FC" }),
      game("c", { round: 8, dateISO: "2026-03-22", status: "upcoming", opponent: "Coastal FC" }) // its day has passed
    ] }), TODAY);
    expect(gameLine(text, "Ridge")).toContain("| away at Ridge FC |");
    expect(gameLine(text, "Ridge")).toMatch(/\| called off \(cancelled\), not played$/);
    expect(gameLine(text, "Seaside")).toMatch(/\| played, score not recorded$/);
    expect(gameLine(text, "Coastal")).toMatch(/\| played, score not recorded$/);
    expect(text).not.toContain("Next game:");
  });

  it("names another competition's round, a finals game with no round, a carnival game and a two-team squad's side", () => {
    const text = askTeamData(doc({
      team: { name: "Riverside FC U10", strip: "Red", sides: ["Reds", "Blues"] },
      sessions: [{ id: "k1", kind: "carnival", title: "Winter carnival", recur: "once", dateISO: "2026-07-04", time: "08:00", endTime: "14:00", location: "Coastal Park" }],
      fixtures: [
        game("w2", { round: 2, comp: "cw", compName: "Winter Cup", opponent: "Seaside FC", status: "played", us: 3, them: 3, pens: { us: 4, them: 3 }, dateISO: "2026-06-01" }),
        game("sf", { round: null, comp: "c5", compName: "Summer Fives", opponent: "Coastal FC", dateISO: "2026-06-11" }),
        game("k", { round: null, carnivalId: "k1", opponent: "Ridge FC", dateISO: "2026-07-04" }),
        game("r", { round: 4, side: "Reds", opponent: "Valley Wanderers U10", dateISO: "2026-06-13" }),
        game("b", { round: 4, side: "Blues", opponent: "Seaside FC", dateISO: "2026-06-13", time: "10:00" })
      ]
    }), TODAY);
    expect(gameLine(text, "Winter Cup")).toContain("| Winter Cup · Round 2 | home vs Seaside FC | ground: Riverside Park – Field 2 | drew 3–3, won 4–3 on penalties");
    expect(gameLine(text, "Summer Fives")).toContain("| Summer Fives | home vs Coastal FC |");
    expect(gameLine(text, "Carnival")).toContain("| Carnival: Winter carnival | home vs Ridge FC |");
    expect(gameLine(text, "Valley")).toContain("| Season, round 4 (our Reds side) |");
    expect(gameLine(text, "10:00")).toContain("| Season, round 4 (our Blues side) | home vs Seaside FC |");
    expect(text).not.toContain("null");
  });

  it("for a coming game: when to arrive, the kit to wear, and who is on each duty the team has on", () => {
    const team = { name: "Riverside FC U10", strip: "Red", features: { fruitDuty: true, gkDuty: true, jerseyDuty: true, focus: true } };
    const text = askTeamData(doc({ team, fixtures: [
      game("a", { fruit: "p1", gk: "p2", focusTitle: "Receiving" }),
      game("b", { round: 2, dateISO: "2026-06-20", strip: "Blue", jersey: "p3", opponent: "Seaside FC" })
    ] }), TODAY);
    expect(gameLine(text, "Valley")).toBe("- Sat 13 Jun 2026 09:00 | Season, round 1 | home vs Valley Wanderers U10 | ground: Riverside Park – Field 2 | coming up | arrive by 08:30 | kit: red (home kit) | fruit duty: Sam E.'s family | in goal: Alex S. | washing the jerseys: not assigned yet | focus: Receiving");
    expect(gameLine(text, "Seaside")).toContain("| kit: blue (away kit), switched for this game | fruit duty: not assigned yet | in goal: not assigned yet | washing the jerseys: Jo's family");
  });

  it("leaves out a duty the team has off, the focus when focuses are off, and a past game's kit and empty duties", () => {
    const team = { name: "Riverside FC U10", strip: "Red", features: { fruitDuty: true, gkDuty: false, jerseyDuty: false, focus: false } };
    const text = askTeamData(doc({ team, fixtures: [
      game("a", { gk: "p2", focusTitle: "Receiving" }),
      game("b", { round: 0, dateISO: "2026-05-30", status: "played", us: 1, them: 0, fruit: "p1", opponent: "Seaside FC" })
    ] }), TODAY);
    expect(gameLine(text, "Valley")).toMatch(/\| kit: red \(home kit\) \| fruit duty: not assigned yet$/);
    expect(gameLine(text, "Seaside")).toMatch(/\| won 1–0 \| fruit duty: Sam E\.'s family$/);
  });

  it("only ever names a child as the duty cards do: never an email, phone number or parent's name", () => {
    const text = askTeamData(doc({ fixtures: [game("a", { fruit: "p1" })] }), TODAY);
    expect(text).toContain("Sam E.'s family");
    expect(text).not.toMatch(/Example|example\.com|0400|Pat/);
  });

  it("keeps every coming game and the most recent played ones when there are more than it can take", () => {
    const old = Array.from({ length: MAX_GAMES + 5 }, (_, i) => game("o" + i, { round: i + 1, status: "played", us: 1, them: 1, dateISO: `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}` }));
    const text = askTeamData(doc({ fixtures: [...old, game("next", { opponent: "Coastal FC" })] }), TODAY);
    expect(text).toContain("home vs Coastal FC");
    expect(text).toContain("(6 older games left out)");
    expect(linesOf(text).filter((l) => l.startsWith("- ") && l.includes("| Season, round"))).toHaveLength(MAX_GAMES);
  });
});

describe("askTeamData — training, the record and the squad", () => {
  it("lists weekly training with its days and place, one-off dates, and the season's record", () => {
    const text = askTeamData(doc({
      sessions: [
        { id: "t1", title: "Training", kind: "training", recur: "weekly", weekday: 2, time: "17:30", endTime: "19:00", location: "Riverside Park", startISO: "2026-03-01", untilISO: "2026-09-15" },
        { id: "e1", title: "Team photo day", kind: "event", recur: "once", dateISO: "2026-06-20", time: "08:30", location: "Clubhouse" }
      ],
      fixtures: [
        game("a", { round: 1, dateISO: "2026-05-02", status: "played", us: 3, them: 1 }),
        game("b", { round: 2, dateISO: "2026-05-09", status: "played", us: 0, them: 0 }),
        game("c", { round: 1, comp: "cw", compName: "Winter Cup", dateISO: "2026-05-16", status: "played", us: 0, them: 9 })
      ]
    }), TODAY);
    expect(text).toContain("TRAINING AND OTHER DATES:\n- Training: every Tuesday 17:30–19:00 at Riverside Park from Sun 1 Mar 2026 until Tue 15 Sep 2026\n- Team photo day: Sat 20 Jun 2026 08:30 at Clubhouse");
    expect(text).toContain("Season record (season games only; other competitions and carnivals don't count): played 2, won 1, drawn 1, lost 0; 3 goals for, 1 against.");
    expect(text).toMatch(/Squad: 3 players\.$/);
  });

  it("gives no record before a season game has a score", () => {
    const text = askTeamData(doc({ fixtures: [game("a"), game("b", { round: 2, comp: "cw", compName: "Winter Cup", status: "played", us: 2, them: 0, dateISO: "2026-06-01" })] }), TODAY);
    expect(text).not.toContain("Season record");
  });

  it("copes with a document that has next to nothing in it", () => {
    expect(askTeamData({}, TODAY)).toBe([
      "Today is Wednesday 10 June 2026 (Brisbane).",
      "Team: the team.",
      "Kit: the club's home kit is red and its away kit is blue. This team's usual kit isn't set; a game below names its kit when the coach set one.",
      "",
      "GAMES (oldest first; scores are ours first):",
      "- none on the schedule yet",
      "Squad: 0 players."
    ].join("\n"));
  });
});
