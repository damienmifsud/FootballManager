import { describe, it, expect } from "vitest";
import { parseFeedLink, feedProvider, storedFeedLink, sanitizeDribl, NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM, DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";

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
  it("gives the competition's site and the season, competition, league and club it names", () => {
    expect(parseFeedLink(DRIBL)).toEqual({
      provider: "dribl", link: DRIBL, site: "winterleague", season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468"
    });
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

describe("feedProvider and storedFeedLink — a link as it is kept", () => {
  it("names the site a link is on", () => {
    expect([feedProvider(SQUADI), feedProvider(DRIBL), feedProvider("https://example.com/"), feedProvider("nope"), feedProvider(null)]).toEqual(["squadi", "dribl", "", "", ""]);
  });

  it("keeps a link only as its own site's, normalised, and drops everything else", () => {
    expect(storedFeedLink(`  ${SQUADI}  `, "squadi")).toBe(SQUADI);
    expect(storedFeedLink(DRIBL, "dribl")).toBe(DRIBL);
    expect(storedFeedLink(DRIBL, "squadi")).toBe("");
    expect(storedFeedLink(SQUADI, "dribl")).toBe("");
    expect(storedFeedLink("https://example.com/", "squadi")).toBe("");
    expect(storedFeedLink("javascript:alert(1)", "squadi")).toBe("");
    expect(storedFeedLink(undefined, "squadi")).toBe("");
  });
});

describe("sanitizeDribl — a competition's Dribl draw as the registry keeps it", () => {
  const kept = { link: DRIBL, site: "winterleague", season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468" };

  it("is rebuilt from the link itself, so what is stored cannot disagree with it", () => {
    expect(sanitizeDribl({ link: DRIBL })).toEqual(kept);
    expect(sanitizeDribl(DRIBL)).toEqual(kept);
    // Identifiers sent alongside the link are ignored: the link is the truth.
    expect(sanitizeDribl({ link: DRIBL, site: "evil", season: "x", competition: "y", club: "<script>", extra: 1 })).toEqual(kept);
  });

  it("is nothing when there is no Dribl link", () => {
    for (const input of [null, undefined, {}, { link: "" }, { link: SQUADI }, { link: "https://example.com/" }, { site: "winterleague", competition: "1pQrStUv90" }, [], "nope"]) {
      expect(sanitizeDribl(input)).toBeNull();
    }
  });
});
