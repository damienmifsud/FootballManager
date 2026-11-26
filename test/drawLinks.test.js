import { describe, it, expect } from "vitest";
import { sanitizeSquadiIds, sanitizeCompetitions, squadiFeeds, squadiSources, drawLinks } from "@/lib/competitions";

// A draw keeps the fixtures link it was set up from (lib/feedLinks.js): a
// Squadi draw beside its ids, a Dribl competition as the link and what it
// names. In a file of its own, beside test/competitions.test.js. Every key
// and id is made up.

const KEY = "11111111-2222-4333-8444-555555555555";
const SQ = `https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const SQ2 = `https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=${KEY}&divisionId=20002&teamId=300002`;
const DR = "https://winterleague.dribl.com/fixtures?season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468";
const DRIBL = { link: DR, site: "winterleague", season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468" };
const IDS = { competitionId: "777", divisionId: "20001", teamId: 300001 };
const counter = () => { let n = 0; return () => `cnew${++n}`; };

describe("sanitizeSquadiIds — the link beside the ids", () => {
  it("keeps a Squadi link, normalised, and nothing that is not one", () => {
    expect(sanitizeSquadiIds({ ...IDS, link: `  ${SQ} ` })).toEqual({ ...IDS, link: SQ });
    for (const link of [DR, "https://example.com/x", "javascript:alert(1)", "", null, 7, { href: SQ }]) {
      expect(sanitizeSquadiIds({ ...IDS, link })).toEqual(IDS);
    }
  });

  it("a link with no ids is nothing the sync could use, so it is not a draw", () => {
    expect(sanitizeSquadiIds({ link: SQ })).toBeNull();
  });
});

describe("sanitizeCompetitions — a competition on Dribl", () => {
  it("is kept as its link and what the link names, rebuilt from the link itself", () => {
    const out = sanitizeCompetitions([{ name: "Premier Invitational", dribl: { link: DR, site: "someone-else", club: "<b>" } }], counter());
    expect(out).toEqual([{ id: "cnew1", name: "Premier Invitational", dribl: DRIBL }]);
  });

  it("is kept even with no name yet, and dropped when the link is not a Dribl one", () => {
    expect(sanitizeCompetitions([{ name: "", dribl: { link: DR } }], counter())).toEqual([{ id: "cnew1", name: "Competition 1", dribl: DRIBL }]);
    expect(sanitizeCompetitions([{ name: "", dribl: { link: SQ } }, { name: " ", dribl: { link: "https://example.com/" } }, { name: "", dribl: null }], counter())).toEqual([]);
    expect(sanitizeCompetitions([{ name: "Cup", dribl: { link: "nope" } }], counter())).toEqual([{ id: "cnew1", name: "Cup" }]);
  });

  it("is one draw to a row: Squadi ids sent with a Dribl link win, and the Squadi link is kept with them", () => {
    const out = sanitizeCompetitions([{ id: "cwinter", name: "Winterfest", squadi: { ...IDS, link: SQ }, dribl: { link: DR } }], counter());
    expect(out).toEqual([{ id: "cwinter", name: "Winterfest", squadi: { ...IDS, link: SQ } }]);
  });
});

describe("squadiFeeds and squadiSources — links do not change what is synced", () => {
  it("a season feed carries its link; two labelled feeds carry one each", () => {
    expect(squadiFeeds({ squadi: { ...IDS, link: SQ } })).toEqual([{ ...IDS, link: SQ }]);
    expect(squadiFeeds({ squadi: [{ label: "Red", ...IDS, link: SQ }, { label: "White", competitionId: "777", divisionId: "20002", teamId: 300002, link: SQ2 }] }))
      .toEqual([{ label: "Red", ...IDS, link: SQ }, { label: "White", competitionId: "777", divisionId: "20002", teamId: 300002, link: SQ2 }]);
    expect(squadiFeeds({ squadi: { ...IDS, link: DR } })).toEqual([IDS]); // a link from another site is not carried
    expect(squadiFeeds({ squadi: IDS })).toEqual([IDS]);                  // and none is none
  });

  it("a Squadi draw with a link is a source as before; a Dribl competition never is", () => {
    const team = { squadi: { ...IDS, link: SQ }, competitions: [
      { id: "cdribl", name: "Premier Invitational", dribl: DRIBL },
      { id: "cwinter", name: "Winterfest", squadi: { competitionId: "888", divisionId: "30001", teamId: 400001, link: SQ2 } }
    ] };
    const sources = squadiSources(team);
    expect(sources.map((s) => [s.comp ? s.comp.name : "Season", s.squadi.competitionId])).toEqual([["Season", "777"], ["Winterfest", "888"]]);
    // The same draw set up twice, once with a link and once without, is still one source.
    expect(squadiSources({ squadi: { ...IDS, link: SQ }, competitions: [{ id: "c1", name: "Copy", squadi: IDS }] })).toHaveLength(1);
  });
});

describe("drawLinks — every draw a team has a link for", () => {
  it("lists the season, then each competition by name, with the site it is on", () => {
    const team = { squadi: { ...IDS, link: SQ }, competitions: [
      { id: "cdribl", name: "Premier Invitational", dribl: DRIBL },
      { id: "cwinter", name: "Winterfest", squadi: { competitionId: "888", divisionId: "30001", teamId: 400001, link: SQ2 } },
      { id: "cno", name: "No link", squadi: { competitionId: "999", divisionId: "1", teamId: 2 } },
      { id: "cname", name: "Name only" }
    ] };
    expect(drawLinks(team)).toEqual([
      { name: "Season", provider: "squadi", link: SQ, season: true },
      { name: "Premier Invitational", provider: "dribl", link: DR },
      { name: "Winterfest", provider: "squadi", link: SQ2 }
    ]);
  });

  it("names each side of a two-team squad, and holds no ids", () => {
    const team = { squadi: [{ label: "Red", ...IDS, link: SQ }, { label: "White", competitionId: "777", divisionId: "20002", teamId: 300002, link: SQ2 }] };
    expect(drawLinks(team)).toEqual([
      { name: "Season · Red", provider: "squadi", link: SQ, season: true, side: "Red" },
      { name: "Season · White", provider: "squadi", link: SQ2, season: true, side: "White" }
    ]);
    expect(Object.keys(drawLinks(team)[0]).sort()).toEqual(["link", "name", "provider", "season", "side"]);
  });

  it("is empty for a team with no links, and never passes on a link that is not one of the two sites'", () => {
    expect(drawLinks({ squadi: IDS, competitions: [{ id: "c1", name: "Cup" }] })).toEqual([]);
    expect(drawLinks(null)).toEqual([]);
    expect(drawLinks({ competitions: [null, "x", { id: "c1", name: "Cup", dribl: { link: "https://example.com/" } }, { id: "c2", name: "Other", squadi: { ...IDS, link: "javascript:alert(1)" } }] })).toEqual([]);
    expect(drawLinks({ competitions: [{ id: "c3", dribl: { link: DR } }] })).toEqual([{ name: "Competition", provider: "dribl", link: DR }]);
  });
});
