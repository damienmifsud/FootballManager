import { describe, it, expect } from "vitest";
import { sanitizeSquadiIds, squadiReady, sanitizeCompetitions, squadiSources, MAX_COMPETITIONS } from "@/lib/competitions";

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

describe("squadiFeeds — the season's one or two feeds", () => {
  it("is the one definition, whichever module it is imported from", async () => {
    const competitions = await import("@/lib/competitions");
    expect(typeof competitions.squadiFeeds).toBe("function");
    expect(competitions.squadiFeeds({ squadi: { competitionId: " 1 ", divisionId: "2", teamId: "3" } })).toEqual([{ competitionId: "1", divisionId: "2", teamId: 3 }]);
    expect(competitions.squadiFeeds({})).toEqual([]);
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

  it("a two-team squad's season is two sources, each with its side, ahead of any other competition", () => {
    const REDS = { label: "Reds", competitionId: "1844", divisionId: "12962", teamId: 133944 };
    const BLUES = { label: "Blues", competitionId: "1844", divisionId: "12960", teamId: 133943 };
    const team = { slug: "u9", squadi: [REDS, BLUES], competitions: [{ id: "c1", name: "Winterfest", squadi: WINTER }] };
    expect(squadiSources(team)).toEqual([
      { comp: null, side: "Reds", squadi: REDS },
      { comp: null, side: "Blues", squadi: BLUES },
      { comp: { id: "c1", name: "Winterfest" }, squadi: WINTER }
    ]);
    // Ids are tidied on the way (strings trimmed, the team id a number), as the registry keeps them.
    expect(squadiSources({ squadi: [{ ...REDS, label: " Reds ", teamId: "133944" }, BLUES] })[0]).toEqual({ comp: null, side: "Reds", squadi: REDS });
  });

  it("a pair with one row filled in is a single season source with no side", () => {
    const one = { competitionId: "1844", divisionId: "12962", teamId: 133944 };
    expect(squadiSources({ squadi: [{ label: "Reds", ...one }, { label: "", competitionId: "", divisionId: "", teamId: "" }] })).toEqual([{ comp: null, squadi: one }]);
    expect(squadiSources({ squadi: [] })).toEqual([]);
  });

  it("the same draw entered for both sides is one source: it would otherwise retag its games on every run", () => {
    const REDS = { label: "Reds", competitionId: "1844", divisionId: "12962", teamId: 133944 };
    const out = squadiSources({ squadi: [REDS, { ...REDS, label: "Blues" }], competitions: [{ id: "c1", name: "Copy", squadi: { competitionId: "1844", divisionId: "12962", teamId: 133944 } }] });
    expect(out).toEqual([{ comp: null, side: "Reds", squadi: REDS }]);
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
