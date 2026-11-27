import { describe, it, expect } from "vitest";
import { parseFeedLink, feedProvider, NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM, DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";

// A team's fixtures link, pasted into the wizard: which site it is and the
// identifiers it carries. Reading a link makes no request. The keys and ids
// here are made up in the shapes the two sites use.

const KEY = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SQUADI = `https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=${ORG}&yearId=8&competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const DRIBL = "https://winterleague.dribl.com/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FBrisbane";

describe("parseFeedLink — a Squadi link", () => {
  it("gives the competition's key, the division and the team, with the organisation and year when they are there", () => {
    expect(parseFeedLink(SQUADI)).toEqual({
      provider: "squadi", link: SQUADI, competitionKey: KEY, divisionId: "20001", teamId: "300001", organisationKey: ORG, yearId: "8"
    });
  });

  it("reads the link whatever order its parts are in, with space around it, and whatever case the key is written in", () => {
    const shuffled = `  https://registration.squadi.com/liveScoreSeasonFixture?teamId=300001&divisionId=20001&competitionUniqueKey=${KEY.toUpperCase()}\n`;
    expect(parseFeedLink(shuffled)).toMatchObject({ provider: "squadi", competitionKey: KEY, divisionId: "20001", teamId: "300001", organisationKey: "", yearId: "" });
    expect(KEY.toUpperCase()).not.toBe(KEY); // the key above was typed in capitals and comes back in lower case, as Squadi writes it
    expect(parseFeedLink(SQUADI.replace(ORG, ORG.toUpperCase())).organisationKey).toBe(ORG);
  });

  it("must name one team: a whole division, a whole competition or a missing key is sent back with what to do", () => {
    const without = (name) => { const u = new URL(SQUADI); u.searchParams.delete(name); return u.href; };
    const withValue = (name, value) => { const u = new URL(SQUADI); u.searchParams.set(name, value); return u.href; };
    for (const link of [without("teamId"), without("divisionId"), without("competitionUniqueKey"), withValue("divisionId", "All"), withValue("teamId", "0"),
      withValue("teamId", "12abc"), withValue("competitionUniqueKey", "1439"), "https://registration.squadi.com/"]) {
      expect(parseFeedLink(link)).toEqual({ error: SQUADI_NEEDS_TEAM });
    }
  });

  it("is any page on squadi.com that carries those parts, and nothing that only looks like it", () => {
    const query = SQUADI.slice(SQUADI.indexOf("?"));
    expect(parseFeedLink("https://registration.squadi.com/liveScorePublicLadder" + query).provider).toBe("squadi");
    expect(parseFeedLink("https://squadi.com/x" + query).provider).toBe("squadi");
    for (const link of ["https://squadi.com.example.com/x" + query, "https://notsquadi.com/x" + query, "https://registration.squadi.com.au/x" + query,
      "http://registration.squadi.com/x" + query, "https://user:pass@registration.squadi.com/x" + query, "https://registration.squadi.com:8443/x" + query]) {
      expect(parseFeedLink(link)).toEqual({ error: NOT_A_FEED_LINK });
    }
  });
});

