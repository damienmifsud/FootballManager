import { describe, it, expect } from "vitest";
import { SHAPE_CALLS, shapeCall } from "@/lib/shapes";

describe("SHAPE_CALLS", () => {
  it("names the five calls in sentence case", () => {
    expect(SHAPE_CALLS).toEqual({ DROP_IN: "Drop in", PUSH_UP: "Push up", STEP_UP: "Step up", SIT: "Sit", TUCK_IN: "Tuck in" });
  });
});

describe("shapeCall — three-row shapes", () => {
  it("mid to def is Drop in", () => {
    expect(shapeCall("2-3-1", "3-2-1")).toBe("Drop in");
    expect(shapeCall("3-4-1", "4-3-1")).toBe(SHAPE_CALLS.DROP_IN);
  });

  it("def to mid is Step up", () => {
    expect(shapeCall("3-2-1", "2-3-1")).toBe("Step up");
    expect(shapeCall("4-3-3", "3-4-3")).toBe(SHAPE_CALLS.STEP_UP);
  });

  it("mid to fwd is Push up", () => {
    expect(shapeCall("2-3-1", "2-2-2")).toBe("Push up");
    expect(shapeCall("4-4-2", "4-3-3")).toBe(SHAPE_CALLS.PUSH_UP);
  });

  it("fwd to mid is Sit", () => {
    expect(shapeCall("2-2-2", "2-3-1")).toBe("Sit");
    expect(shapeCall("4-3-3", "4-4-2")).toBe(SHAPE_CALLS.SIT);
  });

  it("a hop straight from def to fwd (or back) has no call", () => {
    expect(shapeCall("3-3-1", "2-3-2")).toBeNull();
    expect(shapeCall("2-3-2", "3-3-1")).toBeNull();
  });
});

describe("shapeCall — two-row shapes", () => {
  it("def to fwd is Push up, fwd to def is Drop in", () => {
    expect(shapeCall("2-2", "1-3")).toBe("Push up");
    expect(shapeCall("3-1", "2-2")).toBe(SHAPE_CALLS.PUSH_UP);
    expect(shapeCall("1-3", "2-2")).toBe("Drop in");
    expect(shapeCall("2-2", "3-1")).toBe(SHAPE_CALLS.DROP_IN);
  });
});

describe("shapeCall — no call", () => {
  it("identical shapes", () => {
    expect(shapeCall("2-3-1", "2-3-1")).toBeNull();
    expect(shapeCall("2-2", "2-2")).toBeNull();
    expect(shapeCall("3", "3")).toBeNull();
  });

  it("different player counts", () => {
    expect(shapeCall("2-3-1", "2-3-2")).toBeNull();
    expect(shapeCall("3-3-2", "3-3-1")).toBeNull();
    expect(shapeCall("2-2", "2-1")).toBeNull();
  });

  it("different row counts, even with the same number of players", () => {
    expect(shapeCall("2-3-1", "2-1-2-1")).toBeNull();
    expect(shapeCall("2-2", "1-2-1")).toBeNull();
    expect(shapeCall("1-2-1", "2-2")).toBeNull();
  });

  it("more than one player moving", () => {
    expect(shapeCall("2-3-1", "4-1-1")).toBeNull();  // two players drop in
    expect(shapeCall("2-3-1", "3-1-2")).toBeNull();  // one drops, one pushes up
    expect(shapeCall("4-4-2", "2-4-4")).toBeNull();
  });

  it("four-row shapes and single-row shapes", () => {
    expect(shapeCall("2-1-2-1", "2-2-1-1")).toBeNull();
    expect(shapeCall("4-2-3-1", "4-3-2-1")).toBeNull();
    expect(shapeCall("3", "4")).toBeNull();
  });

  it("empty or junk formations", () => {
    expect(shapeCall("", "2-3-1")).toBeNull();
    expect(shapeCall("2-3-1", "")).toBeNull();
    expect(shapeCall(undefined, undefined)).toBeNull();
    expect(shapeCall(null, "2-2")).toBeNull();
    expect(shapeCall("abc", "def")).toBeNull();
  });

  it("tolerates other separators the planner accepts", () => {
    expect(shapeCall("2 3 1", "3-2-1")).toBe("Drop in");
    expect(shapeCall("2/3/1", "2/2/2")).toBe("Push up");
  });
});

// The rest of GameDay's shapes.js (slice 3, step 2).
import {
  HOME_SHAPE, COUNTER_POOL, SHAPE_NOTES, SHAPE_COUNTERS, HOME_CALLS, THEIR_TRAITS,
  shapeSum, shapeZones, zoneMatch, zoneWhy, rankCounters, counterFor, shapeNote,
  describeChange, resolveTheirShape, theirLabel
} from "@/lib/shapes";

