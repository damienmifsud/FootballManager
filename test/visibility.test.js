import { describe, it, expect } from "vitest";
import { redactForViewer, brisbaneTodayISO, isCoachRole } from "@/lib/visibility";
import { DEFAULT_PARENTS_SEE } from "@/lib/teamSetup";

// lib/visibility trims the team document for parents and viewers before
// /api/data hands it out. These tests pin the contract: coach-only material
// never leaves, the "what parents see" switches open exactly what they name,
// nothing is mutated and no key is invented on a sparse document.

const TODAY = "2026-09-06";
const OTHER = "2026-09-13";
const NON_COACH = ["parent", "viewer"];
const SWITCHES = Object.keys(DEFAULT_PARENTS_SEE);
// Every one of the 2^5 switch combinations.
const ALL_COMBOS = Array.from({ length: 1 << SWITCHES.length }, (_, bits) =>
  Object.fromEntries(SWITCHES.map((k, i) => [k, !!(bits & (1 << i))]))
);
const see = (overrides = {}) => ({ ...DEFAULT_PARENTS_SEE, ...overrides });

const PLAN = () => ({
  format: { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 },
  subTimes: [10, 20, 30],
  assignments: [{ GK: "p1", DEF1: "p2" }, { GK: "p1", DEF1: "p3" }],
  overrides: { p3: true },
  timer: { startedAt: 1_757_000_000_000, elapsed: 0 },
  hintSeen: true,
  updatedAt: 1_757_000_000_000
});
const RECORD = () => ({
  savedAt: 1_757_100_000_000,
  savedBy: "coach@a.com",
  auto: false,
  scoreUs: 2,
  scoreThem: 1,
  shapes: ["2-3-1", "3-2-1"],
  theirShapes: ["3-3"],
  blocks: [{ start: 0, end: 10, assignments: { GK: "p1" } }],
  minutes: [{ pid: "p1", min: 30 }, { pid: "p2", min: 25 }, { pid: "p3", min: 15 }],
  matchLog: [{ at: 5, text: "Goal for us" }],
  oppNote: "They press high from kick-off",
  snapshot: { players: [{ id: "p1", name: "Sam" }] }
});
const COACH_ONLY_RECORD_KEYS = ["savedAt", "savedBy", "auto", "scoreUs", "scoreThem", "shapes", "theirShapes", "blocks", "matchLog", "oppNote", "snapshot"];

const doc = (parentsSee = {}) => ({
  team: {
    name: "Under 8 Reds",
    coachPin: "4321",
    parentsSee,
    matchFormat: { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 },
    rules: [{ id: "bi-period", text: "Everyone available plays in both halves", builtin: true }]
  },
  players: [
    { id: "p1", name: "Sam", number: 4, coach: { ratings: { GK: 3, DEF: 4, MID: 2, FWD: 0 }, note: "Left foot only" } },
    { id: "p2", name: "Ava", number: 7, coach: { ratings: { GK: null, DEF: 2, MID: 5, FWD: 4 }, note: "" } },
    { id: "p3", name: "Leo", number: 9 }
  ],
  fixtures: [
    { id: "f-today", dateISO: TODAY, opponent: "Blues", us: 2, them: 1, gk: "p1", availability: { p2: { status: "in", by: "mum@a.com", at: 1 } }, plan: PLAN(), record: RECORD() },
    { id: "f-other", dateISO: OTHER, opponent: "Greens", plan: PLAN(), record: RECORD() },
    { id: "f-bare", dateISO: OTHER, opponent: "Yellows" }
  ],
  sessions: [{ id: "s1", kind: "training", weekday: 2, time: "16:30" }]
});

const byId = (out, id) => out.fixtures.find((f) => f.id === id);
const redact = (data, role, extra = {}) => redactForViewer(data, { role, playerIds: ["p1"], todayISO: TODAY, ...extra });

