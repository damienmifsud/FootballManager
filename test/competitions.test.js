import { describe, it, expect } from "vitest";
import {
  sanitizeSquadiIds, squadiReady, sanitizeCompetitions, squadiSources, squadiFeeds, knownCompetitions, sanitizeSquad, MAX_COMPETITIONS,
  websiteLink, websiteLinkProblem, websiteLinksError, LINK_MAX, NOT_A_WEBSITE_LINK, LINK_TOO_LONG
} from "@/lib/competitions";

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

// ---- Website links ----------------------------------------------------------
// A draw can carry the address of its page on the web: a copy for people,
// kept beside the ids the sync uses. It is shown as a link, so it is only
// ever a plain https address.
const FQ = "https://footballqueensland.com.au/competitions/fq-academy/?tab=fixtures";
const SQUADI_PAGE = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=b0e92958-980b-4da0-9ec9-a9c2597b06f0&yearId=9&competitionUniqueKey=4a2f&divisionId=12962&teamId=133944";
const DRIBL_PAGE = "https://premierinvitational.dribl.com/fixtures?season=RwNlzVMdjr&club=PydoO0nJdD";

describe("websiteLink", () => {
  it("keeps a full https address, trimmed, whichever site it is", () => {
    for (const link of [FQ, SQUADI_PAGE, DRIBL_PAGE]) {
      expect(websiteLink(link)).toBe(link);
      expect(websiteLink("  " + link + " \n")).toBe(link);
      expect(websiteLinkProblem(link)).toBe("");
    }
    // Square brackets, as Squadi writes a list of teams, are left as they are.
    expect(websiteLink("https://api.squadi.com/livescores/round/matches?teamIds=[133944]")).toBe("https://api.squadi.com/livescores/round/matches?teamIds=[133944]");
    // A bare site gets the slash every browser gives it.
    expect(websiteLink("https://footballqueensland.com.au")).toBe("https://footballqueensland.com.au/");
  });

  it("nothing entered is no link and no problem", () => {
    for (const empty of ["", "   ", null, undefined, 7, {}, [FQ]]) {
      expect(websiteLink(empty)).toBe("");
      expect(websiteLinkProblem(empty)).toBe("");
    }
  });

  it("is only ever a plain https address: anything else is not stored, and says why", () => {
    for (const bad of [
      "http://footballqueensland.com.au/draw",            // not https
      "footballqueensland.com.au/draw",                    // no scheme
      "www.footballqueensland.com.au",
      "//footballqueensland.com.au/draw",
      "javascript:alert(1)", "data:text/html,<p>x</p>", "ftp://footballqueensland.com.au/draw", "mailto:coach@example.com",
      "https://user:pass@footballqueensland.com.au/draw",  // credentials
      "https://user@footballqueensland.com.au/draw",
      "https://fixtures", "https://localhost/draw",        // not a site on the web
      "https://", "not a link", "Winterfest draw"
    ]) {
      expect(websiteLink(bad), bad).toBe("");
      expect(websiteLinkProblem(bad), bad).toBe(NOT_A_WEBSITE_LINK);
    }
    expect(NOT_A_WEBSITE_LINK).toBe("A website link should be a full address starting with https://");
  });

  it("has a length it will keep, and says so past it", () => {
    const base = "https://footballqueensland.com.au/draw?x=";
    const longest = base + "a".repeat(LINK_MAX - base.length);
    expect(longest).toHaveLength(LINK_MAX);
    expect(websiteLink(longest)).toBe(longest);
    expect(websiteLink(longest + "a")).toBe("");
    expect(websiteLinkProblem(longest + "a")).toBe(LINK_TOO_LONG);
    expect(LINK_TOO_LONG).toBe("A website link can be at most 1000 characters");
  });
});