describe("shape data", () => {
  it("covers 7v7 (6 outfield) and 9v9 (8 outfield), every shape adding up", () => {
    expect(HOME_SHAPE).toEqual({ 6: "2-3-1", 8: "3-2-3" });
    for (const n of [6, 8]) {
      COUNTER_POOL[n].forEach((s) => expect(shapeSum(s)).toBe(n));
      Object.keys(SHAPE_NOTES[n]).forEach((s) => expect(shapeSum(s)).toBe(n));
      Object.values(SHAPE_COUNTERS[n]).forEach((c) => {
        expect(shapeSum(c.attack[0])).toBe(n);
        expect(shapeSum(c.defend[0])).toBe(n);
      });
      Object.keys(HOME_CALLS[n]).forEach((s) => expect(shapeSum(s)).toBe(n));
    }
    THEIR_TRAITS.forEach((t) => { expect(shapeSum(t.shape[6])).toBe(6); expect(shapeSum(t.shape[8])).toBe(8); });
  });
});

describe("zones", () => {
  it("splits a shape into back, middle and front", () => {
    expect(shapeZones("2-1-2-1")).toEqual({ D: 2, M: 3, F: 1 });
    expect(shapeZones("2-2")).toEqual({ D: 2, M: 0, F: 2 });
    expect(shapeZones("4")).toEqual({ D: 0, M: 4, F: 0 });
    expect(shapeZones("")).toBeNull();
  });

  it("compares our backs with their forwards, middles, our forwards with their backs", () => {
    const z = zoneMatch("3-2-1", "2-2-2");
    expect(z.back).toEqual({ txt: "3v2", d: 1, state: "ok" });
    expect(z.middle).toEqual({ txt: "2v2", d: 0, state: "even" });
    // Up front, one short of their backs is "even" (their spare), two short is a warning.
    expect(z.front).toEqual({ txt: "1v2", d: -1, state: "even" });
    expect(zoneMatch("4-1-1", "2-1-3").front.state).toBe("even");
    expect(zoneMatch("3-2-1", "4-1-1").front.state).toBe("warn");
    expect(zoneWhy(z)).toBe("Spare at the back, even in the middle, they keep a spare at the back.");
  });
});

describe("counters", () => {
  it("uses the curated answer for a known shape", () => {
    const c = counterFor("2-3-1", 6);
    expect(c.attack).toMatchObject({ shape: "2-1-2-1", curated: true });
    expect(c.defend).toMatchObject({ shape: "3-2-1", curated: true });
    expect(c.defend.z.back.state).toBe("ok");
  });

  it("works one out from the zones for any other shape", () => {
    const c = counterFor("1-2-3", 6);
    expect(c.attack.curated).toBe(false);
    expect(shapeSum(c.attack.shape)).toBe(6);
    expect(c.defend.z.back.d).toBeGreaterThanOrEqual(0); // defend keeps the back covered
    expect(c.attack.why).toMatch(/\.$/);
    expect(rankCounters("1-2-3", 6, "defend")[0].shape).toBe(c.defend.shape);
    expect(counterFor("", 6)).toBeNull();
  });
});

describe("notes, calls and their shape", () => {
  it("shapeNote gives the curated note, or a zone summary for a custom shape", () => {
    expect(shapeNote("2-3-1", 6)).toMatchObject({ style: "Balanced", tag: "home shape" });
    expect(shapeNote("1-4-1", 6)).toMatchObject({ style: "Custom", sum: "1 at the back, 4 in the middle, 1 up top." });
  });

  it("describeChange: curated from GameDay's home shape, back home, else the moves with the call name", () => {
    expect(describeChange("2-3-1", "3-2-1", 6)).toBe("Drop in: centre mid between the backs");
    expect(describeChange("3-2-1", "2-3-1", 6)).toBe("Back to the home shape 2-3-1");
    expect(describeChange("3-2-1", "2-2-2", 6, "3-2-1")).toBe("A back pushes up front");
    expect(describeChange("2-2-2", "2-3-1", 6, "3-2-1")).toBe("Sit: a forward drops into midfield");
    // A team whose own home is 3-4-1 still gets the curated wording only from GameDay's home.
    expect(describeChange("3-4-1", "3-3-2", 8, "3-4-1")).toBe("Push up: a midfielder joins the attack");
    expect(describeChange("3-4-1", "3-4-1", 8)).toBe("No change");
  });

  it("resolves 'what you saw' traits to a shape and a label", () => {
    expect(resolveTheirShape("t:3fwd", 6)).toBe("2-1-3");
    expect(resolveTheirShape("t:bus", 8)).toBe("4-3-1");
    expect(resolveTheirShape("3-2-1", 6)).toBe("3-2-1");
    expect(theirLabel("t:2st", 6)).toBe("two strikers");
    expect(theirLabel("3-2-1", 6)).toBe("3-2-1");
    expect(resolveTheirShape("t:nope", 6)).toBe("");
  });
});