describe("brisbaneTodayISO", () => {
  it("shifts a UTC timestamp to Brisbane's calendar (UTC+10, no daylight saving)", () => {
    // 15:30Z on the 5th is 01:30 on the 6th in Brisbane.
    expect(brisbaneTodayISO(Date.parse("2026-09-05T15:30:00Z"))).toBe("2026-09-06");
    // 13:59Z on the 5th is still 23:59 on the 5th.
    expect(brisbaneTodayISO(Date.parse("2026-09-05T13:59:00Z"))).toBe("2026-09-05");
    // Exactly 14:00Z rolls over.
    expect(brisbaneTodayISO(Date.parse("2026-09-05T14:00:00Z"))).toBe("2026-09-06");
  });

  it("zero-pads month and day and crosses a year boundary", () => {
    expect(brisbaneTodayISO(Date.parse("2026-01-05T01:00:00Z"))).toBe("2026-01-05");
    expect(brisbaneTodayISO(Date.parse("2025-12-31T14:30:00Z"))).toBe("2026-01-01");
  });

  it("accepts a Date or ISO string and defaults to now", () => {
    expect(brisbaneTodayISO(new Date("2026-09-05T15:30:00Z"))).toBe("2026-09-06");
    expect(brisbaneTodayISO("2026-09-05T15:30:00Z")).toBe("2026-09-06");
    expect(brisbaneTodayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isCoachRole", () => {
  it("is true for coach and admin only", () => {
    expect(isCoachRole("coach")).toBe(true);
    expect(isCoachRole("admin")).toBe(true);
    expect(isCoachRole("parent")).toBe(false);
    expect(isCoachRole("viewer")).toBe(false);
    expect(isCoachRole(undefined)).toBe(false);
    expect(isCoachRole("")).toBe(false);
  });
});

describe("redactForViewer — coach and admin", () => {
  it.each(["coach", "admin"])("hands %s the document untouched", (role) => {
    const data = doc(see({ planBeforeKickoff: false, liveLineup: false }));
    const out = redactForViewer(data, { role, playerIds: [], todayISO: TODAY });
    expect(out).toBe(data);
    expect(out.team.rules).toHaveLength(1);
    expect(out.players[0].coach.note).toBe("Left foot only");
    expect(byId(out, "f-other").plan.overrides).toEqual({ p3: true });
    expect(byId(out, "f-other").record.snapshot).toBeDefined();
  });
});

describe("redactForViewer — null and sparse input", () => {
  it("returns null and undefined unchanged", () => {
    expect(redactForViewer(null, { role: "parent" })).toBeNull();
    expect(redactForViewer(undefined, { role: "parent" })).toBeUndefined();
    expect(redactForViewer(null, { role: "coach" })).toBeNull();
  });

  it.each(NON_COACH)("adds no keys to an empty document for a %s", (role) => {
    const out = redact({}, role);
    expect(out).toEqual({});
    expect(Object.keys(out)).toEqual([]);
  });

  it.each(NON_COACH)("adds no players/fixtures/team keys that were absent for a %s", (role) => {
    expect(Object.keys(redact({ team: { name: "A" } }, role))).toEqual(["team"]);
    expect(Object.keys(redact({ players: [{ id: "p1", name: "Sam" }] }, role))).toEqual(["players"]);
    expect(Object.keys(redact({ fixtures: [{ id: "f1" }] }, role))).toEqual(["fixtures"]);
  });

  it.each(NON_COACH)("does not add plan or record to a fixture that had neither for a %s", (role) => {
    const out = redact(doc(see({ planBeforeKickoff: true, everyoneMinutes: true })), role);
    const bare = byId(out, "f-bare");
    expect("plan" in bare).toBe(false);
    expect("record" in bare).toBe(false);
    expect(bare).toEqual({ id: "f-bare", dateISO: OTHER, opponent: "Yellows" });
  });

  it("reads defaults when the team has no parentsSee at all", () => {
    const data = { team: { name: "A" }, fixtures: [{ id: "f1", dateISO: TODAY, plan: PLAN(), record: RECORD() }, { id: "f2", dateISO: OTHER, plan: PLAN(), record: RECORD() }] };
    const out = redact(data, "parent");
    // Defaults: no plan before kick-off, live lineup on, no minutes.
    expect(byId(out, "f1").plan).toBeDefined();
    expect("plan" in byId(out, "f2")).toBe(false);
    expect("record" in byId(out, "f1")).toBe(false);
  });

  it("tolerates a team document with no team object", () => {
    const out = redact({ players: [{ id: "p1", coach: { ratings: {}, note: "x" } }] }, "parent");
    expect(out.players[0]).toEqual({ id: "p1" });
  });

  it("copes with null plan, null record, and a record without minutes", () => {
    const data = { team: { parentsSee: see({ planBeforeKickoff: true, everyoneMinutes: true }) }, fixtures: [{ id: "f1", plan: null, record: null }, { id: "f2", record: { savedAt: 1, oppNote: "x" } }] };
    const out = redact(data, "parent");
    expect(byId(out, "f1").plan).toBeNull();
    expect(byId(out, "f1").record).toEqual({ minutes: [] });
    expect(byId(out, "f2").record).toEqual({ minutes: [] });
  });

  it("leaves non-object entries in players and fixtures alone", () => {
    const out = redact({ players: [null, "junk"], fixtures: [null, 3] }, "parent");
    expect(out.players).toEqual([null, "junk"]);
    expect(out.fixtures).toEqual([null, 3]);
  });
});

describe("redactForViewer — never mutates its input", () => {
  it.each(NON_COACH)("leaves the source document byte-for-byte intact for a %s", (role) => {
    const data = doc(see({ ownChildMinutes: true }));
    const before = structuredClone(data);
    const out = redact(data, role);
    expect(data).toEqual(before);
    expect(out).not.toBe(data);
    expect(out.team).not.toBe(data.team);
    expect(out.players).not.toBe(data.players);
    expect(out.fixtures).not.toBe(data.fixtures);
    // The parts that survive are shared by reference (no needless deep copy),
    // but the parent-facing plan/record are new objects.
    expect(byId(out, "f-today").plan).not.toBe(data.fixtures[0].plan);
    expect(byId(out, "f-today").record).not.toBe(data.fixtures[0].record);
  });
});

describe("redactForViewer — coach-only fields", () => {
  it.each(NON_COACH)("drops team.rules, team.coachPin and every players[].coach for a %s, keeping the rest", (role) => {
    const out = redact(doc(see()), role);
    expect("rules" in out.team).toBe(false);
    expect("coachPin" in out.team).toBe(false);
    expect(out.team.name).toBe("Under 8 Reds");
    expect(out.team.matchFormat.formation).toBe("2-3-1");
    expect(out.team.parentsSee).toEqual(see());
    for (const p of out.players) expect("coach" in p).toBe(false);
    expect(out.players.map((p) => p.name)).toEqual(["Sam", "Ava", "Leo"]);
    expect(out.players[0].number).toBe(4);
    expect(out.sessions).toEqual(doc().sessions);
  });

  it.each(NON_COACH)("keeps the fixture's own fields (score, keeper duty, RSVPs) for a %s", (role) => {
    const f = byId(redact(doc(see()), role), "f-today");
    expect(f).toMatchObject({ id: "f-today", dateISO: TODAY, opponent: "Blues", us: 2, them: 1, gk: "p1" });
    expect(f.availability).toEqual({ p2: { status: "in", by: "mum@a.com", at: 1 } });
  });
});

describe("redactForViewer — other families' contact details", () => {
  const contacts = (n) => ({
    guardians: [{ name: n + " Snr", mobile: "0400 000 00" + n.length, email: n.toLowerCase() + "@fam.com" }],
    parentName: n + " Snr", parentContact: "0400 000 00" + n.length, parentEmails: [n.toLowerCase() + "@fam.com"], pin: "1234"
  });
  const family = () => ({
    team: { name: "Under 8 Reds" },
    players: [
      { id: "p1", name: "Sam", number: 4, ...contacts("Sam") },
      { id: "p2", name: "Ava", number: 7, ...contacts("Ava") },
      { id: "p3", name: "Leo", number: 9 } // no contacts recorded at all
    ],
    fixtures: []
  });
  const CONTACT_KEYS = ["guardians", "parentName", "parentContact", "parentEmails", "pin"];

  it.each(NON_COACH)("a %s keeps their own children's contacts and PIN but nobody else's", (role) => {
    const out = redactForViewer(family(), { role, playerIds: ["p1"], todayISO: TODAY });
    const [sam, ava, leo] = out.players;
    expect(sam).toMatchObject(contacts("Sam"));
    for (const k of CONTACT_KEYS) expect(k in ava).toBe(false);
    expect(ava).toEqual({ id: "p2", name: "Ava", number: 7 });
    expect(leo).toEqual({ id: "p3", name: "Leo", number: 9 }); // no keys invented
  });

  it("a viewer with no children on the team gets no contacts at all", () => {
    const out = redactForViewer(family(), { role: "viewer", playerIds: [], todayISO: TODAY });
    for (const p of out.players) for (const k of CONTACT_KEYS) expect(k in p).toBe(false);
    expect(out.players.map((p) => p.name)).toEqual(["Sam", "Ava", "Leo"]);
  });

  it("a coach still gets every family's contacts", () => {
    const src = family();
    expect(redactForViewer(src, { role: "coach", playerIds: [], todayISO: TODAY })).toBe(src);
  });

  it("does not mutate the stored players while trimming contacts", () => {
    const src = family();
    const snapshot = JSON.parse(JSON.stringify(src));
    redactForViewer(src, { role: "parent", playerIds: ["p2"], todayISO: TODAY });
    expect(src).toEqual(snapshot);
  });
});

describe("redactForViewer — the plan", () => {
  describe.each(NON_COACH)("as a %s", (role) => {
    it("with defaults, shows today's lineup only, without coach working state", () => {
      const out = redact(doc(see()), role);
      const today = byId(out, "f-today").plan;
      expect(today).toBeDefined();
      expect("overrides" in today).toBe(false);
      expect("hintSeen" in today).toBe(false);
      expect(today.assignments).toEqual(PLAN().assignments);
      expect(today.subTimes).toEqual([10, 20, 30]);
      expect(today.timer).toEqual(PLAN().timer);
      expect(today.format).toEqual(PLAN().format);
      expect(today.updatedAt).toBe(PLAN().updatedAt);
      expect("plan" in byId(out, "f-other")).toBe(false);
    });

    it("with planBeforeKickoff, shows every plan in full (overrides and hintSeen included)", () => {
      const out = redact(doc(see({ planBeforeKickoff: true })), role);
      expect(byId(out, "f-today").plan).toEqual(PLAN());
      expect(byId(out, "f-other").plan).toEqual(PLAN());
    });

    it("with planBeforeKickoff but liveLineup off, still shows every plan in full", () => {
      const out = redact(doc(see({ planBeforeKickoff: true, liveLineup: false })), role);
      expect(byId(out, "f-today").plan).toEqual(PLAN());
      expect(byId(out, "f-other").plan).toEqual(PLAN());
    });

    it("with liveLineup off and no planBeforeKickoff, shows no plan even on game day", () => {
      const out = redact(doc(see({ liveLineup: false })), role);
      expect("plan" in byId(out, "f-today")).toBe(false);
      expect("plan" in byId(out, "f-other")).toBe(false);
    });

    it("the live rule needs a todayISO — without one nothing is live", () => {
      const out = redactForViewer(doc(see()), { role, playerIds: ["p1"] });
      expect("plan" in byId(out, "f-today")).toBe(false);
    });

    it("the live rule is judged on the supplied date, not the fixture order", () => {
      const out = redact(doc(see()), role, { todayISO: OTHER });
      expect("plan" in byId(out, "f-today")).toBe(false);
      expect(byId(out, "f-other").plan).toBeDefined();
      expect("overrides" in byId(out, "f-other").plan).toBe(false);
    });

    it("with liveScore off, the live lineup comes without the match clock (plan.timer)", () => {
      const off = redact(doc(see({ liveScore: false })), role);
      const today = byId(off, "f-today").plan;
      expect(today).toBeDefined();
      expect("timer" in today).toBe(false);
      expect("overrides" in today).toBe(false);
      expect(today.assignments).toEqual(PLAN().assignments);
      expect(today.subTimes).toEqual([10, 20, 30]);
      expect(today.format).toEqual(PLAN().format);
    });

    it("with liveScore off, a plan published before kick-off also loses the clock but keeps its working state", () => {
      const off = redact(doc(see({ liveScore: false, planBeforeKickoff: true })), role);
      for (const id of ["f-today", "f-other"]) {
        const { timer, ...rest } = PLAN();
        expect(byId(off, id).plan).toEqual(rest);
      }
    });

    it("with liveScore on (the default), the clock rides along with the plan", () => {
      const on = redact(doc(see({ liveScore: true })), role);
      expect(byId(on, "f-today").plan.timer).toEqual(PLAN().timer);
      const pub = redact(doc(see({ liveScore: true, planBeforeKickoff: true })), role);
      expect(byId(pub, "f-other").plan.timer).toEqual(PLAN().timer);
    });

    it("liveScore never touches the fixture's own recorded score or a plan that had no timer", () => {
      const off = redact(doc(see({ liveScore: false })), role);
      expect(byId(off, "f-today")).toMatchObject({ us: 2, them: 1 });
      const { timer, ...noClock } = PLAN();
      const data = { team: { parentsSee: see({ liveScore: false, planBeforeKickoff: true }) }, fixtures: [{ id: "f1", plan: noClock }] };
      const out = redact(data, role);
      expect(byId(out, "f1").plan).toEqual(noClock);
      expect("timer" in byId(out, "f1").plan).toBe(false);
    });

    it("dropping the clock does not mutate the stored plan", () => {
      const data = doc(see({ liveScore: false }));
      const before = structuredClone(data);
      redact(data, role);
      expect(data).toEqual(before);
    });
  });
});

describe("redactForViewer — the match record", () => {
  describe.each(NON_COACH)("as a %s", (role) => {
    it("with both minutes switches off, drops the record entirely", () => {
      const out = redact(doc(see()), role);
      expect("record" in byId(out, "f-today")).toBe(false);
      expect("record" in byId(out, "f-other")).toBe(false);
    });

    it("with everyoneMinutes, keeps exactly { minutes } for the whole team", () => {
      const out = redact(doc(see({ everyoneMinutes: true })), role);
      for (const id of ["f-today", "f-other"]) {
        expect(byId(out, id).record).toEqual({ minutes: RECORD().minutes });
        expect(Object.keys(byId(out, id).record)).toEqual(["minutes"]);
      }
    });

    it("with everyoneMinutes, beats ownChildMinutes when both are on", () => {
      const out = redact(doc(see({ everyoneMinutes: true, ownChildMinutes: true })), role);
      expect(byId(out, "f-today").record).toEqual({ minutes: RECORD().minutes });
    });

    it("with ownChildMinutes, keeps only the viewer's own children's minutes", () => {
      const out = redact(doc(see({ ownChildMinutes: true })), role);
      expect(byId(out, "f-today").record).toEqual({ minutes: [{ pid: "p1", min: 30 }] });
      expect(byId(out, "f-other").record).toEqual({ minutes: [{ pid: "p1", min: 30 }] });
    });

    it("with ownChildMinutes, covers several children", () => {
      const out = redact(doc(see({ ownChildMinutes: true })), role, { playerIds: ["p1", "p3"] });
      expect(byId(out, "f-today").record).toEqual({ minutes: [{ pid: "p1", min: 30 }, { pid: "p3", min: 15 }] });
    });

    it("with ownChildMinutes, another child's minutes are not shown", () => {
      const out = redact(doc(see({ ownChildMinutes: true })), role, { playerIds: ["p9"] });
      expect(byId(out, "f-today").record).toEqual({ minutes: [] });
    });

    it("with ownChildMinutes and no children on the team, shows an empty minutes list", () => {
      const out = redact(doc(see({ ownChildMinutes: true })), role, { playerIds: [] });
      expect(byId(out, "f-today").record).toEqual({ minutes: [] });
      const noIds = redactForViewer(doc(see({ ownChildMinutes: true })), { role, todayISO: TODAY });
      expect(byId(noIds, "f-today").record).toEqual({ minutes: [] });
    });
  });
});

describe("redactForViewer — the full matrix (every switch combination x role)", () => {
  const cases = NON_COACH.flatMap((role) => ALL_COMBOS.map((combo) => [role, combo]));

  it.each(cases)("%s with %j never receives coach-only material", (role, combo) => {
    const data = doc(combo);
    const before = structuredClone(data);
    const out = redactForViewer(data, { role, playerIds: ["p1"], todayISO: TODAY });

    expect(data).toEqual(before);
    expect("rules" in out.team).toBe(false);
    expect("coachPin" in out.team).toBe(false);
    for (const p of out.players) expect("coach" in p).toBe(false);

    for (const f of out.fixtures) {
      const source = before.fixtures.find((x) => x.id === f.id);
      const minutesOn = combo.everyoneMinutes || combo.ownChildMinutes;
      const live = f.dateISO === TODAY && combo.liveLineup;

      if ("record" in f) {
        expect(Object.keys(f.record)).toEqual(["minutes"]);
        for (const k of COACH_ONLY_RECORD_KEYS) expect(k in f.record).toBe(false);
        // Only ever there because the source had one AND a minutes switch is on.
        expect("record" in source).toBe(true);
        expect(minutesOn).toBe(true);
        if (!combo.everyoneMinutes) {
          expect(f.record.minutes.every((m) => m.pid === "p1")).toBe(true);
        }
      } else {
        // Absent either because the source had none, or the switches hid it.
        expect(!("record" in source) || !minutesOn).toBe(true);
      }

      if ("plan" in f) {
        expect("plan" in source).toBe(true);
        expect(combo.planBeforeKickoff || live).toBe(true);
        // The clock is there exactly when the live-score switch is on.
        expect("timer" in f.plan).toBe(combo.liveScore);
        const { timer, ...noClock } = PLAN();
        const expected = combo.liveScore ? PLAN() : noClock;
        if (!combo.planBeforeKickoff) {
          expect("overrides" in f.plan).toBe(false);
          expect("hintSeen" in f.plan).toBe(false);
          const { overrides, hintSeen, ...liveExpected } = expected;
          expect(f.plan).toEqual(liveExpected);
        } else {
          expect(f.plan).toEqual(expected);
        }
      } else {
        // Absent either because the source had none, or the switches hid it.
        expect(!("plan" in source) || !(combo.planBeforeKickoff || live)).toBe(true);
      }
    }
  });

  it.each(ALL_COMBOS)("coach with %j receives everything regardless", (combo) => {
    const data = doc(combo);
    expect(redactForViewer(data, { role: "coach", playerIds: [], todayISO: TODAY })).toBe(data);
  });
});
