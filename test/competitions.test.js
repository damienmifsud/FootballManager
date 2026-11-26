import { describe, it, expect } from "vitest";
import { sanitizeSquadiIds, squadiReady, sanitizeCompetitions, squadiSources, squadiFeeds, knownCompetitions, sanitizeSquad, MAX_COMPETITIONS } from "@/lib/competitions";

// lib/competitions: a team's competitions beyond its season (a winter
// tournament, an invitational league). Each has a permanent id, a name and,
// once its draw is published, Squadi ids. /api/teams stores them through
// sanitizeCompetitions; /api/sync asks squadiSources what to pull.

// Ids are made by the caller (the route uses random ones); a counter here.
const counter = () => { let n = 0; return () => `cnew${++n}`; };

describe("sanitizeSquadiIds", () => {
  it("keeps the three ids as two trimmed strings and a number", () => {
    expect(sanitizeSquadiIds({ competitionId: " 1439 ", divisionId: 10661, teamId: "110013" })).toEqual({ competitionId: "1439", divisionId: "10661", teamId: 110013 });
    expect(sanitizeSquadiIds({ competitionId: "1439", divisionId: "10661", teamId: 110013, extra: "x" })).toEqual({ competitionId: "1439", divisionId: "10661", teamId: 110013 });
  });

  it("keeps a half-filled set as it is (the rest comes later)", () => {
    expect(sanitizeSquadiIds({ competitionId: "1500" })).toEqual({ competitionId: "1500", divisionId: "", teamId: 0 });
    expect(sanitizeSquadiIds({ teamId: "42" })).toEqual({ competitionId: "", divisionId: "", teamId: 42 });
  });

  it("is null when nothing was entered", () => {
    for (const input of [undefined, null, {}, { competitionId: "", divisionId: "  ", teamId: "" }, { teamId: "abc" }, "1439", 7, []]) {
      expect(sanitizeSquadiIds(input)).toBeNull();
    }
  });
});

describe("squadiReady", () => {
  it("needs all three ids", () => {
    expect(squadiReady({ competitionId: "1", divisionId: "2", teamId: 3 })).toBe(true);
    expect(squadiReady({ competitionId: "1", divisionId: "2", teamId: 0 })).toBe(false);
    expect(squadiReady({ competitionId: "1", divisionId: "", teamId: 3 })).toBe(false);
    expect(squadiReady({ competitionId: "", divisionId: "2", teamId: 3 })).toBe(false);
    expect(squadiReady(null)).toBe(false);
    expect(squadiReady(undefined)).toBe(false);
  });
});

