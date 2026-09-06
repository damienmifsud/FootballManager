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
