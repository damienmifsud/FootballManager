import { describe, it, expect } from "vitest";
import { groundOf, fieldOf, sharedGround } from "@/lib/dashboardData";

// A venue written "Perry Park – Field 4C" is a ground and a field on it. The
// two games of a paired round often share the ground: it is then named once,
// with the way there, and each side's line carries only its field.
describe("ground and field of a venue", () => {
  it("splits on the spaced en dash, and only there", () => {
    expect([groundOf("Perry Park – Field 4C"), fieldOf("Perry Park – Field 4C")]).toEqual(["Perry Park", "Field 4C"]);
    expect([groundOf("Perry Park"), fieldOf("Perry Park")]).toEqual(["Perry Park", ""]);
    expect([groundOf("Lions Park – Top oval – Field 2"), fieldOf("Lions Park – Top oval – Field 2")]).toEqual(["Lions Park", "Top oval – Field 2"]);
    expect([groundOf("Riverside Park, Field 3"), fieldOf("Riverside Park, Field 3")]).toEqual(["Riverside Park, Field 3", ""]); // a comma is not a field
    expect([groundOf("St-George Oval"), fieldOf("St-George Oval")]).toEqual(["St-George Oval", ""]);                         // nor is a hyphen
    expect([groundOf(""), fieldOf(""), groundOf(undefined), fieldOf(null)]).toEqual(["", "", "", ""]);
  });

  it("two venues share a ground when it is the same one and each has a field of its own", () => {
    expect(sharedGround("Perry Park – Field 4C", "Perry Park – Field 4A")).toBe("Perry Park");
    expect(sharedGround("Perry Park – Field 4C", "Lions Park – Field 1")).toBe("");  // two grounds
    expect(sharedGround("Perry Park – Field 4C", "Perry Park")).toBe("");            // one has no field: say each in full
    expect(sharedGround("Perry Park", "Perry Park")).toBe("");
    expect(sharedGround("Perry Park – Field 4C", "")).toBe("");
    expect(sharedGround("", "")).toBe("");
    expect(sharedGround(undefined, undefined)).toBe("");
  });
});
