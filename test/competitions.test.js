import { describe, it, expect } from "vitest";
import { sanitizeSquadiIds, squadiReady, sanitizeCompetitions, squadiSources, knownCompetitions, sanitizeSquad, competitionsError, driblSources, MAX_COMPETITIONS } from "@/lib/competitions";
import { NOT_A_DRIBL_REQUEST, ONE_SOURCE } from "@/lib/dribl";

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

// A competition's draw comes from Squadi (three ids) or from Dribl (a fixtures
// request: lib/dribl.js). One source each; the wizard's save is refused, with
// a sentence, when a row has a bad Dribl link or both.
describe("a competition whose draw is on Dribl", () => {
  const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=S1&competition=C1&league=L1&club=CL1&tenant=T1&timezone=Australia%2FBrisbane";
  const IDS = { competitionId: "1750", divisionId: "20001", teamId: 300123 };
  const counter = () => { let n = 0; return () => `cnew${++n}`; };

  it("sanitizeCompetitions keeps the Dribl source, tidied, beside the name", () => {
    expect(sanitizeCompetitions([{ name: "Premier Invitational", dribl: { url: REQUEST + "&cursor=x", team: " Olympic  FC U9 " } }], counter()))
      .toEqual([{ id: "cnew1", name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic FC U9" } }]);
    // No team name given: none stored.
    expect(sanitizeCompetitions([{ id: "cprem", name: "Premier Invitational", dribl: { url: REQUEST } }], counter()))
      .toEqual([{ id: "cprem", name: "Premier Invitational", dribl: { url: REQUEST } }]);
    // A row with only its Dribl request is a row: it is kept and given a name.
    expect(sanitizeCompetitions([{ dribl: { url: REQUEST } }], counter())).toEqual([{ id: "cnew1", name: "Competition 1", dribl: { url: REQUEST } }]);
  });

  it("never stores a link that is not a Dribl request, and never two sources on one competition", () => {
    // (The save is refused before this by competitionsError; this is the second line of defence.)
    expect(sanitizeCompetitions([{ name: "Bad link", dribl: { url: "https://evil.example/api/fixtures?tenant=T1" } }], counter())).toEqual([{ id: "cnew1", name: "Bad link" }]);
    expect(sanitizeCompetitions([{ name: "Both", squadi: IDS, dribl: { url: REQUEST } }], counter())).toEqual([{ id: "cnew1", name: "Both", squadi: IDS }]);
    // A blank Dribl field beside Squadi ids is just a Squadi competition.
    expect(sanitizeCompetitions([{ name: "Winterfest", squadi: IDS, dribl: { url: "", team: "" } }], counter())).toEqual([{ id: "cnew1", name: "Winterfest", squadi: IDS }]);
    // A bad link alone, with no name, is nothing at all.
    expect(sanitizeCompetitions([{ dribl: { url: "not a link" } }], counter())).toEqual([]);
  });

  it("competitionsError says why a list cannot be saved, naming the competition", () => {
    expect(competitionsError([{ name: "Premier Invitational", dribl: { url: "https://premierinvitational.dribl.com/fixtures?season=x" } }])).toBe(`Premier Invitational: ${NOT_A_DRIBL_REQUEST}`);
    expect(competitionsError([{ name: "", dribl: { url: "not a link" } }])).toBe(NOT_A_DRIBL_REQUEST);
    expect(competitionsError([{ name: "Both", squadi: IDS, dribl: { url: REQUEST } }])).toBe(`Both: ${ONE_SOURCE}`);
    expect(competitionsError([{ squadi: { competitionId: "1" }, dribl: { url: REQUEST } }])).toBe(ONE_SOURCE);
    expect(ONE_SOURCE).toBe("A competition gets its draw from Squadi or from Dribl, not both.");
    // The first problem in the list is the one reported.
    expect(competitionsError([{ name: "Fine", dribl: { url: REQUEST } }, { name: "Second", dribl: { url: "x" } }, { name: "Third", squadi: IDS, dribl: { url: REQUEST } }])).toBe(`Second: ${NOT_A_DRIBL_REQUEST}`);
  });

  it("competitionsError has nothing to say about a list that can be saved", () => {
    expect(competitionsError([{ name: "Winterfest", squadi: IDS }, { name: "Premier Invitational", dribl: { url: REQUEST, team: "Olympic" } }, { name: "Later" }])).toBeNull();
    expect(competitionsError([{ name: "Winterfest", squadi: IDS, dribl: { url: "  ", team: "left over" } }])).toBeNull();
    for (const none of [undefined, null, [], "x", {}, [null, "x", 7, []]]) expect(competitionsError(none)).toBeNull();
  });

  it("driblSources: the competitions a browser should fetch, with their own id and name", () => {
    const team = { slug: "a", squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 }, competitions: [
      { id: "cw", name: "Winterfest", squadi: IDS },
      { id: "cp", name: "Premier Invitational", dribl: { url: REQUEST } },
      { id: "cc", name: "Cup", dribl: { url: REQUEST.replace("L1", "L2"), team: "Olympic FC U9 White" } },
      { id: "cl", name: "Not published" }
    ] };
    expect(driblSources(team)).toEqual([
      { comp: { id: "cp", name: "Premier Invitational" }, dribl: { url: REQUEST } },
      { comp: { id: "cc", name: "Cup" }, dribl: { url: REQUEST.replace("L1", "L2"), team: "Olympic FC U9 White" } }
    ]);
    // And Squadi's list is unchanged by them: the season and Winterfest.
    expect(squadiSources(team).map((x) => x.comp?.id || "season")).toEqual(["season", "cw"]);
  });

  it("driblSources leaves out anything that cannot be fetched or is already Squadi's", () => {
    const comps = [
      null, "x", { name: "No id", dribl: { url: REQUEST } }, { id: "", name: "Blank id", dribl: { url: REQUEST } },
      { id: "c1", name: "Tampered", dribl: { url: "https://evil.example/api/fixtures?tenant=T1" } },
      { id: "c2", name: "No url", dribl: { team: "Olympic" } },
      { id: "c3", name: "Both stored", squadi: IDS, dribl: { url: REQUEST } },
      { id: "c4", dribl: { url: REQUEST } }
    ];
    expect(driblSources({ competitions: comps })).toEqual([{ comp: { id: "c4", name: "Competition" }, dribl: { url: REQUEST } }]);
    for (const none of [null, undefined, {}, { competitions: "x" }]) expect(driblSources(none)).toEqual([]);
  });
});
