import { describe, it, expect } from "vitest";
import { sanitizeLeagueSetup, leagueSetupFor, LEGACY_LEAGUE_SETUP, NOT_A_SQUADI_LINK } from "@/lib/leagueSetup";

// lib/leagueSetup guards what /api/league stores as data.squadi (the Squadi
// draw a team's league page embeds) and decides what a team's page works
// from: its own saved set-up or nothing, with the old hard-coded default left
// to the legacy owner alone.

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
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//registration.squadi.com/x",
      "registration.squadi.com/liveScoreSeasonFixture?x=1", // no scheme
      "not a link",
      "https://registration.squadi.com/" + "a".repeat(2000) // over the length cap
    ];
    for (const url of bad) {
      expect(sanitizeLeagueSetup({ mode: "url", url }), url).toEqual({ error: NOT_A_SQUADI_LINK });
    }
    expect(NOT_A_SQUADI_LINK).toBe("That is not a Squadi link. It should start with https://registration.squadi.com/");
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
    expect(leagueSetupFor({ team: { name: "Over 35s" } }, { legacyOwner: false })).toEqual({ squadi: null, saved: false });
    // No document at all yet.
    expect(leagueSetupFor(null)).toEqual({ squadi: null, saved: false });
    expect(leagueSetupFor(undefined)).toEqual({ squadi: null, saved: false });
  });

  it("a team's own saved set-up comes back as stored", () => {
    expect(leagueSetupFor({ squadi: OWN })).toEqual({ squadi: OWN, saved: true });
    // Older or partial shapes are passed through untouched: the page fills the gaps with blanks.
    expect(leagueSetupFor({ squadi: { mode: "url", url: LINK } })).toEqual({ squadi: { mode: "url", url: LINK }, saved: true });
  });

  it("only the legacy owner falls back to the pre-multi-team default", () => {
    expect(leagueSetupFor({ team: { name: "Original" } }, { legacyOwner: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    expect(leagueSetupFor(null, { legacyOwner: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    expect(leagueSetupFor({ team: { name: "Original" } }, { legacyOwner: false }).squadi).toBeNull();
  });

  it("the legacy owner's own saved set-up wins, key by key, over the default (what the page always did)", () => {
    expect(leagueSetupFor({ squadi: OWN }, { legacyOwner: true })).toEqual({ squadi: OWN, saved: true });
    const partial = leagueSetupFor({ squadi: { mode: "url", url: LINK } }, { legacyOwner: true });
    expect(partial).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP, mode: "url", url: LINK }, saved: true });
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
      expect(leagueSetupFor({ squadi }, { legacyOwner: true })).toEqual({ squadi: { ...LEGACY_LEAGUE_SETUP }, saved: false });
    }
  });

  it("returns copies: neither the document nor the default can be changed through the result", () => {
    const doc = { squadi: { ...OWN } };
    const a = leagueSetupFor(doc);
    a.squadi.url = "changed";
    expect(doc.squadi.url).toBe(LINK);
    const b = leagueSetupFor(null, { legacyOwner: true });
    b.squadi.teamId = "1";
    expect(LEGACY_LEAGUE_SETUP.teamId).toBe("110013");
  });
});
