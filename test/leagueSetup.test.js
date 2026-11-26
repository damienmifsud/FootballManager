import { describe, it, expect } from "vitest";
import { sanitizeLeagueSetup, leagueSetupFor, isOriginalTeam, LEGACY_LEAGUE_SETUP, NOT_A_SQUADI_LINK } from "@/lib/leagueSetup";

// lib/leagueSetup guards what /api/league stores as data.squadi (the Squadi
// draw a team's league page embeds) and decides what a team's page works
// from: its own saved set-up or nothing. The old hard-coded default, and the
// ids in it, belong to the original team alone.

const LINK = "https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=o&yearId=8&competitionUniqueKey=c&divisionId=1&teamId=2";
const KEYS = ["mode", "url", "org", "yearId", "comp", "divisionId", "teamId"];

describe("sanitizeLeagueSetup", () => {
  it("keeps a complete builder set-up as sent, with exactly the seven known keys", () => {
    const input = { mode: "builder", url: "", org: "org-key", yearId: "8", comp: "comp-key", divisionId: "10", teamId: "20" };
    const { squadi, error } = sanitizeLeagueSetup(input);
    expect(error).toBeUndefined();
    expect(squadi).toEqual(input);
    expect(Object.keys(squadi)).toEqual(KEYS);
  });

  it("keeps a pasted Squadi link in url mode", () => {
    const { squadi } = sanitizeLeagueSetup({ mode: "url", url: LINK });
    expect(squadi).toEqual({ mode: "url", url: LINK, org: "", yearId: "", comp: "", divisionId: "", teamId: "" });
  });

  it("drops unknown keys, trims and caps the ids, and takes numbers as ids", () => {
    const { squadi } = sanitizeLeagueSetup({
      mode: "builder", org: "  org  ", yearId: 8, comp: "c".repeat(200), divisionId: " All ", teamId: 110013,
      team: { name: "smuggled" }, fixtures: [], players: [{ id: "p1" }], coachPin: "1234"
    });
    expect(Object.keys(squadi)).toEqual(KEYS);
    expect(squadi).toMatchObject({ org: "org", yearId: "8", divisionId: "All", teamId: "110013" });
    expect(squadi.comp).toHaveLength(64);
  });

  it("drops ids that are not strings or numbers rather than stringifying them", () => {
    const { squadi } = sanitizeLeagueSetup({ org: { a: 1 }, yearId: ["8"], comp: null, divisionId: true, teamId: NaN });
    expect(squadi).toEqual({ mode: "builder", url: "", org: "", yearId: "", comp: "", divisionId: "", teamId: "" });
  });

  it("falls back to builder for any mode it does not know", () => {
    for (const mode of [undefined, null, "", "URL", "embed", 1, {}]) {
      expect(sanitizeLeagueSetup({ mode }).squadi.mode).toBe("builder");
    }
    expect(sanitizeLeagueSetup({ mode: "url" }).squadi.mode).toBe("url");
  });

  it("trims a pasted link and stores it in its parsed form", () => {
    expect(sanitizeLeagueSetup({ mode: "url", url: "  " + LINK + "\n" }).squadi.url).toBe(LINK);
    // Host case and a missing path are normalised by the URL parser.
    expect(sanitizeLeagueSetup({ mode: "url", url: "https://Registration.Squadi.com" }).squadi.url).toBe("https://registration.squadi.com/");
  });

  it("accepts squadi.com and its subdomains over https only", () => {
    for (const url of ["https://squadi.com/x", "https://registration.squadi.com/x", "https://a.b.squadi.com/x?y=1"]) {
      expect(sanitizeLeagueSetup({ mode: "url", url }).squadi.url).toBe(url);
    }
  });

  it("refuses anything that is not a Squadi link in url mode, saying why", () => {
    const bad = [
      "http://registration.squadi.com/liveScoreSeasonFixture?x=1", // not https
      "https://evil.example/liveScoreSeasonFixture?x=1",
      "https://registration.squadi.com.evil.example/x", // squadi.com is not the registrable domain
      "https://notsquadi.com/x",
      "https://evil.example/?next=https://registration.squadi.com/",
      "https://registration.squadi.com@evil.example/x", // squadi.com is the username here
      "https://user:pass@registration.squadi.com/x",
      "https://user@registration.squadi.com/x", // a username alone
      "https://:pass@registration.squadi.com/x", // a password alone
      "https://registration.squadi.com:8443/x", // a port
      "https://.squadi.com/x", // an empty label
      "https://registration..squadi.com/x",
      "https://registration.squadi.com./x", // a trailing dot is another name
      "https://xn--squadi-evil.com/x",
      "https://evil.example%2F@registration.squadi.com/x", // a username again, however it is spelt
      "https://squadi.com.au/x",
      "https://squadi.co/x",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//registration.squadi.com/x",
      "registration.squadi.com/liveScoreSeasonFixture?x=1", // no scheme
      "not a link",
      "https://registration.squadi.com/" + "a".repeat(2000), // over the length cap as pasted
      "https://registration.squadi.com/" + "\t".repeat(2000) + "x", // over it as pasted, though the parser would drop the tabs
      "https://registration.squadi.com/" + "é".repeat(400) // under it as pasted, over it once encoded
    ];
    for (const url of bad) {
      expect(sanitizeLeagueSetup({ mode: "url", url }), url).toEqual({ error: NOT_A_SQUADI_LINK });
    }
    expect(NOT_A_SQUADI_LINK).toBe("That is not a Squadi link. It should start with https://registration.squadi.com/");
  });

  it("whatever it keeps parses back to https on squadi.com, by the default port, at any spelling", () => {
    const odd = [
      "https://registration.squadi.com\\liveScoreSeasonFixture?x=1", // a backslash is a slash to the parser
      "https://REGISTRATION.SQUADI.COM:443/liveScoreSeasonFixture", // the default port is no port
      "https://registration.squadi.com/a b?c=d e#f g",
      "\thttps://registration.squadi.com/x\n",
      "https://registration.squadi.com/?next=https://evil.example/",
      "https://registration.squadi.com/" + "é".repeat(100)
    ];
    for (const url of odd) {
      const { squadi, error } = sanitizeLeagueSetup({ mode: "url", url });
      expect(error, url).toBeUndefined();
      const u = new URL(squadi.url);
      expect(u.protocol).toBe("https:");
      expect(u.hostname).toBe("registration.squadi.com");
      expect(u.port + u.username + u.password).toBe("");
      expect(squadi.url.length).toBeLessThanOrEqual(2000);
      // Stored in its parsed form: reading it again changes nothing.
      expect(u.href).toBe(squadi.url);
    }
  });

  it("in builder mode a stray url is dropped instead of blocking the save", () => {
    const { squadi, error } = sanitizeLeagueSetup({ mode: "builder", url: "javascript:alert(1)", comp: "c" });
    expect(error).toBeUndefined();
    expect(squadi).toMatchObject({ mode: "builder", url: "", comp: "c" });
    // A good link is kept for when the coach switches back to it.
    expect(sanitizeLeagueSetup({ mode: "builder", url: LINK, comp: "c" }).squadi.url).toBe(LINK);
  });

  it("an empty set-up is storable: it is how a coach clears the draw", () => {
    expect(sanitizeLeagueSetup({ mode: "url", url: "" })).toEqual({ squadi: { mode: "url", url: "", org: "", yearId: "", comp: "", divisionId: "", teamId: "" } });
    expect(sanitizeLeagueSetup({ mode: "url", url: "   " }).squadi.url).toBe("");
    expect(sanitizeLeagueSetup({ mode: "url", url: 42 }).squadi.url).toBe("");
    expect(sanitizeLeagueSetup({}).squadi).toEqual({ mode: "builder", url: "", org: "", yearId: "", comp: "", divisionId: "", teamId: "" });
  });

  it("refuses input that is not an object", () => {
    for (const input of [null, undefined, "builder", 7, true, [], [{ mode: "url" }]]) {
      expect(sanitizeLeagueSetup(input)).toEqual({ error: "bad request" });
    }
  });

  it("never mutates its input", () => {
    const input = { mode: "url", url: "  " + LINK + "  ", org: " o ", extra: { deep: true } };
    const before = JSON.stringify(input);
    sanitizeLeagueSetup(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("leagueSetupFor", () => {
  const OWN = { mode: "url", url: LINK, org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" };

  it("a team with nothing saved gets nothing: no default, whatever else its document holds", () => {
    expect(leagueSetupFor({ team: { name: "Over 35s" }, players: [], fixtures: [] })).toEqual({ squadi: null, saved: false });
    expect(leagueSetupFor({ team: { name: "Over 35s" } }, { originalTeam: false })).toEqual({ squadi: null, saved: false });
    // No document at all yet.
    expect(leagueSetupFor(null)).toEqual({ squadi: null, saved: false });
    expect(leagueSetupFor(undefined)).toEqual({ squadi: null, saved: false });
  });

  it("a team's own saved set-up comes back as stored", () => {
    expect(leagueSetupFor({ squadi: OWN })).toEqual({ squadi: OWN, saved: true });
    // Older or partial shapes are passed through untouched: the page fills the gaps with blanks.
    expect(leagueSetupFor({ squadi: { mode: "url", url: LINK } })).toEqual({ squadi: { mode: "url", url: LINK }, saved: true });
  });

  it("only the original team falls back to the pre-multi-team default", () => {
    expect(leagueSetupFor({ team: { name: "Original" } }, { originalTeam: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    expect(leagueSetupFor(null, { originalTeam: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    expect(leagueSetupFor({ team: { name: "Original" } }, { originalTeam: false }).squadi).toBeNull();
  });

  it("the original team's own saved set-up wins, key by key, over the default (what the page always did)", () => {
    expect(leagueSetupFor({ squadi: OWN }, { originalTeam: true })).toEqual({ squadi: OWN, saved: true });
    const partial = leagueSetupFor({ squadi: { mode: "url", url: LINK } }, { originalTeam: true });
    expect(partial).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK }, saved: true });
    // Its own ids are its own: nothing is taken out of what it saved.
    expect(leagueSetupFor({ squadi: { ...LEGACY_LEAGUE_SETUP } }, { originalTeam: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: true });
  });

  it("the default is the original team's 2026 draw, frozen", () => {
    expect(LEGACY_LEAGUE_SETUP).toEqual({
      mode: "builder", url: "", org: "b0e92958-980b-4da0-9ec9-a9c2597b06f0", yearId: "8",
      comp: "58ec2bda-ceed-48f2-a33e-5b9d13cc30e8", divisionId: "10661", teamId: "110013"
    });
    expect(Object.isFrozen(LEGACY_LEAGUE_SETUP)).toBe(true);
  });

  it("a squadi that is not an object does not count as a set-up", () => {
    for (const squadi of ["https://registration.squadi.com/x", 7, true, [], [OWN], null]) {
      expect(leagueSetupFor({ squadi })).toEqual({ squadi: null, saved: false });
      expect(leagueSetupFor({ squadi }, { originalTeam: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    }
  });

  it("returns copies: neither the document nor the default can be changed through the result", () => {
    const doc = { squadi: { ...OWN } };
    const a = leagueSetupFor(doc);
    a.squadi.url = "changed";
    expect(doc.squadi.url).toBe(LINK);
    const b = leagueSetupFor(null, { originalTeam: true });
    b.squadi.teamId = "1";
    expect(LEGACY_LEAGUE_SETUP.teamId).toBe("110013");
  });
});

// The old page's form started from the hard-coded default on every team and
// saved the whole form, so a team that pressed save under it still holds the
// original team's ids in its own stored set-up.
describe("leagueSetupFor — the old default left in another team's saved set-up", () => {
  const L = LEGACY_LEAGUE_SETUP;
  const BLANK_IDS = { comp: "", divisionId: "", teamId: "" };

  it("a team that saved the old default unchanged counts as not set up at all", () => {
    expect(leagueSetupFor({ squadi: { ...L } })).toEqual({ squadi: null, saved: false });
    // The same with the form flipped to Paste full URL and nothing pasted.
    expect(leagueSetupFor({ squadi: { ...L, mode: "url" } })).toEqual({ squadi: null, saved: false });
  });

  it("a team that pasted its own link keeps it; the original team's ids beside it are taken out", () => {
    const stored = { ...L, mode: "url", url: LINK };
    expect(leagueSetupFor({ squadi: stored })).toEqual({ squadi: { ...stored, ...BLANK_IDS }, saved: true });
    // The region and the year are nobody's: they stay.
    expect(leagueSetupFor({ squadi: stored }).squadi).toMatchObject({ org: L.org, yearId: L.yearId, url: LINK, mode: "url" });
  });

  it("the pin on the original team goes even when the coach changed the competition or the division", () => {
    const ownComp = { ...L, comp: "their-comp" };
    expect(leagueSetupFor({ squadi: ownComp })).toEqual({ squadi: { ...ownComp, teamId: "" }, saved: true });
    const ownDivision = { ...L, divisionId: "777" };
    expect(leagueSetupFor({ squadi: ownDivision })).toEqual({ squadi: { ...ownDivision, teamId: "" }, saved: true });
  });

  it("a team in the same competition and division with its own team id is left exactly as saved", () => {
    const sameHub = { ...L, teamId: "110012" };
    expect(leagueSetupFor({ squadi: sameHub })).toEqual({ squadi: sameHub, saved: true });
    const noPin = { ...L, teamId: "" };
    expect(leagueSetupFor({ squadi: noPin })).toEqual({ squadi: noPin, saved: true });
  });

  it("reads the stored pin loosely (a number, stray spaces) and never changes the document", () => {
    const doc = { squadi: { ...L, teamId: 110013, divisionId: " 10661 " } };
    const before = JSON.stringify(doc);
    expect(leagueSetupFor(doc)).toEqual({ squadi: null, saved: false });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("isOriginalTeam", () => {
  it("reads the sync ids through the feeds rule: either of a two-team squad's feeds can be the original team's", () => {
    const other = { label: "Blue", competitionId: "1439", divisionId: "10662", teamId: 110014 };
    const original = { label: "White", competitionId: "1439", divisionId: "10661", teamId: 110013 };
    expect(isOriginalTeam({ slug: "u8", squadi: [other, original] }, "someone-else")).toBe(true);
    expect(isOriginalTeam({ slug: "u8", squadi: [original, other] }, "someone-else")).toBe(true);
    expect(isOriginalTeam({ slug: "u8", squadi: [other, { ...other, label: "Red", teamId: 110015 }] }, "someone-else")).toBe(false);
    // Stored as a string, or with nothing usable, it still reads right.
    expect(isOriginalTeam({ slug: "u8", squadi: { competitionId: "1439", divisionId: "10661", teamId: "110013" } }, "someone-else")).toBe(true);
    expect(isOriginalTeam({ slug: "u8", squadi: [] }, "someone-else")).toBe(false);
    expect(isOriginalTeam({ slug: "u8", squadi: "110013" }, "someone-else")).toBe(false);
  });

  it("the legacy owner is the original team", () => {
    expect(isOriginalTeam({ slug: "kangaroos-white" }, "kangaroos-white")).toBe(true);
    expect(isOriginalTeam({ slug: "default", squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 } }, "default")).toBe(true);
    // Whatever its sync ids say (next season's, for one): the legacy owner stays the original team.
    expect(isOriginalTeam({ slug: "kangaroos-white", squadi: { competitionId: "2000", divisionId: "20000", teamId: 220000 } }, "kangaroos-white")).toBe(true);
  });

  it("so is a team whose own Squadi sync ids are the original team's, under any slug", () => {
    expect(isOriginalTeam({ slug: "u8-white", squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 } }, "something-else")).toBe(true);
    expect(isOriginalTeam({ slug: "u8-white", squadi: { teamId: "110013" } }, null)).toBe(true);
  });

  it("no other team is", () => {
    expect(isOriginalTeam({ slug: "over-35s" }, "kangaroos-white")).toBe(false);
    expect(isOriginalTeam({ slug: "over-35s", squadi: { competitionId: "1251", divisionId: "9000", teamId: 120000 } }, "kangaroos-white")).toBe(false);
    expect(isOriginalTeam({ slug: "u8-red", squadi: { competitionId: "1439", divisionId: "10661", teamId: 110012 } }, "kangaroos-white")).toBe(false);
    // A wizard-only club has no legacy owner; a team with no slug or no sync ids is nobody.
    expect(isOriginalTeam({ slug: "over-35s" }, null)).toBe(false);
    expect(isOriginalTeam({ slug: "over-35s", squadi: { teamId: 0 } }, null)).toBe(false);
    expect(isOriginalTeam({}, undefined)).toBe(false);
    expect(isOriginalTeam({ slug: "" }, "")).toBe(false);
    expect(isOriginalTeam(null, "kangaroos-white")).toBe(false);
  });
});