describe("a draw's website link on the registry", () => {
  const IDS = { competitionId: "1844", divisionId: "12962", teamId: 133944 };

  it("a competition keeps its link beside its name and ids, in the stored form", () => {
    const [winter, premier] = sanitizeCompetitions([
      { name: "Winterfest", squadi: IDS, link: "  " + FQ + " " },
      { name: "Premier Invitational", link: DRIBL_PAGE }
    ], counter());
    expect(winter).toEqual({ id: "cnew1", name: "Winterfest", squadi: IDS, link: FQ });
    expect(premier).toEqual({ id: "cnew2", name: "Premier Invitational", link: DRIBL_PAGE });
  });

  it("a row with only a link is kept and named by its place; a link that is not one is not stored", () => {
    expect(sanitizeCompetitions([{ link: FQ }], counter())).toEqual([{ id: "cnew1", name: "Competition 1", link: FQ }]);
    expect(sanitizeCompetitions([{ name: "Winterfest", link: "javascript:alert(1)" }], counter())).toEqual([{ id: "cnew1", name: "Winterfest" }]);
    expect(sanitizeCompetitions([{ name: "", link: "not a link" }, { name: "Cup", link: "" }], counter())).toEqual([{ id: "cnew1", name: "Cup" }]);
  });

  it("the season's feed carries its link through squadiFeeds, and has none when none was given", () => {
    expect(squadiFeeds({ squadi: { ...IDS, link: " " + SQUADI_PAGE } })).toEqual([{ ...IDS, link: SQUADI_PAGE }]);
    expect(squadiFeeds({ squadi: IDS })).toEqual([IDS]);
    expect(squadiFeeds({ squadi: { ...IDS, link: "http://not-https.example/x" } })).toEqual([IDS]);
    expect(squadiFeeds({ squadi: { ...IDS, link: 7 } })).toEqual([IDS]);
  });

  it("each of two feeds has its own", () => {
    const two = [{ label: "McKay", ...IDS, link: SQUADI_PAGE }, { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }];
    expect(squadiFeeds({ squadi: two })).toEqual([
      { label: "McKay", ...IDS, link: SQUADI_PAGE },
      { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }
    ]);
  });

  it("a season with a link and no ids yet is a feed (the page is often known first), and nothing to sync", () => {
    const team = { squadi: { competitionId: "", divisionId: "", teamId: "", link: FQ } };
    expect(squadiFeeds(team)).toEqual([{ competitionId: "", divisionId: "", teamId: 0, link: FQ }]);
    expect(squadiSources(team)).toEqual([]);
    // A row with nothing at all, or only a link that is not one, is still no feed.
    expect(squadiFeeds({ squadi: { competitionId: "", divisionId: "", teamId: "", link: "" } })).toEqual([]);
    expect(squadiFeeds({ squadi: { link: "not a link" } })).toEqual([]);
  });

  it("the link changes nothing about what is synced", () => {
    const plain = { squadi: IDS, competitions: [{ id: "cwinter", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } }] };
    const linked = { squadi: { ...IDS, link: SQUADI_PAGE }, competitions: [{ ...plain.competitions[0], link: FQ }, { id: "cprem", name: "Premier Invitational", link: DRIBL_PAGE }] };
    const ids = (sources) => sources.map((s) => [s.comp && s.comp.id, s.squadi.competitionId, s.squadi.divisionId, s.squadi.teamId]);
    expect(ids(squadiSources(linked))).toEqual(ids(squadiSources(plain)));
    expect(squadiSources(linked)).toHaveLength(2);
    // Two labelled feeds, one with a link: the same two season sources, sides intact.
    const pair = [{ label: "McKay", ...IDS, link: SQUADI_PAGE }, { label: "McKain", competitionId: "1844", divisionId: "12960", teamId: 133943 }];
    expect(squadiSources({ squadi: pair }).map((s) => s.side)).toEqual(["McKay", "McKain"]);
  });
});

describe("websiteLinksError — why a save's links cannot be stored", () => {
  it("is null when every link is fine or empty, whatever the shapes", () => {
    expect(websiteLinksError({})).toBeNull();
    expect(websiteLinksError()).toBeNull();
    expect(websiteLinksError({ squadi: null, competitions: null })).toBeNull();
    expect(websiteLinksError({ squadi: { competitionId: "1", link: FQ }, competitions: [{ name: "Winterfest", link: "" }, { name: "Cup" }, null, "x"] })).toBeNull();
    expect(websiteLinksError({ squadi: [{ label: "McKay", link: SQUADI_PAGE }, { label: "McKain" }] })).toBeNull();
  });

  it("names the row whose link is not one", () => {
    expect(websiteLinksError({ squadi: { competitionId: "1", link: "fq.com.au/draw" } })).toBe("Season: " + NOT_A_WEBSITE_LINK);
    expect(websiteLinksError({ squadi: [{ label: "McKay", link: FQ }, { label: " McKain ", link: "http://x.example/y" }] })).toBe("McKain: " + NOT_A_WEBSITE_LINK);
    expect(websiteLinksError({ competitions: [{ name: "Winterfest", link: FQ }, { name: " Premier Invitational ", link: "premierinvitational.dribl.com" }] }))
      .toBe("Premier Invitational: " + NOT_A_WEBSITE_LINK);
    expect(websiteLinksError({ competitions: [{ name: "", link: "x" }] })).toBe("Competition: " + NOT_A_WEBSITE_LINK);
    expect(websiteLinksError({ competitions: [{ name: "Cup", link: "https://x.example/" + "a".repeat(LINK_MAX) }] })).toBe("Cup: " + LINK_TOO_LONG);
  });

  it("the season is checked before the competitions, and the first problem is the one reported", () => {
    expect(websiteLinksError({ squadi: { link: "nope" }, competitions: [{ name: "Cup", link: "nope" }] })).toBe("Season: " + NOT_A_WEBSITE_LINK);
  });
});
