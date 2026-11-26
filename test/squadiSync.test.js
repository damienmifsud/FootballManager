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

describe("applySync with a side (two feeds on one squad)", () => {
  const feed = (over) => normalize(squadiResponse([match(over)]), cfg);
  it("stamps the side on a new fixture and leads the change line with it", () => {
    const r = applySync({ fixtures: [] }, feed(), { side: "McKay" });
    expect(r.data.fixtures[0]).toMatchObject({ squadiId: "m1", round: 7, side: "McKay" });
    expect(r.changes[0]).toMatch(/^NEW — McKay · Round 7 vs Wests: /);
  });
  it("stamps a missing or different side on a matched fixture as a silent update", () => {
    const base = applySync({ fixtures: [] }, feed()).data;
    expect("side" in base.fixtures[0]).toBe(false);
    const r = applySync(base, feed(), { side: "McKay" });
    expect(r.data.fixtures[0].side).toBe("McKay");
    expect(r.changes).toEqual([]);
    expect(r.mutated).toBe(true);
    expect(r.data.fixtures[0].schedChanges).toEqual(base.fixtures[0].schedChanges);
    const again = applySync(r.data, feed(), { side: "McKay" });
    expect(again.mutated).toBe(false);
    const moved = applySync(r.data, feed(), { side: "McKain" });
    expect(moved.data.fixtures[0].side).toBe("McKain");
    expect(moved.changes).toEqual([]);
    expect(moved.mutated).toBe(true);
  });
  it("leads a schedule change line with the side", () => {
    const base = applySync({ fixtures: [] }, feed(), { side: "McKay" }).data;
    const r = applySync(base, feed({ startTime: "2026-06-20T23:00:00Z" }), { side: "McKay" });
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatch(/^McKay · Round 7 vs Wests: time /);
  });
  it("the round-number fallback never adopts a fixture that carries the other side", () => {
    const hand = { id: "h1", round: 7, side: "McKay", opponent: "Wests", dateISO: "2026-06-21", time: "08:00", venue: "", status: "upcoming" };
    const r = applySync({ fixtures: [hand] }, feed({ id: "m2" }), { side: "McKain" });
    expect(r.data.fixtures).toHaveLength(2);
    expect(r.data.fixtures[0]).toEqual(hand);
    expect(r.data.fixtures[1]).toMatchObject({ squadiId: "m2", side: "McKain" });
    // Its own side, or a fixture with no side yet, is still adopted.
    const own = applySync({ fixtures: [hand] }, feed({ id: "m3" }), { side: "McKay" });
    expect(own.data.fixtures).toHaveLength(1);
    expect(own.data.fixtures[0]).toMatchObject({ id: "h1", squadiId: "m3", side: "McKay" });
    const { side: _s, ...plain } = hand;
    const adopt = applySync({ fixtures: [plain] }, feed({ id: "m4" }), { side: "McKain" });
    expect(adopt.data.fixtures).toHaveLength(1);
    expect(adopt.data.fixtures[0]).toMatchObject({ id: "h1", squadiId: "m4", side: "McKain" });
  });
  it("two feeds give two fixtures for the round, one per side", () => {
    const a = applySync({ fixtures: [] }, feed({ id: "mA" }), { side: "McKay" }).data;
    const b = applySync(a, feed({ id: "mB", venueCourt: { name: "Field 4A", venue: { name: "Perry Park" } } }), { side: "McKain" });
    expect(b.data.fixtures.map((f) => [f.round, f.side])).toEqual([[7, "McKay"], [7, "McKain"]]);
    expect(b.created).toBe(1);
  });
  it("with no side given behaves as before: no side key, plain change lines", () => {
    const r = applySync({ fixtures: [] }, feed());
    expect("side" in r.data.fixtures[0]).toBe(false);
    expect(r.changes[0]).toMatch(/^NEW — Round 7 vs Wests: /);
    const r2 = applySync(r.data, feed({ startTime: "2026-06-20T23:00:00Z" }));
    expect(r2.changes[0]).toMatch(/^Round 7 vs Wests: time /);
    expect("side" in r2.data.fixtures[0]).toBe(false);
  });
});

