import { describe, it, expect } from "vitest";
import { hatsFor, pickHat, teamsFor, resolveTeamSlug, hatLabel, joinNames, hasChoice, kidNames, isPlayerHat, HAT_ORDER } from "@/lib/hats";

// Pure helpers over the membership list: collapse (team, role, child) rows into
// the hats a person can act as, pick the one a session wears, and label them.

const M = [
  { teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Assistant coach" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam Smith" },
  { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Alex Smith" },
  { teamSlug: "b", teamName: "Team B", role: "viewer", clubAdmin: true },
  { teamSlug: "c", teamName: "Team C", role: "coach", admin: true, club: true }
];

describe("hatsFor", () => {
  it("collapses rows into hats, strongest first, siblings into one parent hat", () => {
    expect(hatsFor(M, "a")).toEqual([
      { role: "coach", playerIds: [], playerNames: [], staffRole: "Assistant coach" },
      { role: "parent", playerIds: ["p1", "p2"], playerNames: ["Sam Smith", "Alex Smith"] }
    ]);
    expect(hatsFor(M, "b")).toEqual([{ role: "viewer", playerIds: [], playerNames: [], clubAdmin: true }]);
    expect(hatsFor(M, "c")).toEqual([{ role: "coach", playerIds: [], playerNames: [], admin: true, club: true }]);
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

  it("a team is mine when at least one hat there is not club-level", () => {
    expect(teamsFor(M).map((t) => [t.teamSlug, t.mine])).toEqual([["a", true], ["b", true], ["c", false]]);
    // A super admin whose child plays in the team: club-level coach access, but the parent hat is their own.
    const ownerParent = [
      { teamSlug: "d", teamName: "Team D", role: "coach", admin: true, club: true },
      { teamSlug: "d", teamName: "Team D", role: "parent", playerId: "p1", playerName: "Sam" }
    ];
    expect(teamsFor(ownerParent)).toEqual([{
      teamSlug: "d", teamName: "Team D", mine: true,
      hats: [{ role: "coach", playerIds: [], playerNames: [], admin: true, club: true }, { role: "parent", playerIds: ["p1"], playerNames: ["Sam"] }]
    }]);
    // A club admin's default view of a team is club-level too.
    expect(teamsFor([{ teamSlug: "e", teamName: "Team E", role: "viewer", clubAdmin: true, club: true }])[0]).toMatchObject({
      mine: false, hats: [{ role: "viewer", clubAdmin: true, club: true }]
    });
  });

  it("knows when there is a real choice to make", () => {
    expect(hasChoice(M)).toBe(true);                                  // several teams
    expect(hasChoice([M[0], M[1]])).toBe(true);                       // one team, two hats
    expect(hasChoice([M[1], M[2]])).toBe(false);                      // one team, one hat (two kids)
    expect(hasChoice([{ teamSlug: "a", teamName: "A", role: "coach" }])).toBe(false);
    expect(hasChoice([])).toBe(false);
  });
});

describe("resolveTeamSlug", () => {
  const coach = (slug) => ({ teamSlug: slug, teamName: slug.toUpperCase(), role: "coach" });
  const clubCoach = (slug) => ({ teamSlug: slug, teamName: slug.toUpperCase(), role: "coach", admin: true, club: true });
  const clubView = (slug) => ({ teamSlug: slug, teamName: slug.toUpperCase(), role: "viewer", clubAdmin: true, club: true });

  it("a cookie naming a team this login can open wins, club-level teams included", () => {
    expect(resolveTeamSlug([coach("a"), coach("b")], "b")).toBe("b");
    expect(resolveTeamSlug([coach("a"), clubCoach("b"), clubCoach("c")], "c")).toBe("c");
    expect(resolveTeamSlug([clubView("a"), clubView("b")], "b")).toBe("b");
  });

  it("a cookie naming a team it cannot open is ignored", () => {
    expect(resolveTeamSlug([coach("a"), coach("b")], "zzz")).toBeNull();
    expect(resolveTeamSlug([coach("a")], "zzz")).toBe("a");
  });

  it("with no cookie: the only team the person is on", () => {
    expect(resolveTeamSlug([coach("a")], undefined)).toBe("a");
    // One team of their own among many they can merely open: theirs.
    expect(resolveTeamSlug([clubCoach("a"), coach("b"), clubCoach("c")], undefined)).toBe("b");
    expect(resolveTeamSlug([clubView("a"), { teamSlug: "b", teamName: "B", role: "parent", playerId: "p1", playerName: "Sam" }], "")).toBe("b");
  });

  it("with no cookie and several teams of their own: there is a choice to make", () => {
    expect(resolveTeamSlug([coach("a"), coach("b")], undefined)).toBeNull();
    expect(resolveTeamSlug([coach("a"), coach("b"), clubCoach("c")], undefined)).toBeNull();
  });

  it("on no team themselves: the only team there is, else a choice", () => {
    expect(resolveTeamSlug([clubCoach("a")], undefined)).toBe("a");
    expect(resolveTeamSlug([clubCoach("a"), clubCoach("b")], undefined)).toBeNull();
    expect(resolveTeamSlug([clubView("a"), clubView("b")], undefined)).toBeNull();
    expect(resolveTeamSlug([], undefined)).toBeNull();
    expect(resolveTeamSlug(undefined, "a")).toBeNull();
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
    // A super admin who is on the team's staff reads as that role there; so does one who is simply its coach.
    expect(hatLabel({ role: "coach", playerIds: [], playerNames: [], staffRole: "Assistant coach", admin: true })).toBe("Assistant coach");
    expect(hatLabel({ role: "coach", playerIds: [], playerNames: [], admin: true })).toBe("Coach");
    expect(hatLabel({ role: "coach", playerIds: [], playerNames: [] })).toBe("Coach");
    expect(hatLabel({ role: "viewer", playerIds: [], playerNames: [] })).toBe("View only");
    expect(hatLabel({ role: "parent", playerIds: ["p9"], playerNames: [""] })).toBe("Parent");
    expect(hatLabel(null)).toBe("");
  });
});

// A player who signs in with their own email holds a "player" membership on
// their own record. It folds into the family hat, so every rule written for a
// parent applies to them over that one record.
describe("a player's own login (the family hat)", () => {
  const A = { teamSlug: "a", teamName: "Team A" };
  const SELF = { ...A, role: "player", playerId: "p7", playerName: "Jo Park" };
  const KID = { ...A, role: "parent", playerId: "p8", playerName: "Leo Park" };

  it("a player membership gives the family hat, with the record marked as the person's own", () => {
    expect(hatsFor([SELF], "a")).toEqual([{ role: "parent", playerIds: ["p7"], playerNames: ["Jo Park"], selfIds: ["p7"] }]);
  });

  it("their own record and their child's sit under one hat, so there is nothing to switch between", () => {
    expect(hatsFor([SELF, KID], "a")).toEqual([
      { role: "parent", playerIds: ["p7", "p8"], playerNames: ["Jo Park", "Leo Park"], selfIds: ["p7"] }
    ]);
    expect(hatsFor([KID, SELF], "a")[0]).toMatchObject({ playerIds: ["p8", "p7"], selfIds: ["p7"] });
  });

  it("a parent's hat carries no selfIds key at all", () => {
    expect(hatsFor([KID], "a")[0]).not.toHaveProperty("selfIds");
  });

  it("labels the hat Player, and names a child who plays in the same team", () => {
    expect(hatLabel(hatsFor([SELF], "a")[0])).toBe("Player");
    expect(hatLabel(hatsFor([SELF, KID], "a")[0])).toBe("Player and parent of Leo");
    expect(hatLabel(hatsFor([KID], "a")[0])).toBe("Parent of Leo");
  });

  it("kidNames leaves the person themselves out; isPlayerHat is true only with a record of their own", () => {
    const both = hatsFor([SELF, KID], "a")[0];
    expect(kidNames(both)).toEqual(["Leo Park"]);
    expect(kidNames(hatsFor([SELF], "a")[0])).toEqual([]);
    expect(kidNames(hatsFor([KID], "a")[0])).toEqual(["Leo Park"]);
    expect(kidNames(null)).toEqual([]);
    expect(isPlayerHat(both)).toBe(true);
    expect(isPlayerHat(hatsFor([KID], "a")[0])).toBe(false);
    expect(isPlayerHat({ role: "coach", playerIds: [], playerNames: [], selfIds: ["p7"] })).toBe(false);
    expect(isPlayerHat(null)).toBe(false);
  });

  it("a player who also coaches holds two hats and opens the team as coach", () => {
    const m = [{ ...A, role: "coach" }, SELF];
    expect(hatsFor(m, "a").map((h) => h.role)).toEqual(["coach", "parent"]);
    expect(pickHat(m, "a", undefined).role).toBe("coach");
    expect(pickHat(m, "a", "parent")).toMatchObject({ role: "parent", selfIds: ["p7"] });
    // "player" is a kind of membership, not a hat: asking for it changes nothing.
    expect(pickHat(m, "a", "player").role).toBe("coach");
    expect(pickHat([SELF], "a", "player")).toEqual(hatsFor([SELF], "a")[0]);
  });

  it("a team someone plays in is one of their own teams, and is opened without asking", () => {
    expect(teamsFor([SELF])).toEqual([{ teamSlug: "a", teamName: "Team A", hats: hatsFor([SELF], "a"), mine: true }]);
    expect(resolveTeamSlug([SELF], undefined)).toBe("a");
    expect(hasChoice([SELF])).toBe(false);
  });
});
