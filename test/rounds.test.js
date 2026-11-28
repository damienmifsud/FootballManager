import { describe, it, expect } from "vitest";
import { roundNameText, roundTag, ROUND_NAME_MAX } from "@/lib/rounds";

// lib/rounds.js: the name of a round with no number in its draw, as the game
// keeps it, and as a narrow column shows it.
describe("roundNameText", () => {
  it("keeps a round's name as plain text, short", () => {
    expect(roundNameText("  Semi  Finals ")).toBe("Semi Finals");
    expect(roundNameText("Grand Final")).toBe("Grand Final");
    expect(roundNameText("x".repeat(60))).toHaveLength(ROUND_NAME_MAX);
  });
  it("is no name for a numbered round, a number or nothing", () => {
    for (const v of ["Round 3", "round 12", "R3", "r7", "7", "", "   ", null, undefined, 4, { name: "Final" }]) expect(roundNameText(v), String(v)).toBe("");
  });
});

describe("roundTag", () => {
  it("is the first letters of the round's words, at most three", () => {
    expect(["Semi Finals", "Grand Final", "Quarter-Finals", "Final", "Preliminary Final", "Pool A", "Elimination Semi Final Two"].map(roundTag))
      .toEqual(["SF", "GF", "QF", "F", "PF", "PA", "ESF"]);
  });
  it("leaves out words that start with no letter, and is empty for no name", () => {
    expect(roundTag("3rd Place Playoff")).toBe("PP");
    expect(roundTag("Round 4")).toBe("");
    expect(roundTag("")).toBe("");
  });
});
