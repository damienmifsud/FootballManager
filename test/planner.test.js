import { describe, it, expect } from "vitest";
import {
  round1, fmtMin, fmtRange, fmtClock, defaultFormatForAgeGroup, resolveFormat, competitionFormat, baseFormat,
  parseFormation, fallbackFormation, makePositions, computeAutoSubs,
  computeSegments, sanitizeAssignments, diffOnOff, autoFillAssignments,
  minutesFor, rosterForFixture, seedAssignments, timerElapsed
} from "@/lib/planner";

const P = (n) => ({ id: "p" + n, name: "Player " + n, available: true });

describe("format helpers", () => {
  it("formats minutes, ranges and clocks", () => {
    expect(fmtMin(10)).toBe("10");
    expect(fmtMin(12.5)).toBe("12.5");
    expect(fmtRange(0, 10)).toBe("0–10'");
    expect(fmtClock(0)).toBe("00:00");
    expect(fmtClock(605)).toBe("10:05");
    expect(round1(6.66)).toBe(6.7);
  });

  it("picks MiniRoos defaults by age group", () => {
    expect(defaultFormatForAgeGroup("U6")).toMatchObject({ playersOnField: 4, hasGK: false });
    expect(defaultFormatForAgeGroup("U8")).toMatchObject({ playersOnField: 7, hasGK: true, gameLength: 40 });
    expect(defaultFormatForAgeGroup("U11")).toMatchObject({ playersOnField: 9, gameLength: 50 });
    expect(defaultFormatForAgeGroup(undefined)).toMatchObject({ playersOnField: 7 }); // sensible default
  });

  it("resolveFormat prefers per-game override, then team default, then age default", () => {
    const teamFmt = { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "3-2-1", subInterval: 10 };
    const gameFmt = { ...teamFmt, formation: "2-3-1" };
    expect(resolveFormat({ team: { matchFormat: teamFmt } }, { plan: { format: gameFmt } })).toBe(gameFmt);
    expect(resolveFormat({ team: { matchFormat: teamFmt } }, {})).toBe(teamFmt);
    expect(resolveFormat({ team: { ageGroup: "U8" } }, {})).toMatchObject({ playersOnField: 7 });
  });
});

describe("formations and positions", () => {
  it("parses formation strings and rejects junk", () => {
    expect(parseFormation("2-3-1")).toEqual([2, 3, 1]);
    expect(parseFormation("2 3 1")).toEqual([2, 3, 1]);
    expect(parseFormation("")).toEqual([]);
    expect(parseFormation("abc")).toEqual([]);
  });

  it("falls back to a preset (or a computed split) for any outfield count", () => {
    expect(fallbackFormation(6)).toBe("2-3-1");
    expect(parseFormation(fallbackFormation(13)).reduce((a, b) => a + b, 0)).toBe(13);
  });

  it("makePositions builds GK + rows with unique labels", () => {
    const pos = makePositions([2, 3, 1], true);
    expect(pos).toHaveLength(7);
    expect(pos[0]).toMatchObject({ key: "GK", gk: true });
    const labels = pos.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length); // no duplicate labels
    expect(makePositions([2, 2], false)).toHaveLength(4);
  });
});

describe("segments", () => {
  it("computes evenly spaced auto subs inside each period", () => {
    // 40' in 2 halves, sub every 10' -> 10' and 30' (20' is half-time anyway)
    expect(computeAutoSubs(40, 2, 10)).toEqual([10, 30]);
    expect(computeAutoSubs(40, 2, 0)).toEqual([]);
  });

  it("builds blocks from kick-off, subs, breaks and full time", () => {
    const segs = computeSegments(40, 2, [10, 30]);
    expect(segs).toEqual([
      { start: 0, end: 10 }, { start: 10, end: 20 },
      { start: 20, end: 30 }, { start: 30, end: 40 }
    ]);
  });

  it("ignores sub times outside the game and dedupes period breaks", () => {
    const segs = computeSegments(40, 2, [20, 45, -5]);
    expect(segs).toEqual([{ start: 0, end: 20 }, { start: 20, end: 40 }]);
  });
});

