import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTeams, teamByPassword, teamByCalendarKey, teamBySlug, teamFromCookieHeader } from "@/lib/teams";

// getTeams() and its lookups read process.env at call time, so each test sets
// the env it needs. Snapshot and restore the keys we touch.
const KEYS = ["TEAMS", "SITE_PASSWORD", "CALENDAR_KEY", "SQUADI_COMPETITION_ID", "SQUADI_DIVISION_ID", "SQUADI_TEAM_ID"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});

const TEAM_A = { slug: "a", name: "Team A", password: "code-a", calendarKey: "key-a", squadi: { competitionId: "1", divisionId: "2", teamId: 3 } };
const TEAM_B = { slug: "b", name: "Team B", password: "code-b", calendarKey: "key-b" };

describe("getTeams — multi-team mode", () => {
  it("parses the TEAMS env var into a team list", () => {
    process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]);
    const teams = getTeams();
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({ slug: "a", password: "code-a" });
  });

  it("drops entries missing a slug or password", () => {
    process.env.TEAMS = JSON.stringify([TEAM_A, { name: "no slug", password: "x" }, { slug: "y" }]);
    const teams = getTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].slug).toBe("a");
  });

  it("falls back to legacy mode and logs when TEAMS is invalid JSON", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TEAMS = "{not json";
    process.env.SITE_PASSWORD = "legacy-code";
    const teams = getTeams();
    expect(err).toHaveBeenCalled();
    expect(teams).toHaveLength(1);
    expect(teams[0].slug).toBe("default");
  });

  it("falls through to legacy mode when TEAMS is an empty array", () => {
    process.env.TEAMS = "[]";
    process.env.SITE_PASSWORD = "legacy-code";
    expect(getTeams()[0].slug).toBe("default");
  });
});

describe("getTeams — legacy single-team mode", () => {
  it("builds a default team from SITE_PASSWORD with squadi defaults", () => {
    process.env.SITE_PASSWORD = "legacy-code";
    process.env.CALENDAR_KEY = "legacy-key";
    const [t] = getTeams();
    expect(t).toMatchObject({
      slug: "default", name: "Team", password: "legacy-code", calendarKey: "legacy-key", legacy: true,
      squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 }
    });
  });

  it("honours overridden squadi env vars", () => {
    process.env.SITE_PASSWORD = "legacy-code";
    process.env.SQUADI_COMPETITION_ID = "99";
    process.env.SQUADI_TEAM_ID = "42";
    expect(getTeams()[0].squadi).toMatchObject({ competitionId: "99", teamId: 42 });
  });

  it("returns an empty list when no team env is configured", () => {
    expect(getTeams()).toEqual([]);
  });
});

describe("team lookups", () => {
  beforeEach(() => { process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]); });

  it("teamByPassword resolves the team selector", () => {
    expect(teamByPassword("code-b")?.slug).toBe("b");
    expect(teamByPassword("nope")).toBeNull();
    expect(teamByPassword("")).toBeNull();
  });

  it("teamByCalendarKey only matches a non-empty key", () => {
    expect(teamByCalendarKey("key-a")?.slug).toBe("a");
    expect(teamByCalendarKey("")).toBeNull();
    expect(teamByCalendarKey("unknown")).toBeNull();
  });

  it("teamByCalendarKey never matches a team with an empty calendarKey via an empty key", () => {
    process.env.TEAMS = JSON.stringify([{ slug: "c", name: "C", password: "p", calendarKey: "" }]);
    expect(teamByCalendarKey("")).toBeNull();
  });

  it("teamBySlug resolves by slug", () => {
    expect(teamBySlug("a")?.name).toBe("Team A");
    expect(teamBySlug("missing")).toBeNull();
    expect(teamBySlug("")).toBeNull();
  });
});

describe("teamFromCookieHeader", () => {
  beforeEach(() => { process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]); });

  it("resolves the team from the site_auth cookie value", () => {
    expect(teamFromCookieHeader("site_auth=code-a")?.slug).toBe("a");
  });

  it("picks site_auth out of a multi-cookie header", () => {
    expect(teamFromCookieHeader("team_slug=a; site_auth=code-b; other=1")?.slug).toBe("b");
  });

  it("URL-decodes the cookie value before matching", () => {
    process.env.TEAMS = JSON.stringify([{ slug: "x", name: "X", password: "co de+a", calendarKey: "" }]);
    expect(teamFromCookieHeader("site_auth=co%20de%2Ba")?.slug).toBe("x");
  });

  it("returns null when there is no cookie or no site_auth", () => {
    expect(teamFromCookieHeader("")).toBeNull();
    expect(teamFromCookieHeader(null)).toBeNull();
    expect(teamFromCookieHeader("other=1")).toBeNull();
  });
});
