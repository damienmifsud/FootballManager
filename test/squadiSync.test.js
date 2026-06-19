import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { normalize, applySync } from "@/lib/squadiSync";

// Pin "now" so status roll-forward (upcoming -> played once the date passes)
// and the schedChanges pruning window are deterministic. Brisbane is UTC+10,
// so 02:00Z on 2026-06-18 is midday Brisbane on the same date.
const NOW = new Date("2026-06-18T02:00:00Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const cfg = { competitionId: "1439", divisionId: "10661", teamId: 110013 };

// A minimal Squadi round/match payload. ourId (110013) is team1 => home.
function squadiResponse(matches) {
  return { rounds: [{ name: "Round 7", sequence: 6, matches }] };
}
const match = (over = {}) => ({
  id: "m1",
  startTime: "2026-06-20T22:00:00Z", // -> Brisbane 2026-06-21 08:00
  team1: { id: 110013, name: "Olympic", logoUrl: "us.png" },
  team2: { id: 222, name: "Wests", logoUrl: "them.png" },
  venueCourt: { name: "Field 2", venue: { name: "Perry Park" } },
  ...over
});

describe("normalize", () => {
  it("throws when the response shape is unexpected", () => {
    expect(() => normalize(null, cfg)).toThrow(/Unexpected Squadi response/);
    expect(() => normalize({ rounds: "nope" }, cfg)).toThrow(/Unexpected Squadi response/);
  });

  it("parses a home match with venue + field and Brisbane-converted time", () => {
    const [m] = normalize(squadiResponse([match()]), cfg);
    expect(m).toMatchObject({
      squadiId: "m1",
      round: 7,
      dateISO: "2026-06-21", // 22:00Z + 10h crosses midnight
      time: "08:00",
      opponent: "Wests",
      homeAway: "H",
      venue: "Perry Park – Field 2",
      opponentLogo: "them.png",
      ourLogo: "us.png"
    });
  });

  it("flips home/away from team1.id and picks the opponent accordingly", () => {
    const away = match({ team1: { id: 222, name: "Wests" }, team2: { id: 110013, name: "Olympic" } });
    const [m] = normalize(squadiResponse([away]), cfg);
    expect(m.homeAway).toBe("A");
    expect(m.opponent).toBe("Wests");
  });

  it("trims opponent names and venue field whitespace", () => {
    const [m] = normalize(squadiResponse([match({
      team2: { id: 222, name: "  Wests  " },
      venueCourt: { name: "  Field 2  ", venue: { name: "Perry Park" } }
    })]), cfg);
    expect(m.opponent).toBe("Wests");
    expect(m.venue).toBe("Perry Park – Field 2");
  });

  it("marks byes without scheduling fields", () => {
    const bye = match({ id: "b1", team2: { id: 0, name: "Bye" } });
    const [m] = normalize(squadiResponse([bye]), cfg);
    expect(m).toEqual({ squadiId: "b1", round: 7, bye: true });
  });

  it("skips matches missing a start time or a team", () => {
    const out = normalize(squadiResponse([
      match({ id: "a", startTime: null }),
      match({ id: "b", team1: null })
    ]), cfg);
    expect(out).toHaveLength(0);
  });

  it("derives the round from the sequence when the name has no digits", () => {
    const json = { rounds: [{ name: "Finals", sequence: 6, matches: [match()] }] };
    const [m] = normalize(json, cfg);
    expect(m.round).toBe(7); // sequence 6 + 1
  });

  it("uses only the venue name when there is no field/court", () => {
    const [m] = normalize(squadiResponse([match({ venueCourt: { venue: { name: "Perry Park" } } })]), cfg);
    expect(m.venue).toBe("Perry Park");
  });
});

describe("applySync — creating fixtures", () => {
  it("creates a new fixture when nothing matches, with a NEW change entry", () => {
    const squadi = [{ squadiId: "m1", round: 7, dateISO: "2026-08-01", time: "09:00", opponent: "Wests", venue: "Perry Park", homeAway: "H" }];
    const res = applySync({ fixtures: [] }, squadi);
    expect(res.created).toBe(1);
    expect(res.mutated).toBe(true);
    expect(res.changes[0]).toMatch(/^NEW — Round 7 vs Wests/);
    expect(res.data.fixtures).toHaveLength(1);
    expect(res.data.fixtures[0]).toMatchObject({ squadiId: "m1", opponent: "Wests", us: null, them: null });
  });

  it("marks a created fixture in the past as played, future as upcoming", () => {
    const past = applySync({ fixtures: [] }, [{ squadiId: "p", round: 1, dateISO: "2026-06-01", time: "09:00", opponent: "A", venue: "V", homeAway: "H" }]);
    expect(past.data.fixtures[0].status).toBe("played");
    const future = applySync({ fixtures: [] }, [{ squadiId: "f", round: 2, dateISO: "2026-12-01", time: "09:00", opponent: "B", venue: "V", homeAway: "H" }]);
    expect(future.data.fixtures[0].status).toBe("upcoming");
  });

  it("skips byes entirely (no fixture, no change)", () => {
    const res = applySync({ fixtures: [] }, [{ squadiId: "b1", round: 7, bye: true }]);
    expect(res.created).toBe(0);
    expect(res.data.fixtures).toHaveLength(0);
    expect(res.changes).toHaveLength(0);
  });
});

describe("applySync — matching & updating existing fixtures", () => {
  const existing = (over = {}) => ({
    id: "x1", squadiId: "m1", round: 7,
    dateISO: "2026-06-20", time: "08:00", opponent: "Wests", venue: "Perry Park",
    homeAway: "H", status: "upcoming", us: null, them: null, ...over
  });
  const updated = (over = {}) => ({ squadiId: "m1", round: 7, dateISO: "2026-06-20", time: "08:00", opponent: "Wests", venue: "Perry Park", homeAway: "H", ...over });

  it("matches by squadiId and records time/venue/opponent diffs", () => {
    const res = applySync({ fixtures: [existing()] }, [updated({ time: "09:30", venue: "New Park", opponent: "Souths" })]);
    expect(res.data.fixtures).toHaveLength(1);
    expect(res.data.fixtures[0]).toMatchObject({ time: "09:30", venue: "New Park", opponent: "Souths" });
    const entryFields = res.data.fixtures[0].schedChanges.map((c) => c.field);
    expect(entryFields).toEqual(expect.arrayContaining(["Time", "Venue", "Opponent"]));
    expect(res.changes[0]).toContain("Round 7 vs Souths");
  });

  it("preserves scores, scorers, notes and availability across a schedule update", () => {
    const keep = existing({
      us: 3, them: 1, status: "played",
      goals: [{ player: "Sam" }], assists: [{ player: "Lee" }],
      notes: "great game", availability: { p1: { status: "in" } }, fruit: "Alex"
    });
    const res = applySync({ fixtures: [keep] }, [updated({ venue: "Moved Park" })]);
    const f = res.data.fixtures[0];
    expect(f).toMatchObject({
      us: 3, them: 1, notes: "great game", fruit: "Alex",
      goals: [{ player: "Sam" }], assists: [{ player: "Lee" }],
      availability: { p1: { status: "in" } }
    });
    expect(f.venue).toBe("Moved Park");
  });

  it("does nothing (no change, not mutated) when the schedule is identical", () => {
    const res = applySync({ fixtures: [existing()] }, [updated()]);
    expect(res.changes).toHaveLength(0);
    expect(res.mutated).toBe(false);
  });

  it("matches an unkeyed fixture by round, but never adopts a manual fixture", () => {
    const manual = { id: "man", round: 7, manual: true, opponent: "Friendly", dateISO: "2026-06-20", time: "08:00", status: "upcoming" };
    const res = applySync({ fixtures: [manual] }, [updated({ time: "10:00" })]);
    // The manual fixture is untouched and a brand-new fixture is created instead.
    expect(res.created).toBe(1);
    const man = res.data.fixtures.find((f) => f.id === "man");
    expect(man.time).toBe("08:00");
    expect(man.opponent).toBe("Friendly");
  });

  it("adopts an unkeyed, non-manual fixture by round number", () => {
    const unkeyed = { id: "u1", round: 7, opponent: "Wests", dateISO: "2026-06-20", time: "08:00", status: "upcoming" };
    const res = applySync({ fixtures: [unkeyed] }, [updated({ time: "11:00" })]);
    expect(res.created).toBe(0);
    expect(res.data.fixtures).toHaveLength(1);
    expect(res.data.fixtures[0]).toMatchObject({ id: "u1", squadiId: "m1", time: "11:00" });
  });
});

describe("applySync — status roll-forward", () => {
  const base = { squadiId: "m1", round: 7, opponent: "Wests", venue: "Perry Park", homeAway: "H" };

  it("rolls an upcoming fixture forward to played once its date has passed", () => {
    const f = { id: "x", squadiId: "m1", round: 7, status: "upcoming", dateISO: "2026-06-10", time: "08:00", opponent: "Wests", venue: "Perry Park", homeAway: "H" };
    const res = applySync({ fixtures: [f] }, [{ ...base, dateISO: "2026-06-10", time: "08:00" }]);
    expect(res.data.fixtures[0].status).toBe("played");
    expect(res.mutated).toBe(true);
  });

  it("never rolls a played fixture backward to upcoming", () => {
    const f = { id: "x", squadiId: "m1", round: 7, status: "played", dateISO: "2026-12-01", time: "08:00", opponent: "Wests", venue: "Perry Park", homeAway: "H" };
    const res = applySync({ fixtures: [f] }, [{ ...base, dateISO: "2026-12-01", time: "08:00" }]);
    expect(res.data.fixtures[0].status).toBe("played");
  });
});

describe("applySync — schedChanges housekeeping", () => {
  const day = 86400000;
  const upd = { squadiId: "m1", round: 7, dateISO: "2026-06-20", time: "09:30", opponent: "Wests", venue: "Perry Park", homeAway: "H" };

  it("drops schedChanges older than 14 days", () => {
    const f = {
      id: "x", squadiId: "m1", round: 7, status: "upcoming", dateISO: "2026-06-20", time: "08:00",
      opponent: "Wests", venue: "Perry Park", homeAway: "H",
      schedChanges: [{ field: "Old", at: NOW.getTime() - 15 * day }]
    };
    const res = applySync({ fixtures: [f] }, [upd]); // time diff triggers a new entry
    const fields = res.data.fixtures[0].schedChanges.map((c) => c.field);
    expect(fields).not.toContain("Old");
    expect(fields).toContain("Time");
  });

  it("caps schedChanges at the most recent 6 entries", () => {
    const recent = Array.from({ length: 6 }, (_, i) => ({ field: `r${i}`, at: NOW.getTime() - i * day }));
    const f = {
      id: "x", squadiId: "m1", round: 7, status: "upcoming", dateISO: "2026-06-20", time: "08:00",
      opponent: "Wests", venue: "Perry Park", homeAway: "H", schedChanges: recent
    };
    const res = applySync({ fixtures: [f] }, [upd]);
    expect(res.data.fixtures[0].schedChanges).toHaveLength(6);
    // newest (the Time entry) is kept; oldest recent is dropped
    expect(res.data.fixtures[0].schedChanges.map((c) => c.field)).toContain("Time");
  });

  it("persists a logo-only change as mutated without a visible schedule change", () => {
    const f = {
      id: "x", squadiId: "m1", round: 7, status: "upcoming", dateISO: "2026-06-20", time: "08:00",
      opponent: "Wests", venue: "Perry Park", homeAway: "H", opponentLogo: ""
    };
    const res = applySync({ fixtures: [f] }, [{ ...upd, time: "08:00", opponentLogo: "new.png" }]);
    expect(res.mutated).toBe(true);
    expect(res.changes).toHaveLength(0);
    expect(res.data.fixtures[0].opponentLogo).toBe("new.png");
  });

  it("clears the isSample flag on the returned data", () => {
    const res = applySync({ fixtures: [], isSample: true }, []);
    expect(res.data.isSample).toBe(false);
  });
});