describe("assignments", () => {
  const positions = makePositions([1], true); // GK + CM = 2 spots
  const segments = computeSegments(20, 1, [10]); // two 10' blocks
  const roster = [P(1), P(2), P(3)];

  it("sanitize drops unknown players, unknown spots and duplicates", () => {
    const raw = [
      { GK: "p1", r0c0: "p1", ghost: "p2" },       // p1 duplicated, ghost spot
      { GK: "gone", r0c0: "p3" }                    // unknown player
    ];
    const clean = sanitizeAssignments(raw, segments, positions, roster);
    expect(clean[0]).toEqual({ GK: "p1" });
    expect(clean[1]).toEqual({ r0c0: "p3" });
  });

  it("diffOnOff reports who comes on and off between blocks", () => {
    const d = diffOnOff({ GK: "p1", r0c0: "p2" }, { GK: "p1", r0c0: "p3" });
    expect(d).toEqual({ on: ["p3"], off: ["p2"] });
  });

  it("auto-fill fills only empty spots and never touches pinned players", () => {
    const pinned = [{ GK: "p1" }, { GK: "p1" }];
    const filled = autoFillAssignments(pinned, segments, positions, roster);
    expect(filled[0].GK).toBe("p1");
    expect(filled[1].GK).toBe("p1");
    expect(filled[0].r0c0).toBeTruthy();
    expect(filled[1].r0c0).toBeTruthy();
  });

  it("auto-fill balances minutes across available players", () => {
    // 2 spots x 20' = 40 player-minutes across 3 players; fair ~13.3 each.
    const filled = autoFillAssignments([{}, {}], segments, positions, roster);
    const mins = minutesFor(filled, segments, roster);
    const values = Object.values(mins);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(10);
    expect(values.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("auto-fill skips unavailable players", () => {
    const r = [P(1), { ...P(2), available: false }, P(3)];
    const filled = autoFillAssignments([{}, {}], segments, positions, r);
    const used = new Set(filled.flatMap((s) => Object.values(s)));
    expect(used.has("p2")).toBe(false);
  });
});

describe("rosterForFixture", () => {
  const data = {
    players: [
      { id: "a", name: "Ann", number: 2 },
      { id: "b", name: "Ben", number: 1 },
      { id: "g", name: "Guest", number: 9, guest: true, untilISO: "2026-01-31" }
    ]
  };
  const fixture = {
    dateISO: "2026-06-20",
    availability: { a: { status: "in" }, b: { status: "out", reason: "Sick" } }
  };

  it("maps RSVPs to availability and flags no-replies", () => {
    const d2 = { players: [...data.players, { id: "c", name: "Cy", number: 3 }] };
    const roster = rosterForFixture(d2, fixture);
    const byId = Object.fromEntries(roster.map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ available: true, noReply: false, rsvp: "in" });
    expect(byId.b).toMatchObject({ available: false, rsvp: "out" });
    expect(byId.c).toMatchObject({ available: true, noReply: true, rsvp: null });
  });

  it("excludes guests outside their window and sorts by number", () => {
    const roster = rosterForFixture(data, fixture);
    expect(roster.map((p) => p.id)).toEqual(["b", "a"]); // guest gone, number order
  });

  it("lets a per-game override flip an RSVP without touching it", () => {
    const roster = rosterForFixture(data, fixture, { b: "in" });
    const ben = roster.find((p) => p.id === "b");
    expect(ben).toMatchObject({ available: true, rsvp: "out", overridden: true, noReply: false });
  });

  // A game in a competition with a picked squad (data.competitionSquads, lib/dashboardData
  // playersFor) is planned with those players only.
  it("a competition game's roster is its squad; the season's and an unpicked competition's are everyone", () => {
    const competitionSquads = { cwinter: ["a"] };
    const winter = { ...fixture, comp: "cwinter", compName: "Winterfest" };
    expect(rosterForFixture({ ...data, competitionSquads }, winter).map((p) => p.id)).toEqual(["a"]);
    expect(rosterForFixture({ ...data, competitionSquads }, fixture).map((p) => p.id)).toEqual(["b", "a"]);
    expect(rosterForFixture({ ...data, competitionSquads }, { ...fixture, comp: "ccup" }).map((p) => p.id)).toEqual(["b", "a"]);
    expect(rosterForFixture(data, winter).map((p) => p.id)).toEqual(["b", "a"]);
    // Being picked does not bring back a guest whose window has closed.
    expect(rosterForFixture({ ...data, competitionSquads: { cwinter: ["g", "b"] } }, winter).map((p) => p.id)).toEqual(["b"]);
    // A squad nobody on the team is in any more is everyone again.
    expect(rosterForFixture({ ...data, competitionSquads: { cwinter: ["gone"] } }, winter).map((p) => p.id)).toEqual(["b", "a"]);
    // An RSVP from someone outside the squad does not put them on the sheet.
    const roster = rosterForFixture({ ...data, competitionSquads }, { ...winter, availability: { a: { status: "in" }, b: { status: "in" } } });
    expect(roster.map((p) => [p.id, p.available])).toEqual([["a", true]]);
  });
});

describe("seedAssignments and timer", () => {
  const positions = makePositions([1], true);
  const segments = computeSegments(20, 1, [10]);

  it("pins the duty keeper into every block when valid", () => {
    const seeded = seedAssignments(segments, positions, [P(1)], "p1");
    expect(seeded).toEqual([{ GK: "p1" }, { GK: "p1" }]);
  });

  it("seeds empty when the keeper is unknown, unavailable or there is no GK spot", () => {
    expect(seedAssignments(segments, positions, [P(1)], "ghost")).toEqual([{}, {}]);
    expect(seedAssignments(segments, positions, [{ ...P(1), available: false }], "p1")).toEqual([{}, {}]);
    expect(seedAssignments(segments, makePositions([2], false), [P(1)], "p1")).toEqual([{}, {}]);
  });

  it("timerElapsed derives a live clock from the anchor and caps at full time", () => {
    expect(timerElapsed(null, 40)).toBe(0);
    expect(timerElapsed({ running: false, elapsed: 90 }, 40)).toBe(90);
    const now = 1_000_000;
    expect(timerElapsed({ running: true, elapsed: 60, anchorTs: now - 30_000 }, 40, now)).toBe(90);
    expect(timerElapsed({ running: true, elapsed: 2390, anchorTs: now - 60_000 }, 40, now)).toBe(2400); // capped
  });
});

describe("rosterForFixture: players without a jersey number", () => {
  it("a number stored as 0, \"\" or null is \"\" (so discs show initials); a real number is its string", () => {
    const data = { players: [
      { id: "a", name: "Zero", number: 0 }, { id: "b", name: "Blank", number: "" },
      { id: "c", name: "Null", number: null }, { id: "d", name: "Seven", number: 7 }
    ] };
    const byId = Object.fromEntries(rosterForFixture(data, { dateISO: "2026-06-21", availability: {} }).map((p) => [p.id, p.number]));
    expect(byId).toEqual({ a: "", b: "", c: "", d: "7" });
  });
});

// A competition played in a format of its own (the club's set-up, sent with
// the team's document as data.competitionFormats): its games start from it.
describe("a competition's format", () => {
  const TEAM_FMT = { gameLength: 50, periods: 2, playersOnField: 9, hasGK: true, formation: "3-3-2", subInterval: 8 };
  const data = (over = {}) => ({ team: { ageGroup: "U10", matchFormat: TEAM_FMT }, competitionFormats: { cfives: { playersOnField: 5, hasGK: true, periods: 2, gameLength: 30 }, cnine: { playersOnField: 9, hasGK: true, periods: 4, gameLength: 60 } }, ...over });
  const fives = { id: "f1", comp: "cfives" };

  it("is the competition's size, keeper, periods and length, with a shape that fits and the team's sub interval", () => {
    expect(competitionFormat(data(), fives)).toEqual({ gameLength: 30, periods: 2, playersOnField: 5, hasGK: true, formation: fallbackFormation(4), subInterval: 8 });
    // The team's own shape is kept where it still fits.
    expect(competitionFormat(data(), { comp: "cnine" })).toEqual({ gameLength: 60, periods: 4, playersOnField: 9, hasGK: true, formation: "3-3-2", subInterval: 8 });
  });

  it("is none for a season game, a competition with no format, or one that is not whole", () => {
    expect(competitionFormat(data(), { id: "s1" })).toBeNull();
    expect(competitionFormat(data(), { comp: "cwinter" })).toBeNull();
    expect(competitionFormat(data({ competitionFormats: { cfives: { playersOnField: 5, periods: "2", gameLength: 30 } } }), fives)).toBeNull();
    expect(competitionFormat({ team: {} }, fives)).toBeNull();
  });

  it("leads a game's format: the game's own, else its competition's, else the team's, else the age group's", () => {
    expect(baseFormat(data(), fives).playersOnField).toBe(5);
    expect(baseFormat(data(), { id: "s1" })).toEqual(TEAM_FMT);
    expect(baseFormat({ team: { ageGroup: "U8" } }, { id: "s1" })).toEqual(defaultFormatForAgeGroup("U8"));
    const own = { gameLength: 20, periods: 1, playersOnField: 4, hasGK: false, formation: "2-2", subInterval: 5 };
    expect(resolveFormat(data(), { ...fives, plan: { format: own } })).toBe(own);
    expect(resolveFormat(data(), fives).gameLength).toBe(30);
  });
});
