import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cannedAnswer, cannedQuestions, askFallback, headCoachFirst, miniRoosFormatFor, shiftTime } from "@/lib/askCanned";
import { fmtDate } from "@/lib/dashboardData";

// Pin "now" so nextFixture() picks the same game every run. 2026-06-10 local.
const NOW = new Date(2026, 5, 10, 12, 0, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const home = { id: "f7", status: "upcoming", round: 7, dateISO: "2026-06-13", time: "08:00", opponent: "Oxley United FC U8 Eagles", venue: "J F O'Grady Memorial Park", homeAway: "H", strip: "Red", focusTitle: "Receiving" };
const away = { id: "f8", status: "upcoming", round: 8, dateISO: "2026-06-20", time: "10:30", opponent: "Lions FC", venue: "Lions Park", homeAway: "A", focusTitle: "Dribbling" };
const played = { id: "f6", status: "played", round: 6, dateISO: "2026-06-06", us: 2, them: 1, focusTitle: "Passing" };
const team = { name: "Olympic FC U8 Kangaroos White", ageGroup: "U8", headCoach: "Damien Mifsud" };
const data = (over = {}) => ({ team, fixtures: [played, home, away], players: [], sessions: [], ...over });

describe("cannedQuestions", () => {
  it("lists the four chips with the team's age group substituted", () => {
    expect(cannedQuestions(data())).toEqual([
      "When and where is our next game?",
      "What are this season's match focuses?",
      "How long are the halves at U8?",
      "What's the wet weather policy?"
    ]);
    expect(cannedQuestions(data({ team: { ageGroup: "U10" } }))[2]).toBe("How long are the halves at U10?");
    expect(cannedQuestions(data({ team: {} }))[2]).toBe("How long are the halves?");
  });
});

describe("cannedAnswer — next game", () => {
  it("home game with a strip: round, date, kick-off, venue, home side and kit, arrive 30 minutes early", () => {
    expect(cannedAnswer(data(), "When and where is our next game?")).toEqual({
      text: `Round 7 vs Oxley United FC U8 Eagles — ${fmtDate("2026-06-13")}, kick-off 08:00 at J F O'Grady Memorial Park. We're the home side, so Red kit. Aim to be there by 07:30 for warm-up.`,
      src: "Team schedule"
    });
  });

  it("away game without a strip: 'We're away.' and no kit sentence", () => {
    const a = cannedAnswer(data({ fixtures: [played, away] }), "when and where is our next game?");
    expect(a.text).toBe(`Round 8 vs Lions FC — ${fmtDate("2026-06-20")}, kick-off 10:30 at Lions Park. We're away. Aim to be there by 10:00 for warm-up.`);
    expect(a.src).toBe("Team schedule");
  });

  it("says what is still to be confirmed rather than guessing", () => {
    const a = cannedAnswer(data({ fixtures: [{ id: "x", status: "upcoming", round: 9, dateISO: "2026-07-04", opponent: "Wests", homeAway: "H" }] }), "When and where is our next game?");
    expect(a.text).toBe(`Round 9 vs Wests — ${fmtDate("2026-07-04")}, kick-off time to be confirmed, venue to be confirmed. We're the home side.`);
  });

  it("no upcoming fixture", () => {
    expect(cannedAnswer(data({ fixtures: [played] }), "When and where is our next game?"))
      .toEqual({ text: "There's no upcoming game on the schedule yet.", src: "Team schedule" });
  });
});

describe("cannedAnswer — season focuses", () => {
  it("lists distinct focus titles in fixture order and names this week's, from the head coach", () => {
    expect(cannedAnswer(data(), "What are this season's match focuses?")).toEqual({
      text: "This season's focuses: Passing, Receiving and Dribbling. Coach Damien highlights one each week — this week it's Receiving.",
      src: "Coach notes · Season focuses"
    });
  });

  it("drops the coach's name when there is no head coach, and the weekly sentence when the next game has no focus", () => {
    const noCoach = cannedAnswer(data({ team: { ageGroup: "U8" } }), "What are this season's match focuses?");
    expect(noCoach.text).toBe("This season's focuses: Passing, Receiving and Dribbling. One is highlighted each week — this week it's Receiving.");
    const noCurrent = cannedAnswer(data({ fixtures: [played, { ...home, focusTitle: "" }, away] }), "What are this season's match focuses?");
    expect(noCurrent.text).toBe("This season's focuses: Passing and Dribbling.");
  });

  it("is null (goes to the API) when the focus feature is off or nothing has a focus", () => {
    expect(cannedAnswer(data({ team: { ...team, features: { focus: false } } }), "What are this season's match focuses?")).toBeNull();
    expect(cannedAnswer(data({ fixtures: [{ ...home, focusTitle: "" }] }), "What are this season's match focuses?")).toBeNull();
  });
});

describe("cannedAnswer — halves", () => {
  it("answers from the MiniRoos format for the team's age group", () => {
    expect(cannedAnswer(data(), "How long are the halves at U8?")).toEqual({
      text: "U8 plays two 20-minute halves with at least a 5-minute break. It's 7-a-side including a goalkeeper, size 3 ball, and there's no offside.",
      src: "MiniRoos National Playing Formats"
    });
  });

  it("U11 gets the U10-U11 format and no offside claim; U7 gets 4-a-side", () => {
    const u11 = cannedAnswer(data({ team: { ageGroup: "U11" } }), "How long are the halves at U11?");
    expect(u11.text).toBe("U11 plays two 25-minute halves with at least a 5-minute break. It's 9-a-side including a goalkeeper and size 4 ball.");
    const u7 = cannedAnswer(data({ team: { ageGroup: "U7" } }), "How long are the halves at U7?");
    expect(u7.text).toBe("U7 plays two 20-minute halves with at least a 5-minute break. It's 4-a-side, no goalkeeper, size 3 ball, and there's no offside.");
    expect(miniRoosFormatFor("U9").key).toBe("U8-U9");
    expect(miniRoosFormatFor("U13")).toBeNull();
  });

  it("outside MiniRoos: only a format the coach set counts; otherwise null", () => {
    expect(cannedAnswer(data({ team: { ageGroup: "U13" } }), "How long are the halves at U13?")).toBeNull();
    const set = cannedAnswer(data({ team: { ageGroup: "U13", matchFormat: { gameLength: 60, periods: 2, playersOnField: 11, hasGK: true } } }), "How long are the halves at U13?");
    expect(set).toEqual({ text: "U13 plays two 30-minute halves. It's 11-a-side including a goalkeeper.", src: "Team settings · Match format" });
  });
});

describe("cannedAnswer — wet weather and misses", () => {
  it("wet weather is null unless the team records a policy", () => {
    expect(cannedAnswer(data(), "What's the wet weather policy?")).toBeNull();
    expect(cannedAnswer(data({ team: { ...team, wetWeather: "FQ decides by 07:00." } }), "What’s the wet weather policy?"))
      .toEqual({ text: "FQ decides by 07:00.", src: "Team info · Wet weather" });
  });

  it("anything else is null", () => {
    expect(cannedAnswer(data(), "Who is our goalkeeper?")).toBeNull();
    expect(cannedAnswer(data(), "")).toBeNull();
  });
});

describe("askFallback / headCoachFirst / shiftTime", () => {
  it("names the head coach when there is one, from either team shape", () => {
    expect(askFallback(team)).toBe("That isn't covered by the team's documents or schedule, so I won't guess. Try fixtures, training, duties or the MiniRoos rules — or message Coach Damien.");
    expect(askFallback({})).toBe("That isn't covered by the team's documents or schedule, so I won't guess. Try fixtures, training, duties or the MiniRoos rules — or message the coach.");
    expect(headCoachFirst({ staff: [{ role: "Manager", name: "Kim" }, { role: "Head coach", name: "Byron Lee" }] })).toBe("Byron");
    expect(headCoachFirst({ staff: [{ role: "Manager", name: "Kim" }] })).toBeNull();
  });

  it("shiftTime wraps within the day", () => {
    expect(shiftTime("08:00", -30)).toBe("07:30");
    expect(shiftTime("00:10", -30)).toBe("23:40");
  });
});
