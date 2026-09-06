import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEATURES, teamFeatures, sanitizeFeatures, sanitizeTrainingSessions, sanitizeStaff, sanitizeLogo,
  DEFAULT_PARENTS_SEE, PARENTS_SEE_LABELS, PARENTS_SEE_GROUPS, teamParentsSee, sanitizeParentsSee,
  BUILTIN_RULES, DEFAULT_RULES, teamRules, sanitizeRules,
  sanitizeCoachFields, formationFits, sanitizeMatchFormat
} from "@/lib/teamSetup";
import { defaultFormatForAgeGroup } from "@/lib/planner";

describe("teamFeatures", () => {
  it("falls back to the pre-flag behaviour: fruit/gk/focus on, jersey off", () => {
    expect(teamFeatures(undefined)).toEqual({ fruitDuty: true, jerseyDuty: false, gkDuty: true, focus: true });
    expect(teamFeatures({})).toEqual(DEFAULT_FEATURES);
  });

  it("merges saved flags over the defaults", () => {
    expect(teamFeatures({ features: { jerseyDuty: true, focus: false } }))
      .toEqual({ fruitDuty: true, jerseyDuty: true, gkDuty: true, focus: false });
  });
});

describe("sanitizeFeatures", () => {
  it("coerces to booleans and drops unknown keys", () => {
    const out = sanitizeFeatures({ fruitDuty: 0, jerseyDuty: "yes", hack: true });
    expect(out).toEqual({ fruitDuty: false, jerseyDuty: true, gkDuty: true, focus: true });
    expect(out).not.toHaveProperty("hack");
  });

  it("returns defaults for junk input", () => {
    expect(sanitizeFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(sanitizeFeatures("junk")).toEqual(DEFAULT_FEATURES);
  });
});

describe("sanitizeStaff", () => {
  it("keeps named rows with cleaned mobiles/emails, drops the rest", () => {
    const out = sanitizeStaff([
      { role: "Head coach", name: " Byron ", mobile: "0400 111 222", email: "Byron@Club.com" },
      { role: "Manager", name: "", mobile: "0400" },
      { name: "NoRole", email: "not-an-email" },
      null
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com", photo: "" });
    expect(out[1]).toMatchObject({ role: "Coach", name: "NoRole", email: "" });
    expect(sanitizeStaff("junk")).toEqual([]);
  });
});

describe("sanitizeLogo", () => {
  it("accepts only reasonably-sized image data URLs", () => {
    expect(sanitizeLogo("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(sanitizeLogo("https://evil.example/logo.png")).toBe("");
    expect(sanitizeLogo("data:text/html;base64,AAA")).toBe("");
    expect(sanitizeLogo("data:image/png;base64," + "A".repeat(400000))).toBe("");
  });
});

describe("sanitizeTrainingSessions", () => {
  it("builds weekly dashboard sessions from wizard rows", () => {
    const out = sanitizeTrainingSessions([
      { weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park" },
      { weekday: "4", time: "16:30", location: "" }
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "Training", kind: "training", recur: "weekly", weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park" });
    expect(out[0].id).toBeTruthy();
    expect(out[1]).toMatchObject({ weekday: 4, time: "16:30" });
    expect(out[1]).not.toHaveProperty("endTime"); // omitted, dashboard defaults apply
  });

  it("drops rows with bad weekdays or times, keeps custom titles, caps the list", () => {
    const out = sanitizeTrainingSessions([
      { weekday: 7, time: "17:00" },          // bad weekday
      { weekday: 2, time: "25:99" },           // bad time
      { weekday: 2, time: "17:00", title: "Goalkeeper clinic" },
      null
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Goalkeeper clinic");
    expect(sanitizeTrainingSessions(Array.from({ length: 20 }, () => ({ weekday: 2, time: "17:00" })))).toHaveLength(7);
    expect(sanitizeTrainingSessions("junk")).toEqual([]);
  });
});

describe("parents see", () => {
  it("defaults: live score and lineup on, plan and minutes off", () => {
    expect(DEFAULT_PARENTS_SEE).toEqual({ planBeforeKickoff: false, liveScore: true, liveLineup: true, ownChildMinutes: false, everyoneMinutes: false });
    expect(teamParentsSee(undefined)).toEqual(DEFAULT_PARENTS_SEE);
    expect(teamParentsSee({})).toEqual(DEFAULT_PARENTS_SEE);
  });

  it("merges saved flags over the defaults", () => {
    expect(teamParentsSee({ parentsSee: { planBeforeKickoff: true, liveScore: false } }))
      .toEqual({ planBeforeKickoff: true, liveScore: false, liveLineup: true, ownChildMinutes: false, everyoneMinutes: false });
  });

  it("has a sentence-case label for every key, grouped in game order", () => {
    expect(Object.keys(PARENTS_SEE_LABELS).sort()).toEqual(Object.keys(DEFAULT_PARENTS_SEE).sort());
    expect(PARENTS_SEE_LABELS.planBeforeKickoff).toBe("Lineup and sub plan before kick-off");
    expect(PARENTS_SEE_LABELS.everyoneMinutes).toBe("Everyone's minutes after the game");
    expect(PARENTS_SEE_GROUPS.map((g) => g.title)).toEqual(["Before kick-off", "During the game", "After the game"]);
    expect(PARENTS_SEE_GROUPS.flatMap((g) => g.keys).sort()).toEqual(Object.keys(DEFAULT_PARENTS_SEE).sort());
  });

  it("sanitizeParentsSee coerces to booleans and drops unknown keys", () => {
    const out = sanitizeParentsSee({ planBeforeKickoff: 1, liveScore: "", ownChildMinutes: "yes", hack: true });
    expect(out).toEqual({ planBeforeKickoff: true, liveScore: false, liveLineup: true, ownChildMinutes: true, everyoneMinutes: false });
    expect(out).not.toHaveProperty("hack");
  });

  it("sanitizeParentsSee returns defaults for junk input", () => {
    expect(sanitizeParentsSee(null)).toEqual(DEFAULT_PARENTS_SEE);
    expect(sanitizeParentsSee("junk")).toEqual(DEFAULT_PARENTS_SEE);
    expect(sanitizeParentsSee([])).toEqual(DEFAULT_PARENTS_SEE);
  });
});

describe("rules", () => {
  const custom = (id, text, extra = {}) => ({ id, text, builtin: false, ...extra });

  it("BUILTIN_RULES covers all six ids; DEFAULT_RULES seeds three of them in priority order", () => {
    expect(Object.keys(BUILTIN_RULES)).toEqual(["bi-period", "bi-gk-break", "bi-rating-zero", "bi-weak-wide", "bi-no-double-bench", "bi-sticky-positions"]);
    expect(DEFAULT_RULES).toEqual([
      { id: "bi-period", text: "Everyone available plays in both halves", builtin: true },
      { id: "bi-gk-break", text: "Keeper changes only at the break", builtin: true },
      { id: "bi-rating-zero", text: "Nobody plays a spot they're rated 0 in", builtin: true }
    ]);
  });

  it("teamRules returns the team's own list, else a fresh copy of the defaults", () => {
    const own = [custom("r_a", "Twins never on together")];
    expect(teamRules({ rules: own })).toBe(own);
    const fallback = teamRules({ rules: [] });
    expect(fallback).toEqual(DEFAULT_RULES);
    expect(fallback).not.toBe(DEFAULT_RULES);
    expect(fallback[0]).not.toBe(DEFAULT_RULES[0]);
    expect(teamRules(undefined)).toEqual(DEFAULT_RULES);
    expect(teamRules({ rules: "junk" })).toEqual(DEFAULT_RULES);
  });

  it("sanitizeRules returns a fresh copy of the defaults for non-array input", () => {
    const out = sanitizeRules(null);
    expect(out).toEqual(DEFAULT_RULES);
    expect(out).not.toBe(DEFAULT_RULES);
    expect(sanitizeRules({ id: "bi-period" })).toEqual(DEFAULT_RULES);
  });

  it("keeps order and forces built-in text and flag", () => {
    const out = sanitizeRules([
      custom("r_a", "Twins never on together"),
      { id: "bi-gk-break", text: "hacked text", builtin: false },
      { id: "bi-period" },
      { id: "bi-rating-zero", text: "x", builtin: "no" }
    ]);
    expect(out.map((r) => r.id)).toEqual(["r_a", "bi-gk-break", "bi-period", "bi-rating-zero"]);
    expect(out[1]).toEqual({ id: "bi-gk-break", text: "Keeper changes only at the break", builtin: true });
    expect(out[2]).toEqual({ id: "bi-period", text: "Everyone available plays in both halves", builtin: true });
    expect(out[3]).toEqual({ id: "bi-rating-zero", text: "Nobody plays a spot they're rated 0 in", builtin: true });
  });

  it("keeps a built-in's off flag, and omits the key when it is on", () => {
    const out = sanitizeRules([{ id: "bi-period", off: true }, { id: "bi-gk-break", off: false }, { id: "bi-rating-zero", off: 0 }, { id: "bi-weak-wide", off: 1 }]);
    expect(out[0]).toEqual({ id: "bi-period", text: BUILTIN_RULES["bi-period"], builtin: true, off: true });
    expect(out[1]).not.toHaveProperty("off");
    expect(out[2]).not.toHaveProperty("off");
    expect(out[3]).toEqual({ id: "bi-weak-wide", text: BUILTIN_RULES["bi-weak-wide"], builtin: true, off: true });
  });

  it("keeps a valid custom id, generates one otherwise", () => {
    const out = sanitizeRules([
      ...DEFAULT_RULES,
      custom("r_abc123", "Keep 1"),
      custom("Twins-Rule_1", "Keep 2"),
      { text: "No id" },
      custom("has spaces", "Bad id"),
      custom("x".repeat(25), "Too long"),
      custom(42, "Not a string")
    ]);
    const customs = out.filter((r) => !r.builtin);
    expect(customs.map((r) => r.text)).toEqual(["Keep 1", "Keep 2", "No id", "Bad id", "Too long", "Not a string"]);
    expect(customs[0].id).toBe("r_abc123");
    expect(customs[1].id).toBe("Twins-Rule_1");
    for (const r of customs.slice(2)) {
      expect(r.id).toMatch(/^r_[a-z0-9]+$/);
      expect(r.builtin).toBe(false);
    }
    const ids = out.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a custom rule can't hijack a built-in id", () => {
    const out = sanitizeRules([...DEFAULT_RULES, { id: "bi-weak-wide", text: "my own text", builtin: false }]);
    expect(out[3]).toEqual({ id: "bi-weak-wide", text: BUILTIN_RULES["bi-weak-wide"], builtin: true });
  });

  it("trims and caps custom text at 160 chars, drops empty text", () => {
    const long = "a".repeat(200);
    const out = sanitizeRules([...DEFAULT_RULES, custom("r_1", "  spaced out  "), custom("r_2", long), custom("r_3", "   "), custom("r_4", ""), { id: "r_5" }, custom("r_6", 123)]);
    const customs = out.filter((r) => !r.builtin);
    expect(customs.map((r) => r.id)).toEqual(["r_1", "r_2", "r_6"]);
    expect(customs[0].text).toBe("spaced out");
    expect(customs[1].text).toHaveLength(160);
    expect(customs[2].text).toBe("123");
  });

  it("keeps createdAt only when it is a finite number, keeps off when truthy", () => {
    const out = sanitizeRules([...DEFAULT_RULES,
      custom("r_1", "A", { createdAt: 1700000000000, off: true }),
      custom("r_2", "B", { createdAt: "yesterday", off: false }),
      custom("r_3", "C", { createdAt: NaN, off: 0 })
    ]);
    const customs = out.filter((r) => !r.builtin);
    expect(customs[0]).toEqual({ id: "r_1", text: "A", builtin: false, createdAt: 1700000000000, off: true });
    expect(customs[1]).toEqual({ id: "r_2", text: "B", builtin: false });
    expect(customs[2]).toEqual({ id: "r_3", text: "C", builtin: false });
  });

  it("drops duplicate ids, first wins", () => {
    const out = sanitizeRules([...DEFAULT_RULES, custom("r_1", "First"), custom("r_1", "Second"), { id: "bi-period", off: true }]);
    expect(out.map((r) => r.id)).toEqual(["bi-period", "bi-gk-break", "bi-rating-zero", "r_1"]);
    expect(out[0]).not.toHaveProperty("off");
    expect(out[3].text).toBe("First");
  });

  it("drops junk entries and ignores builtin:true on unknown ids", () => {
    const out = sanitizeRules([...DEFAULT_RULES, null, "string", 7, { id: "r_1", text: "Real", builtin: true }]);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual({ id: "r_1", text: "Real", builtin: false });
  });

  it("an inherited object key is not a built-in id", () => {
    const out = sanitizeRules([...DEFAULT_RULES, { id: "toString", text: "Sneaky" }, { id: "constructor" }]);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual({ id: "toString", text: "Sneaky", builtin: false });
  });

  it("caps the list at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => custom("r_" + i, "Rule " + i));
    const out = sanitizeRules([...DEFAULT_RULES, ...many]);
    expect(out).toHaveLength(20);
    expect(out.slice(0, 3)).toEqual(DEFAULT_RULES);
    expect(out[19].id).toBe("r_16");
    // Even with only custom rules, the seeded built-ins fit inside the cap.
    const onlyCustom = sanitizeRules(many);
    expect(onlyCustom).toHaveLength(20);
    expect(onlyCustom.slice(-3).map((r) => r.id)).toEqual(["bi-period", "bi-gk-break", "bi-rating-zero"]);
    expect(onlyCustom.slice(0, 17).map((r) => r.id)).toEqual(many.slice(0, 17).map((r) => r.id));
  });

  it("keeps a built-in's off switch even when it is ranked past the cap", () => {
    // 18 custom rules ahead of the built-ins: the cap must not drop the coach's
    // "off" on bi-rating-zero (ranked 21st) and silently re-add it switched on.
    const many = Array.from({ length: 18 }, (_, i) => custom("r_" + i, "Rule " + i));
    const out = sanitizeRules([...many, { id: "bi-period" }, { id: "bi-gk-break" }, { id: "bi-rating-zero", off: true }]);
    expect(out).toHaveLength(20);
    const rz = out.find((r) => r.id === "bi-rating-zero");
    expect(rz).toEqual({ id: "bi-rating-zero", text: BUILTIN_RULES["bi-rating-zero"], builtin: true, off: true });
    // The lowest-priority custom rule made room, not a built-in.
    expect(out.filter((r) => !r.builtin)).toHaveLength(17);
    expect(out.map((r) => r.id)).not.toContain("r_17");
  });

  it("re-appends missing seeded built-ins at the end, switched on", () => {
    const out = sanitizeRules([{ id: "bi-gk-break", off: true }, custom("r_1", "Mine")]);
    expect(out.map((r) => r.id)).toEqual(["bi-gk-break", "r_1", "bi-period", "bi-rating-zero"]);
    expect(out[0].off).toBe(true);
    expect(out[2]).toEqual({ id: "bi-period", text: BUILTIN_RULES["bi-period"], builtin: true });
    expect(out[3]).toEqual({ id: "bi-rating-zero", text: BUILTIN_RULES["bi-rating-zero"], builtin: true });
    expect(sanitizeRules([])).toEqual(DEFAULT_RULES);
    // Optional built-ins (not seeded) are not forced back in.
    expect(sanitizeRules(DEFAULT_RULES).map((r) => r.id)).not.toContain("bi-weak-wide");
  });
});

describe("sanitizeCoachFields", () => {
  const EMPTY = { ratings: { GK: null, DEF: null, MID: null, FWD: null }, note: "" };

  it("returns empty ratings and note for junk input", () => {
    expect(sanitizeCoachFields(undefined)).toEqual(EMPTY);
    expect(sanitizeCoachFields(null)).toEqual(EMPTY);
    expect(sanitizeCoachFields("junk")).toEqual(EMPTY);
    expect(sanitizeCoachFields({})).toEqual(EMPTY);
    expect(sanitizeCoachFields({ ratings: "junk", note: null })).toEqual(EMPTY);
  });

  it("rounds and clamps ratings to integers 0..5", () => {
    const out = sanitizeCoachFields({ ratings: { GK: 2.4, DEF: 2.5, MID: 9, FWD: -3 } });
    expect(out.ratings).toEqual({ GK: 2, DEF: 3, MID: 5, FWD: 0 });
    expect(sanitizeCoachFields({ ratings: { GK: 0 } }).ratings.GK).toBe(0);
    expect(sanitizeCoachFields({ ratings: { GK: 5 } }).ratings.GK).toBe(5);
  });

  it("turns anything that isn't a finite number into null and drops unknown keys", () => {
    const out = sanitizeCoachFields({ ratings: { GK: null, DEF: undefined, MID: NaN, FWD: "4", CAM: 3 } });
    expect(out.ratings).toEqual({ GK: null, DEF: null, MID: null, FWD: null });
    expect(out.ratings).not.toHaveProperty("CAM");
    expect(sanitizeCoachFields({ ratings: { GK: Infinity, DEF: true } }).ratings).toEqual({ GK: null, DEF: null, MID: null, FWD: null });
  });

  it("trims the note and caps it at 400 chars", () => {
    expect(sanitizeCoachFields({ note: "  Loves the left wing  " }).note).toBe("Loves the left wing");
    expect(sanitizeCoachFields({ note: "x".repeat(500) }).note).toHaveLength(400);
    expect(sanitizeCoachFields({ note: 42 }).note).toBe("42");
    expect(sanitizeCoachFields({ note: undefined }).note).toBe("");
  });
});

describe("formationFits", () => {
  it("accepts shapes that add up to the outfield count within row limits", () => {
    expect(formationFits("2-3-1", 6)).toBe(true);
    expect(formationFits("3-4-1", 8)).toBe(true);
    expect(formationFits("2-3-1", 7)).toBe(false);
    expect(formationFits("", 6)).toBe(false);
    expect(formationFits("7", 7)).toBe(false);          // a row of 7 is too wide
    expect(formationFits("1-1-1-1-1-1", 6)).toBe(false); // six rows is too many
    expect(formationFits("1-1-1-1-2", 6)).toBe(true);
  });
});

describe("sanitizeMatchFormat", () => {
  it("returns the age-group default for junk input", () => {
    expect(sanitizeMatchFormat(undefined, "U7")).toEqual(defaultFormatForAgeGroup("U7"));
    expect(sanitizeMatchFormat(null, "U9")).toEqual({ gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 });
    expect(sanitizeMatchFormat("junk", "U11")).toEqual(defaultFormatForAgeGroup("U11"));
    expect(sanitizeMatchFormat({}, "U11")).toEqual(defaultFormatForAgeGroup("U11"));
  });

  it("keeps a valid format as-is", () => {
    const fmt = { gameLength: 50, periods: 4, playersOnField: 9, hasGK: true, formation: "3-3-2", subInterval: 12 };
    expect(sanitizeMatchFormat(fmt, "U9")).toEqual(fmt);
  });

  it("rounds and clamps the numbers, coerces hasGK, keeps defaults for junk values", () => {
    const out = sanitizeMatchFormat({ gameLength: 500, periods: 0, playersOnField: "9.4", hasGK: 1, subInterval: 1.6 }, "U9");
    expect(out).toMatchObject({ gameLength: 120, periods: 1, playersOnField: 9, hasGK: true, subInterval: 2 });
    expect(sanitizeMatchFormat({ gameLength: 5, periods: 9, playersOnField: 40, subInterval: 99 }, "U9"))
      .toMatchObject({ gameLength: 10, periods: 4, playersOnField: 11, subInterval: 45 });
    expect(sanitizeMatchFormat({ gameLength: "abc", periods: NaN, playersOnField: null, subInterval: {} }, "U9"))
      .toMatchObject({ gameLength: 40, periods: 2, playersOnField: 7, subInterval: 10 });
    expect(sanitizeMatchFormat({ gameLength: true, periods: "", playersOnField: [], subInterval: undefined }, "U9"))
      .toMatchObject({ gameLength: 40, periods: 2, playersOnField: 7, subInterval: 10 });
    expect(sanitizeMatchFormat({ hasGK: 0 }, "U9").hasGK).toBe(false);
  });

  it("keeps a formation that fits the outfield count, trimmed", () => {
    expect(sanitizeMatchFormat({ formation: " 3-2-1 " }, "U9").formation).toBe("3-2-1");
    expect(sanitizeMatchFormat({ formation: "2-1-2-1" }, "U9").formation).toBe("2-1-2-1");
    expect(sanitizeMatchFormat({ playersOnField: 4, hasGK: false, formation: "1-2-1" }, "U7").formation).toBe("1-2-1");
    expect(sanitizeMatchFormat({ formation: "6" }, "U9").formation).toBe("6"); // one row of six is the widest allowed
  });

  it("falls back to the planner's default shape when the formation doesn't fit", () => {
    expect(sanitizeMatchFormat({ formation: "4-4-2" }, "U9").formation).toBe("2-3-1");   // 10 outfield, only 6 on
    expect(sanitizeMatchFormat({ formation: "1-1-1-1-1-1" }, "U9").formation).toBe("2-3-1"); // too many rows
    expect(sanitizeMatchFormat({ formation: "abc" }, "U9").formation).toBe("2-3-1");
    expect(sanitizeMatchFormat({ formation: "" }, "U9").formation).toBe("2-3-1");
    expect(sanitizeMatchFormat({ formation: null }, "U9").formation).toBe("2-3-1");
    expect(sanitizeMatchFormat({ formation: "2-3-1".repeat(10) }, "U9").formation).toBe("2-3-1"); // over 20 chars
  });

  it("re-fits the default formation when the player count or GK changes without one", () => {
    expect(sanitizeMatchFormat({ playersOnField: 9 }, "U9")).toMatchObject({ playersOnField: 9, hasGK: true, formation: "3-3-2" });
    expect(sanitizeMatchFormat({ hasGK: false }, "U9")).toMatchObject({ playersOnField: 7, hasGK: false, formation: "2-3-2" });
    expect(sanitizeMatchFormat({ playersOnField: 11, hasGK: false }, "U11").formation).toBe("4-4-3");
    expect(sanitizeMatchFormat({ playersOnField: 3, hasGK: true }, "U7").formation).toBe("2");
  });
});
