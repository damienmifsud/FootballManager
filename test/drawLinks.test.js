import { describe, it, expect } from "vitest";
import { drawLinks, sanitizeCompetitions, squadiFeeds, squadiSources, driblSources } from "@/lib/competitions";

// Every draw a team has a website link for, as the league page lists them: the
// season's (each side of a two-team squad), then each other competition's.
// The link is the draw's website link from the wizard; `provider` says whether
// it is a page on Squadi or Dribl. Every id, key and name here is made up.

const IDS = { competitionId: "777", divisionId: "20001", teamId: 300001 };
const SQ = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&yearId=8&competitionUniqueKey=11111111-2222-4333-8444-555555555555&divisionId=20001&teamId=300001";
const SQ2 = SQ.replace("teamId=300001", "teamId=300002");
const DR = "https://winterleague.dribl.com/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FBrisbane";
const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FBrisbane";
const SITE = "https://www.example.org/winter-cup/draw";

describe("drawLinks — every draw a team has a link for", () => {
  it("lists the season, then each competition by name, with the service its link is a page of", () => {
    const team = {
      squadi: { ...IDS, link: SQ },
      competitions: [
        { id: "c1", name: "Winter League", dribl: { url: REQUEST }, link: DR },
        { id: "c2", name: "State Cup", squadi: { competitionId: "888", divisionId: "20002", teamId: 300009 }, link: SQ2 },
        { id: "c3", name: "Winter Cup", link: SITE },
        { id: "c4", name: "No link yet", squadi: IDS }
      ]
    };
    expect(drawLinks(team)).toEqual([
      { name: "Season", provider: "squadi", link: SQ, season: true },
      { name: "Winter League", provider: "dribl", link: DR },
      { name: "State Cup", provider: "squadi", link: SQ2 },
      { name: "Winter Cup", provider: "", link: SITE }
    ]);
  });

  it("names each side of a two-team squad, and passes nothing but the name, the service, the link and which draw it is", () => {
    const team = { squadi: [{ label: "Reds", ...IDS, link: SQ }, { label: "Blues", ...IDS, teamId: 300002, link: SQ2 }] };
    expect(drawLinks(team)).toEqual([
      { name: "Season · Reds", provider: "squadi", link: SQ, season: true, side: "Reds" },
      { name: "Season · Blues", provider: "squadi", link: SQ2, season: true, side: "Blues" }
    ]);
    expect(Object.keys(drawLinks(team)[0]).sort()).toEqual(["link", "name", "provider", "season", "side"]);
    // One side with a link, the other without: only the one is listed.
    expect(drawLinks({ squadi: [{ label: "Reds", ...IDS }, { label: "Blues", ...IDS, teamId: 300002, link: SQ2 }] })).toEqual([
      { name: "Season · Blues", provider: "squadi", link: SQ2, season: true, side: "Blues" }
    ]);
  });

  it("lists a season that has only its link so far, and a link to a site that is neither service", () => {
    expect(drawLinks({ squadi: { link: SITE } })).toEqual([{ name: "Season", provider: "", link: SITE, season: true }]);
    expect(drawLinks({ squadi: { link: DR } })).toEqual([{ name: "Season", provider: "dribl", link: DR, season: true }]);
  });

  it("is empty for a team with no links, and never passes on something that is not a web address", () => {
    expect(drawLinks({ squadi: IDS, competitions: [{ id: "c1", name: "Cup" }, { id: "c2", name: "Other", dribl: { url: REQUEST } }] })).toEqual([]);
    expect(drawLinks(null)).toEqual([]);
    expect(drawLinks({})).toEqual([]);
    expect(drawLinks({ competitions: [null, "x", ["y"], { id: "c1", name: "Cup", link: "javascript:alert(1)" }, { id: "c2", name: "Other", link: "http://example.org/draw" },
      { id: "c3", name: "Third", link: "https://user:pass@example.org/" }, { id: "c4", name: "Fourth", link: 42 }] })).toEqual([]);
    expect(drawLinks({ competitions: [{ id: "c5", link: `  ${DR}  ` }] })).toEqual([{ name: "Competition", provider: "dribl", link: DR }]);
  });

  it("never lists a Dribl fixtures request: that is what the sync fetches, not a page to open", () => {
    const team = { competitions: [{ id: "c1", name: "Winter League", dribl: { url: REQUEST, team: "Riverside FC U8 Blues" } }] };
    expect(drawLinks(team)).toEqual([]);
    expect(JSON.stringify(drawLinks({ competitions: [{ id: "c1", name: "Winter League", dribl: { url: REQUEST }, link: DR }] }))).not.toContain("mc-api");
  });
});

describe("a draw set up from its link — what is stored and what is synced", () => {
  it("a competition keeps its Dribl request, its team and its page link together", () => {
    const [stored] = sanitizeCompetitions([{ name: "Winter League", dribl: { url: REQUEST, team: " Riverside FC U8 Blues " }, link: `  ${DR} ` }], () => "cnew00001");
    expect(stored).toEqual({ id: "cnew00001", name: "Winter League", dribl: { url: REQUEST, team: "Riverside FC U8 Blues" }, link: DR });
    expect(driblSources({ competitions: [stored] })).toEqual([{ comp: { id: "cnew00001", name: "Winter League" }, dribl: { url: REQUEST, team: "Riverside FC U8 Blues" } }]);
  });

  it("a link changes nothing about what is synced: the ids and the request decide", () => {
    const withLink = { squadi: { ...IDS, link: SQ }, competitions: [{ id: "c1", name: "State Cup", squadi: { competitionId: "888", divisionId: "20002", teamId: 300009 }, link: SQ2 }, { id: "c2", name: "Winter Cup", link: DR }] };
    const without = { squadi: IDS, competitions: [{ id: "c1", name: "State Cup", squadi: { competitionId: "888", divisionId: "20002", teamId: 300009 } }, { id: "c2", name: "Winter Cup" }] };
    const idsOnly = (sources) => sources.map(({ comp, side, squadi }) => ({ comp, side, ids: [squadi.competitionId, squadi.divisionId, squadi.teamId] }));
    expect(idsOnly(squadiSources(withLink))).toEqual(idsOnly(squadiSources(without)));
    // A page link on its own is not a Dribl source: nothing is fetched until the request is there.
    expect(driblSources(withLink)).toEqual([]);
    expect(squadiFeeds(withLink)).toEqual([{ ...IDS, link: SQ }]);
  });
});