// A team can have more than one Squadi draw: its season and other competitions
// (lib/competitions.js). applySync runs once per draw; `comp` says which one a
// draw is. Every competition has its own Round 1, so they must never be
// matched to each other's games.
describe("applySync — another competition's draw", () => {
  const WINTER = { id: "cwinter", name: "Winterfest" };
  const game = (over = {}) => ({ squadiId: "w1", round: 1, dateISO: "2026-07-04", time: "09:00", opponent: "Lions", venue: "Perry Park", homeAway: "H", ...over });
  const seasonRound1 = (over = {}) => ({
    id: "s1", squadiId: "m1", round: 1, dateISO: "2026-05-02", time: "08:00", opponent: "Wests", venue: "Home",
    homeAway: "H", status: "played", us: 3, them: 1, ...over
  });

  it("tags a new game with its competition and names it in the change line", () => {
    const res = applySync({ fixtures: [] }, [game()], { comp: WINTER });
    expect(res.created).toBe(1);
    expect(res.data.fixtures[0]).toMatchObject({ squadiId: "w1", round: 1, opponent: "Lions", comp: "cwinter", compName: "Winterfest" });
    // (The date's wording is the runtime's en-AU format, so it is not pinned here.)
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]).toMatch(/^NEW — Winterfest Round 1 vs Lions: .+ 09:00 @ Perry Park$/);
  });

  it("a season game carries no competition at all", () => {
    const res = applySync({ fixtures: [] }, [game()]);
    expect("comp" in res.data.fixtures[0]).toBe(false);
    expect("compName" in res.data.fixtures[0]).toBe(false);
    expect(res.changes[0]).toMatch(/^NEW — Round 1 vs Lions/);
    // The same with the option spelt out.
    expect("comp" in applySync({ fixtures: [] }, [game()], { comp: null }).data.fixtures[0]).toBe(false);
  });

  it("never matches the season's Round 1 by round number: both games exist side by side", () => {
    // A season Round 1 typed in by hand and not yet linked to Squadi: the
    // season's own draw would adopt it by round number. Winterfest's must not.
    const typed = seasonRound1({ squadiId: undefined, status: "upcoming", us: null, them: null });
    const res = applySync({ fixtures: [typed] }, [game()], { comp: WINTER });
    expect(res.created).toBe(1);
    expect(res.data.fixtures).toHaveLength(2);
    expect(res.data.fixtures[0]).toEqual(typed); // untouched
    expect(res.data.fixtures[1]).toMatchObject({ squadiId: "w1", comp: "cwinter", opponent: "Lions" });
  });

  it("the season's draw never adopts another competition's game by round number", () => {
    // A Winterfest game with no Squadi id of its own (added some other way).
    const winter = { id: "w0", round: 1, comp: "cwinter", compName: "Winterfest", dateISO: "2026-07-04", time: "09:00", opponent: "Lions", venue: "Perry Park", homeAway: "H", status: "upcoming" };
    const res = applySync({ fixtures: [winter] }, [{ squadiId: "m1", round: 1, dateISO: "2026-05-02", time: "08:00", opponent: "Wests", venue: "Home", homeAway: "H" }]);
    expect(res.created).toBe(1);
    expect(res.data.fixtures[0]).toEqual(winter);
    expect(res.data.fixtures[1]).toMatchObject({ squadiId: "m1", opponent: "Wests" });
    expect("comp" in res.data.fixtures[1]).toBe(false);
    // The season still adopts its own hand-typed round, as before.
    const typed = { id: "t1", round: 1, dateISO: "", time: "", opponent: "Wests", venue: "", homeAway: "H", status: "upcoming" };
    const adopted = applySync({ fixtures: [winter, typed] }, [{ squadiId: "m1", round: 1, dateISO: "2026-05-02", time: "08:00", opponent: "Wests", venue: "Home", homeAway: "H" }]);
    expect(adopted.created).toBe(0);
    expect(adopted.data.fixtures[1]).toMatchObject({ id: "t1", squadiId: "m1", dateISO: "2026-05-02" });
  });

  it("updates its own game by Squadi id and keeps everything the coach recorded on it", () => {
    const existing = { id: "w0", squadiId: "w1", round: 1, comp: "cwinter", compName: "Winterfest", dateISO: "2026-07-04", time: "09:00", opponent: "Lions", venue: "Perry Park", homeAway: "H", status: "upcoming", availability: { p1: { status: "in" } }, gk: "p1", notes: "Bring gazebo" };
    const res = applySync({ fixtures: [seasonRound1(), existing] }, [game({ time: "10:30", venue: "Field 3" })], { comp: WINTER });
    expect(res.created).toBe(0);
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0]).toMatch(/^Winterfest Round 1 vs Lions: time .+ 09:00 → .+ 10:30; venue "Perry Park" → "Field 3"$/);
    expect(res.data.fixtures[1]).toMatchObject({ id: "w0", time: "10:30", venue: "Field 3", comp: "cwinter", compName: "Winterfest", availability: { p1: { status: "in" } }, gk: "p1", notes: "Bring gazebo" });
    expect(res.data.fixtures[0]).toEqual(seasonRound1()); // the season game is not touched
  });

  it("a renamed competition renames its games, quietly (saved, no change line)", () => {
    const existing = { id: "w0", squadiId: "w1", round: 1, comp: "cwinter", compName: "Winterfest", dateISO: "2026-07-04", time: "09:00", opponent: "Lions", venue: "Perry Park", homeAway: "H", status: "upcoming" };
    const res = applySync({ fixtures: [existing] }, [game()], { comp: { id: "cwinter", name: "Winterfest 2026" } });
    expect(res.changes).toEqual([]);
    expect(res.mutated).toBe(true);
    expect(res.data.fixtures[0]).toMatchObject({ comp: "cwinter", compName: "Winterfest 2026" });
    // Nothing changed: nothing to save.
    const again = applySync({ fixtures: [existing] }, [game()], { comp: WINTER });
    expect(again.mutated).toBe(false);
    expect(again.changes).toEqual([]);
  });

  it("the draw a game comes back in decides its competition: ids moved to another row retag the games", () => {
    // Synced as a season game first (the ids were entered in the season's row by mistake).
    const untagged = { id: "w0", squadiId: "w1", round: 1, dateISO: "2026-07-04", time: "09:00", opponent: "Lions", venue: "Perry Park", homeAway: "H", status: "upcoming" };
    const tagged = applySync({ fixtures: [untagged] }, [game()], { comp: WINTER });
    expect(tagged.created).toBe(0);
    expect(tagged.mutated).toBe(true);
    expect(tagged.data.fixtures[0]).toMatchObject({ id: "w0", comp: "cwinter", compName: "Winterfest" });
    // And the other way: a game the season's draw returns is a season game.
    const back = applySync({ fixtures: tagged.data.fixtures }, [game()]);
    expect(back.mutated).toBe(true);
    expect("comp" in back.data.fixtures[0]).toBe(false);
    expect("compName" in back.data.fixtures[0]).toBe(false);
    expect(back.changes).toEqual([]);
  });

  it("two competitions' draws applied in turn keep to their own games", () => {
    const cup = { id: "ccup", name: "Premier Invitational" };
    let data = { fixtures: [] };
    data = applySync(data, [{ squadiId: "m1", round: 1, dateISO: "2026-05-02", time: "08:00", opponent: "Wests", venue: "Home", homeAway: "H" }]).data;
    data = applySync(data, [game()], { comp: WINTER }).data;
    data = applySync(data, [game({ squadiId: "c1", opponent: "Rovers", dateISO: "2026-05-13" })], { comp: cup }).data;
    expect(data.fixtures.map((f) => [f.round, f.opponent, f.comp || "season"])).toEqual([[1, "Wests", "season"], [1, "Lions", "cwinter"], [1, "Rovers", "ccup"]]);
    // Run all three again: nothing is created, nothing changes.
    const runs = [
      applySync(data, [{ squadiId: "m1", round: 1, dateISO: "2026-05-02", time: "08:00", opponent: "Wests", venue: "Home", homeAway: "H" }]),
      applySync(data, [game()], { comp: WINTER }),
      applySync(data, [game({ squadiId: "c1", opponent: "Rovers", dateISO: "2026-05-13" })], { comp: cup })
    ];
    for (const r of runs) expect([r.created, r.changes.length, r.data.fixtures.length]).toEqual([0, 0, 3]);
  });

  it("does not mutate the document it was given", () => {
    const data = { fixtures: [seasonRound1()] };
    const before = JSON.stringify(data);
    applySync(data, [game()], { comp: WINTER });
    expect(JSON.stringify(data)).toBe(before);
  });
});