describe("parseFeedLink — a Dribl link", () => {
  it("gives the match centre's address and the season, competition, league, club and timezone it names", () => {
    expect(parseFeedLink(DRIBL)).toEqual({
      provider: "dribl", link: DRIBL, host: "winterleague.dribl.com", site: "winterleague",
      season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468", timezone: "Australia/Brisbane"
    });
  });

  it("takes a timezone only when it reads as one, and the host in lower case whatever was typed", () => {
    const withZone = (zone) => parseFeedLink(`https://winterleague.dribl.com/fixtures?competition=1pQrStUv90&timezone=${encodeURIComponent(zone)}`).timezone;
    expect(["Australia/Sydney", "America/Argentina/Buenos_Aires", "Etc/GMT+10"].map(withZone)).toEqual(["Australia/Sydney", "America/Argentina/Buenos_Aires", "Etc/GMT+10"]);
    expect(["Brisbane", "Australia/", "/Brisbane", "Australia/Bris bane", "../../etc", "Australia/Brisbane&tenant=x", ""].map(withZone)).toEqual(["", "", "", "", "", "", ""]);
    expect(parseFeedLink("https://winterleague.dribl.com/fixtures?competition=1pQrStUv90").timezone).toBe("");
    expect(parseFeedLink("https://WinterLeague.Dribl.com/fixtures?competition=1pQrStUv90")).toMatchObject({ host: "winterleague.dribl.com", site: "winterleague" });
    expect(parseFeedLink("https://cup.winterleague.dribl.com/fixtures?competition=1pQrStUv90")).toMatchObject({ host: "cup.winterleague.dribl.com", site: "cup" });
  });

  it("keeps a link that names only part of that, and refuses one that names none of it", () => {
    expect(parseFeedLink("https://winterleague.dribl.com/fixtures?competition=1pQrStUv90")).toMatchObject({ provider: "dribl", season: "", competition: "1pQrStUv90", league: "", club: "" });
    expect(parseFeedLink("https://winterleague.dribl.com/fixtures?club=MnOpQr2468")).toMatchObject({ provider: "dribl", club: "MnOpQr2468" });
    for (const link of ["https://winterleague.dribl.com/fixtures", "https://winterleague.dribl.com/fixtures?date_range=all&timezone=Australia%2FBrisbane",
      "https://winterleague.dribl.com/fixtures?competition=has spaces", "https://winterleague.dribl.com/fixtures?competition=../../x"]) {
      expect(parseFeedLink(link)).toEqual({ error: DRIBL_NEEDS_COMPETITION });
    }
  });

  it("is a competition's own site on dribl.com, and nothing that only looks like it", () => {
    const query = DRIBL.slice(DRIBL.indexOf("?"));
    expect(parseFeedLink("https://fq.dribl.com/ladders" + query).site).toBe("fq");
    // Dribl's API host is not a page: its fixtures request has a field of its own.
    expect(parseFeedLink("https://mc-api.dribl.com/api/fixtures" + query + "&tenant=AbCd1234")).toEqual({ error: NOT_A_FEED_LINK });
    for (const link of ["https://dribl.com/fixtures" + query, "https://dribl.com.example.com/fixtures" + query, "https://winterleague.dribl.co/fixtures" + query,
      "http://winterleague.dribl.com/fixtures" + query, "https://x@winterleague.dribl.com/fixtures" + query]) {
      expect(parseFeedLink(link)).toEqual({ error: NOT_A_FEED_LINK });
    }
  });
});

describe("parseFeedLink — anything else", () => {
  it("is not a fixtures link, said the same way whatever it was", () => {
    for (const raw of ["", "   ", "squadi", "registration.squadi.com/liveScoreSeasonFixture?teamId=1", "javascript:alert(1)", "https://example.com/fixtures?competition=1pQrStUv90",
      "ftp://registration.squadi.com/x", null, undefined, 42, {}, ["https://registration.squadi.com/"], "https://registration.squadi.com/?" + "a".repeat(2100)]) {
      expect(parseFeedLink(raw)).toEqual({ error: NOT_A_FEED_LINK });
    }
  });
});

describe("feedProvider — which site a link is a page of", () => {
  it("names Squadi or Dribl, and nothing for any other site, Dribl's API host, or text that is not a link", () => {
    expect([feedProvider(SQUADI), feedProvider(`  ${DRIBL}\n`), feedProvider("https://example.com/"), feedProvider("nope"), feedProvider(null)]).toEqual(["squadi", "dribl", "", "", ""]);
    expect(feedProvider("https://mc-api.dribl.com/api/fixtures?tenant=AbCd1234")).toBe("");
    expect(feedProvider("https://MC-API.dribl.com/api/fixtures?tenant=AbCd1234")).toBe("");
    expect(feedProvider("http://winterleague.dribl.com/fixtures")).toBe("");
    // A link longer than a website link may be is not one.
    expect(feedProvider("https://registration.squadi.com/?" + "a".repeat(1000))).toBe("");
  });
});

describe("a Majestri link", () => {
  it("is a page on a club's Majestri site; a competition's page names its competition, and a team's page its team", () => {
    const comp = "https://riversidefc.majestri.com.au/comp-summary?compID=9001";
    expect(feedProvider(comp)).toBe("majestri");
    expect(parseFeedLink(comp)).toEqual({ provider: "majestri", link: comp, host: "riversidefc.majestri.com.au", compId: "9001", teamId: "" });
    expect(parseFeedLink("https://riversidefc.majestri.com.au/team-summary?teamID=7001&compID=9001")).toMatchObject({ provider: "majestri", compId: "9001", teamId: "7001" });
    expect(parseFeedLink("https://riversidefc.majestri.com.au/")).toEqual({ error: "That Majestri link does not name a competition. Open the competition's page (its address has compID in it) and copy the address again." });
    for (const notOne of ["https://majestri.com.au/comp-summary?compID=9001", "http://riversidefc.majestri.com.au/comp-summary?compID=9001", "https://riversidefc.majestri.com.au.example.com/comp-summary?compID=9001"]) {
      expect(feedProvider(notOne)).toBe("");
      expect(parseFeedLink(notOne)).toEqual({ error: NOT_A_FEED_LINK });
    }
    expect(NOT_A_FEED_LINK).toBe("That is not a Squadi, Dribl or Majestri link. Open your team's fixtures page there, copy its address and paste it here.");
  });
});