describe("sanitizeCompetitions", () => {
  it("gives each new row an id and keeps its name and ids", () => {
    const out = sanitizeCompetitions([
      { name: "  Winterfest ", squadi: { competitionId: "1750", divisionId: "20001", teamId: "300123" } },
      { name: "Premier Invitational" }
    ], counter());
    expect(out).toEqual([
      { id: "cnew1", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } },
      { id: "cnew2", name: "Premier Invitational" }
    ]);
  });

  it("a competition whose draw is not published yet is kept with just its name", () => {
    const out = sanitizeCompetitions([{ name: "Winterfest", squadi: { competitionId: "", divisionId: "", teamId: "" } }], counter());
    expect(out).toEqual([{ id: "cnew1", name: "Winterfest" }]);
    expect("squadi" in out[0]).toBe(false);
  });

  it("keeps the id a row came with, so a rename or new ids never orphan its games", () => {
    const out = sanitizeCompetitions([
      { id: "c1a2b3c4d", name: "Winterfest 2027", squadi: { competitionId: "1900", divisionId: "22000", teamId: 400000 } },
      { id: "c5e6f7a8b", name: "Premier Invitational" }
    ], counter());
    expect(out.map((c) => c.id)).toEqual(["c1a2b3c4d", "c5e6f7a8b"]);
    expect(out[0]).toMatchObject({ name: "Winterfest 2027", squadi: { competitionId: "1900" } });
  });

  it("replaces an id that is missing, malformed or already used", () => {
    const out = sanitizeCompetitions([
      { id: "same", name: "A" },
      { id: "same", name: "B" },
      { id: "Not An Id!", name: "C" },
      { id: 42, name: "D" },
      { id: "x", name: "E" } // too short
    ], counter());
    expect(out.map((c) => c.id)).toEqual(["same", "cnew1", "cnew2", "cnew3", "cnew4"]);
    expect(new Set(out.map((c) => c.id)).size).toBe(5);
  });

  it("never reuses an id the maker hands out twice, and drops the row if it cannot get one", () => {
    let n = 0;
    const sticky = () => (++n < 3 ? "cdup" : "cfresh");
    expect(sanitizeCompetitions([{ name: "A" }, { name: "B" }], sticky).map((c) => c.id)).toEqual(["cdup", "cfresh"]);
    // A maker that only ever returns something unusable: the row is dropped, not stored without an id.
    expect(sanitizeCompetitions([{ name: "A" }], () => "NOT VALID")).toEqual([]);
  });

  it("drops rows nobody filled in and anything that is not a row", () => {
    const out = sanitizeCompetitions([
      { name: "", squadi: { competitionId: "", divisionId: "", teamId: "" } },
      { name: "   " }, {}, null, "Winterfest", 7, ["x"],
      { name: "Real" }
    ], counter());
    expect(out).toEqual([{ id: "cnew1", name: "Real" }]);
  });

  it("names a row that has ids but no name by its place", () => {
    const out = sanitizeCompetitions([{ name: "First" }, { squadi: { competitionId: "9", divisionId: "8", teamId: 7 } }], counter());
    expect(out[1]).toEqual({ id: "cnew2", name: "Competition 2", squadi: { competitionId: "9", divisionId: "8", teamId: 7 } });
  });

  it("caps the name and the list, keeps the order, and stores only the known keys", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Comp ${i + 1}`, secret: "x", players: ["p1"] }));
    const out = sanitizeCompetitions(many, counter());
    expect(out).toHaveLength(MAX_COMPETITIONS);
    expect(MAX_COMPETITIONS).toBe(8);
    expect(out.map((c) => c.name)).toEqual(many.slice(0, 8).map((c) => c.name));
    expect(Object.keys(out[0])).toEqual(["id", "name"]);
    expect(sanitizeCompetitions([{ name: "x".repeat(100) }], counter())[0].name).toHaveLength(40);
  });

  it("is an empty list for anything that is not a list, and never mutates its input", () => {
    for (const input of [undefined, null, "Winterfest", 7, {}, { 0: { name: "A" } }]) expect(sanitizeCompetitions(input, counter())).toEqual([]);
    const input = [{ id: "ckeep", name: " A ", squadi: { competitionId: " 1 ", divisionId: "2", teamId: "3" } }];
    const before = JSON.stringify(input);
    sanitizeCompetitions(input, counter());
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("squadiSources", () => {
  const SEASON = { competitionId: "1439", divisionId: "10661", teamId: 110013 };
  const WINTER = { competitionId: "1750", divisionId: "20001", teamId: 300123 };

  it("the season first, then every other competition whose ids are complete", () => {
    const team = { slug: "a", squadi: SEASON, competitions: [
      { id: "c1", name: "Winterfest", squadi: WINTER },
      { id: "c2", name: "Premier Invitational" }, // not published yet
      { id: "c3", name: "Half", squadi: { competitionId: "5", divisionId: "", teamId: 0 } }
    ] };
    expect(squadiSources(team)).toEqual([
      { comp: null, squadi: SEASON },
      { comp: { id: "c1", name: "Winterfest" }, squadi: WINTER }
    ]);
  });

  it("a team with only its season has one source, as it always did", () => {
    expect(squadiSources({ slug: "a", squadi: SEASON })).toEqual([{ comp: null, squadi: SEASON }]);
    // The season is attempted as soon as it has a competition id (a half-filled one is reported, not skipped).
    expect(squadiSources({ squadi: { competitionId: "1", divisionId: "", teamId: 0 } })).toHaveLength(1);
  });

  it("another competition can be the only source: the season's draw is not out yet", () => {
    expect(squadiSources({ slug: "a", competitions: [{ id: "c1", name: "Winterfest", squadi: WINTER }] }))
      .toEqual([{ comp: { id: "c1", name: "Winterfest" }, squadi: WINTER }]);
  });

  it("nothing to pull when no draw has its ids, or the entry is malformed", () => {
    expect(squadiSources({ slug: "a" })).toEqual([]);
    expect(squadiSources({ slug: "a", squadi: {}, competitions: [{ id: "c1", name: "W" }] })).toEqual([]);
    expect(squadiSources({ competitions: "Winterfest" })).toEqual([]);
    expect(squadiSources({ competitions: [null, "x", { name: "No id", squadi: WINTER }, { id: "", name: "Blank id", squadi: WINTER }] })).toEqual([]);
    expect(squadiSources(null)).toEqual([]);
    expect(squadiSources(undefined)).toEqual([]);
  });

  it("one draw is one source: the same three ids listed twice are pulled once, by whoever lists them first", () => {
    // The season's ids copied into a competition row: the games stay the season's.
    expect(squadiSources({ squadi: SEASON, competitions: [{ id: "c1", name: "Copy", squadi: { ...SEASON } }] })).toEqual([{ comp: null, squadi: SEASON }]);
    // The same ids as strings and numbers are the same draw.
    expect(squadiSources({ squadi: SEASON, competitions: [{ id: "c1", name: "Copy", squadi: { competitionId: " 1439", divisionId: "10661", teamId: "110013" } }] })).toHaveLength(1);
    // Two competition rows with one draw: the first keeps it.
    const twice = squadiSources({ competitions: [{ id: "c1", name: "Winterfest", squadi: WINTER }, { id: "c2", name: "Winterfest again", squadi: { ...WINTER } }] });
    expect(twice.map((x) => x.comp.id)).toEqual(["c1"]);
    // Sharing a competition and division with another team id is a different draw.
    expect(squadiSources({ squadi: SEASON, competitions: [{ id: "c1", name: "Other team", squadi: { ...SEASON, teamId: 110012 } }] })).toHaveLength(2);
  });

  it("falls back to a plain label when a stored entry has no name", () => {
    expect(squadiSources({ competitions: [{ id: "c1", squadi: WINTER }] })[0].comp).toEqual({ id: "c1", name: "Competition" });
  });
});

// ---- Squads ----------------------------------------------------------------
// A competition's squad is the coach's pick of who is going to it
// (data.competitionSquads[competitionId]); /api/competition-squad lists a team's competitions with
// knownCompetitions and stores a pick through sanitizeSquad.

describe("knownCompetitions", () => {
  const team = { slug: "a", competitions: [{ id: "c1", name: "Winterfest", squadi: { competitionId: "1", divisionId: "2", teamId: 3 } }, { id: "c2", name: "Premier Invitational" }] };

  it("the registry's competitions in order, with or without a draw yet, and nothing but id and name", () => {
    expect(knownCompetitions(team, { fixtures: [] })).toEqual([{ id: "c1", name: "Winterfest" }, { id: "c2", name: "Premier Invitational" }]);
    // The document is not needed to know them.
    expect(knownCompetitions(team, null)).toEqual([{ id: "c1", name: "Winterfest" }, { id: "c2", name: "Premier Invitational" }]);
    expect(knownCompetitions(team, undefined)).toHaveLength(2);
  });

  it("a competition that only survives on the team's games is still known, after the registry's, once", () => {
    const data = { fixtures: [
      { id: "f1", round: 1 }, // a season game adds nothing
      { id: "f2", comp: "cold", compName: "Summer Cup" },
      { id: "f3", comp: "cold", compName: "Summer Cup (renamed)" },
      { id: "f4", comp: "c1", compName: "Winterfest as the game remembers it" }
    ] };
    expect(knownCompetitions(team, data)).toEqual([
      { id: "c1", name: "Winterfest" }, // the registry's name wins
      { id: "c2", name: "Premier Invitational" },
      { id: "cold", name: "Summer Cup" } // the first game's name
    ]);
    // With no registry list at all, the games are all there is to go on.
    expect(knownCompetitions({ slug: "a" }, data)).toEqual([{ id: "cold", name: "Summer Cup" }, { id: "c1", name: "Winterfest as the game remembers it" }]);
    expect(knownCompetitions(null, data)).toHaveLength(2);
  });

  it("falls back to a plain label for an unnamed competition, and skips anything without a usable id", () => {
    expect(knownCompetitions({ competitions: [{ id: "c1" }, { id: "c2", name: "" }] }, null)).toEqual([{ id: "c1", name: "Competition" }, { id: "c2", name: "Competition" }]);
    expect(knownCompetitions(null, { fixtures: [{ comp: "cx" }, { comp: "cy", compName: "   " }, { comp: "cz", compName: 7 }] }))
      .toEqual([{ id: "cx", name: "Competition" }, { id: "cy", name: "Competition" }, { id: "cz", name: "7" }]);
    const junk = { competitions: [null, "c9", { name: "No id" }, { id: "", name: "Blank" }, { id: 5, name: "Number" }, { id: "c1", name: "Kept" }, { id: "c1", name: "Repeat" }] };
    expect(knownCompetitions(junk, { fixtures: [null, "x", { comp: "" }, { comp: 5 }, { compName: "Name only" }] })).toEqual([{ id: "c1", name: "Kept" }]);
    expect(knownCompetitions({ competitions: "Winterfest" }, { fixtures: "nope" })).toEqual([]);
    expect(knownCompetitions(null, null)).toEqual([]);
    expect(knownCompetitions(undefined, undefined)).toEqual([]);
  });
});

describe("sanitizeSquad", () => {
  const players = [{ id: "p1", name: "Sam" }, { id: "p2", name: "Alex" }, { id: "p3", name: "Kim" }];

  it("null means everyone, and comes back as null", () => {
    expect(sanitizeSquad(null, players)).toBeNull();
    expect(sanitizeSquad(undefined, players)).toBeNull();
  });

  it("a list is cut to the team's own players, each once, in the team's order", () => {
    expect(sanitizeSquad(["p3", "p1"], players)).toEqual(["p1", "p3"]);
    expect(sanitizeSquad(["p2", "p2", "p2"], players)).toEqual(["p2"]);
    expect(sanitizeSquad(["p1", "p2", "p3"], players)).toEqual(["p1", "p2", "p3"]);
    // A player who is not on this team (another team's id, a deleted player) is dropped.
    expect(sanitizeSquad(["p1", "other-team-player", "gone"], players)).toEqual(["p1"]);
    // Only strings are ids: nothing is coerced into matching one.
    expect(sanitizeSquad([1, null, { id: "p1" }, ["p2"], true, "p3"], [{ id: 1 }, ...players])).toEqual(["p3"]);
  });

  it("a list that leaves nobody is everyone: a competition is never for no one", () => {
    expect(sanitizeSquad([], players)).toBeNull();
    expect(sanitizeSquad(["gone"], players)).toBeNull();
    expect(sanitizeSquad([7, null], players)).toBeNull();
    expect(sanitizeSquad(["p1"], [])).toBeNull();
    expect(sanitizeSquad(["p1"], undefined)).toBeNull();
    expect(sanitizeSquad(["p1"], "nope")).toBeNull();
    expect(sanitizeSquad(["p1"], [null, undefined, players[0]])).toEqual(["p1"]);
  });

  it("anything that is neither a list nor null is not a squad", () => {
    for (const bad of ["p1", "everyone", 0, 3, true, false, {}, { p1: true }, { length: 1, 0: "p1" }]) expect(sanitizeSquad(bad, players)).toBeUndefined();
  });

  it("never changes what it was given", () => {
    const sent = ["p3", "p1", "p3"];
    sanitizeSquad(sent, players);
    expect(sent).toEqual(["p3", "p1", "p3"]);
    expect(players.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});

// One squad that plays as two teams each round has two season feeds
// (team.squadi as an array of two labelled feeds). Each is a season source
// carrying its label as `side`; other competitions follow as before.
describe("squadiSources — a season with two feeds", () => {
  const McKay = { label: "McKay", competitionId: "1844", divisionId: "12962", teamId: 133944 };
  const McKain = { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 };
  const WINTER = { competitionId: "1750", divisionId: "20001", teamId: 300123 };

  it("each feed is a season source with its side, in the order given, before any other competition", () => {
    const team = { slug: "u9", squadi: [McKay, McKain], competitions: [{ id: "c1", name: "Winterfest", squadi: WINTER }, { id: "c2", name: "Not published" }] };
    expect(squadiSources(team)).toEqual([
      { comp: null, side: "McKay", squadi: McKay },
      { comp: null, side: "McKain", squadi: McKain },
      { comp: { id: "c1", name: "Winterfest" }, squadi: WINTER }
    ]);
    // A competition's source never carries a side.
    expect("side" in squadiSources(team)[2]).toBe(false);
    // Wizard order is the order kept.
    expect(squadiSources({ squadi: [McKain, McKay] }).map((x) => x.side)).toEqual(["McKain", "McKay"]);
  });

  it("a single feed has no side, however it is stored and whatever label it carries", () => {
    const ids = { competitionId: "1439", divisionId: "10661", teamId: 110013 };
    for (const squadi of [ids, [ids], { label: "McKay", ...ids }, [{ label: "McKay", ...ids }], [{ label: "McKay", ...ids }, null], [{ label: "McKay", ...ids }, {}]]) {
      const sources = squadiSources({ squadi });
      expect(sources).toEqual([{ comp: null, squadi: ids }]);
      expect("side" in sources[0]).toBe(false);
      expect("label" in sources[0].squadi).toBe(false);
    }
  });

  it("a feed is attempted once it has a competition id; a row with only other ids is a feed but not yet a source", () => {
    // The second row is half filled: the pair still stands (so the first keeps its side), and only the first is pulled.
    expect(squadiSources({ squadi: [McKay, { label: "McKain", competitionId: "", divisionId: "12960", teamId: 0 }] })).toEqual([{ comp: null, side: "McKay", squadi: McKay }]);
    // A competition id alone is enough to try (the failure is reported, not hidden).
    expect(squadiSources({ squadi: [McKay, { label: "McKain", competitionId: "1844", divisionId: "", teamId: 0 }] }).map((x) => x.side)).toEqual(["McKay", "McKain"]);
  });

  it("one draw is one source: the same ids on both rows, or repeated in a competition row, are pulled once", () => {
    // Both rows naming the same Squadi team would retag every game on every run: the first row keeps the draw.
    expect(squadiSources({ squadi: [McKay, { ...McKay, label: "McKain" }] })).toEqual([{ comp: null, side: "McKay", squadi: McKay }]);
    // A competition row repeating one of the feeds: the games stay the season's.
    const sources = squadiSources({ squadi: [McKay, McKain], competitions: [{ id: "c1", name: "Copy", squadi: { competitionId: "1844", divisionId: "12960", teamId: "133943" } }] });
    expect(sources.map((x) => x.side || x.comp?.name)).toEqual(["McKay", "McKain"]);
  });

  it("squadiFeeds: none, one or two, tidied, and never more than two", () => {
    expect(squadiFeeds(null)).toEqual([]);
    expect(squadiFeeds({})).toEqual([]);
    expect(squadiFeeds({ squadi: { competitionId: " 1439 ", divisionId: 10661, teamId: "110013" } })).toEqual([{ competitionId: "1439", divisionId: "10661", teamId: 110013 }]);
    expect(squadiFeeds({ squadi: [McKay, McKain, { label: "Third", ...WINTER }] })).toEqual([McKay, McKain]);
    expect(squadiFeeds({ squadi: [{ ...McKay, label: "  McKay " }, McKain] })[0].label).toBe("McKay");
  });
});
