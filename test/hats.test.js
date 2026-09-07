import { describe, it, expect } from "vitest";
import { hatsFor, pickHat, teamsFor, hatLabel, joinNames, hasChoice, HAT_ORDER } from "@/lib/hats";

// Pure helpers over the membership list: collapse (team, role, child) rows into
// the hats a person can act as, pick the one a session wears, and label them.

const M = [
  { teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Assistant coach" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam Smith" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Alex Smith" },
  { teamSlug: "b", teamName: "Team B", role: "viewer", clubAdmin: true },
  { teamSlug: "c", teamName: "Team C", role: "coach", admin: true }
];

describe("hatsFor", () => {
  it("collapses rows into hats, strongest first, siblings into one parent hat", () => {
    expect(hatsFor(M, "a")).toEqual([
      { role: "coach", playerIds: [], playerNames: [], staffRole: "Assistant coach" },
      { role: "parent", playerIds: ["p1", "p2"], playerNames: ["Sam Smith", "Alex Smith"] }
    ]);
    expect(hatsFor(M, "b")).toEqual([{ role: "viewer", playerIds: [], playerNames: [], clubAdmin: true }]);
    expect(hatsFor(M, "c")).toEqual([{ role: "coach", playerIds: [], playerNames: [], admin: true }]);
  });

  it("returns nothing for a team the person is not in, or junk input", () => {
    expect(hatsFor(M, "zzz")).toEqual([]);
    expect(hatsFor(undefined, "a")).toEqual([]);
    expect(hatsFor([null, undefined], "a")).toEqual([]);
  });

  it("orders coach > parent > viewer regardless of membership order", () => {
    const shuffled = [M[1], M[0], { teamSlug: "a", teamName: "Team A", role: "viewer" }];
    expect(hatsFor(shuffled, "a").map((h) => h.role)).toEqual(HAT_ORDER);
  });
});

describe("pickHat", () => {
  it("honours a wanted role the person really holds", () => {
    expect(pickHat(M, "a", "parent").role).toBe("parent");
    expect(pickHat(M, "a", "coach").role).toBe("coach");
  });

  it("falls back to the strongest hat for a missing, unknown or unheld role (never widens)", () => {
    expect(pickHat(M, "a", undefined).role).toBe("coach");
    expect(pickHat(M, "a", "viewer").role).toBe("coach"); // not held on A
    expect(pickHat(M, "a", "admin").role).toBe("coach");  // not a hat
    expect(pickHat(M, "b", "coach").role).toBe("viewer"); // forged cookie can't promote a viewer
  });

  it("returns null when the person has no hat on that team", () => {
    expect(pickHat(M, "nope", "coach")).toBeNull();
  });
});

describe("teamsFor / hasChoice", () => {
  it("lists distinct teams in membership order with their hats", () => {
    const teams = teamsFor(M);
    expect(teams.map((t) => t.teamSlug)).toEqual(["a", "b", "c"]);
    expect(teams[0].hats.map((h) => h.role)).toEqual(["coach", "parent"]);
    expect(teams[1].teamName).toBe("Team B");
  });

  it("knows when there is a real choice to make", () => {
    expect(hasChoice(M)).toBe(true);                                  // several teams
    expect(hasChoice([M[0], M[1]])).toBe(true);                       // one team, two hats
    expect(hasChoice([M[1], M[2]])).toBe(false);                      // one team, one hat (two kids)
    expect(hasChoice([{ teamSlug: "a", teamName: "A", role: "coach" }])).toBe(false);
    expect(hasChoice([])).toBe(false);
  });
});

describe("labels", () => {
  it("joins first names the way people say them", () => {
    expect(joinNames(["Sam Smith"])).toBe("Sam");
    expect(joinNames(["Sam Smith", "Alex Smith"])).toBe("Sam & Alex");
    expect(joinNames(["Sam", "Alex", "Leo Jones"])).toBe("Sam, Alex & Leo");
    expect(joinNames([])).toBe("");
    expect(joinNames(["", null])).toBe("");
  });

  it("labels each hat", () => {
    expect(hatLabel(hatsFor(M, "a")[0])).toBe("Assistant coach");
    expect(hatLabel(hatsFor(M, "a")[1])).toBe("Parent of Sam & Alex");
    expect(hatLabel(hatsFor(M, "b")[0])).toBe("Club admin (view only)");
    expect(hatLabel(hatsFor(M, "c")[0])).toBe("Super admin");
    expect(hatLabel({ role: "coach", playerIds: [], playerNames: [] })).toBe("Coach");
    expect(hatLabel({ role: "viewer", playerIds: [], playerNames: [] })).toBe("View only");
    expect(hatLabel({ role: "parent", playerIds: ["p9"], playerNames: [""] })).toBe("Parent");
    expect(hatLabel(null)).toBe("");
  });
});
