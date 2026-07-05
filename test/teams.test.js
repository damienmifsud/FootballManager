import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getTeams, teamByPassword, teamByCalendarKey, teamBySlug, teamFromCookieHeader, clearTeamsCache } from "@/lib/teams";

// The registry merges env-defined teams (TEAMS / legacy single-team vars)
// with wizard-created teams from the store; results are briefly cached, so
// each test clears the cache after setting its env / stored fixtures.
const { getStoredTeams } = vi.hoisted(() => ({ getStoredTeams: vi.fn() }));
vi.mock("@/lib/store", () => ({ getStoredTeams }));

const KEYS = ["TEAMS", "SITE_PASSWORD", "CALENDAR_KEY", "SQUADI_COMPETITION_ID", "SQUADI_DIVISION_ID", "SQUADI_TEAM_ID"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  getStoredTeams.mockReset();
  getStoredTeams.mockResolvedValue([]);
  clearTeamsCache();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks();
});

const TEAM_A = { slug: "a", name: "Team A", password: "code-a", calendarKey: "key-a", squadi: { competitionId: "1", divisionId: "2", teamId: 3 } };
const TEAM_B = { slug: "b", name: "Team B", password: "code-b", calendarKey: "key-b" };

describe("getTeams — env TEAMS mode", () => {
  it("parses the TEAMS env var into a team list", async () => {
    process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]);
    const teams = await getTeams();
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({ slug: "a", password: "code-a" });
  });

  it("drops entries missing a slug or password", async () => {
    process.env.TEAMS = JSON.stringify([TEAM_A, { name: "no slug", password: "x" }, { slug: "y" }]);
    const teams = await getTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].slug).toBe("a");
  });

  it("falls back to legacy mode and logs when TEAMS is invalid JSON", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.TEAMS = "{not json";
    process.env.SITE_PASSWORD = "legacy-code";
    const teams = await getTeams();
    expect(err).toHaveBeenCalled();
    expect(teams).toHaveLength(1);
    expect(teams[0].slug).toBe("default");
  });

  it("falls through to legacy mode when TEAMS is an empty array", async () => {
    process.env.TEAMS = "[]";
    process.env.SITE_PASSWORD = "legacy-code";
    expect((await getTeams())[0].slug).toBe("default");
  });
});

describe("getTeams — legacy single-team mode", () => {
  it("builds a default team from SITE_PASSWORD with squadi defaults", async () => {
    process.env.SITE_PASSWORD = "legacy-code";
    process.env.CALENDAR_KEY = "legacy-key";
    const [t] = await getTeams();
    expect(t).toMatchObject({
      slug: "default", name: "Team", password: "legacy-code", calendarKey: "legacy-key", legacy: true,
      squadi: { competitionId: "1439", divisionId: "10661", teamId: 110013 }
    });
  });

  it("honours overridden squadi env vars", async () => {
    process.env.SITE_PASSWORD = "legacy-code";
    process.env.SQUADI_COMPETITION_ID = "99";
    process.env.SQUADI_TEAM_ID = "42";
    expect((await getTeams())[0].squadi).toMatchObject({ competitionId: "99", teamId: 42 });
  });

  it("returns an empty list when nothing is configured anywhere", async () => {
    expect(await getTeams()).toEqual([]);
  });
});

describe("getTeams — wizard-created (stored) teams", () => {
  it("includes stored teams alongside env teams, flagged as stored", async () => {
    process.env.TEAMS = JSON.stringify([TEAM_A]);
    getStoredTeams.mockResolvedValue([TEAM_B]);
    const teams = await getTeams();
    expect(teams.map((t) => t.slug).sort()).toEqual(["a", "b"]);
    expect(teams.find((t) => t.slug === "b").stored).toBe(true);
    expect(teams.find((t) => t.slug === "a").stored).toBeUndefined();
  });

  it("stored wins on a slug collision (env team taken over by the wizard)", async () => {
    process.env.TEAMS = JSON.stringify([TEAM_A]);
    getStoredTeams.mockResolvedValue([{ ...TEAM_A, name: "Team A (edited)", password: "new-code" }]);
    const teams = await getTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: "Team A (edited)", password: "new-code", stored: true });
  });

  it("filters malformed stored entries and tolerates a store error", async () => {
    process.env.TEAMS = JSON.stringify([TEAM_A]);
    getStoredTeams.mockResolvedValue([{ name: "no slug/password" }, null]);
    expect(await getTeams()).toHaveLength(1);

    clearTeamsCache();
    getStoredTeams.mockRejectedValue(new Error("redis down"));
    expect((await getTeams()).map((t) => t.slug)).toEqual(["a"]);
  });

  it("stored teams work with no env teams at all", async () => {
    getStoredTeams.mockResolvedValue([TEAM_B]);
    expect((await getTeams())[0]).toMatchObject({ slug: "b", stored: true });
  });

  it("caches briefly and clearTeamsCache forces a re-read", async () => {
    getStoredTeams.mockResolvedValue([TEAM_B]);
    await getTeams();
    await getTeams();
    expect(getStoredTeams).toHaveBeenCalledTimes(1); // second hit served from cache
    clearTeamsCache();
    await getTeams();
    expect(getStoredTeams).toHaveBeenCalledTimes(2);
  });
});

describe("team lookups", () => {
  beforeEach(() => { process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]); });

  it("teamByPassword resolves the team selector (incl. stored teams)", async () => {
    expect((await teamByPassword("code-b"))?.slug).toBe("b");
    expect(await teamByPassword("nope")).toBeNull();
    expect(await teamByPassword("")).toBeNull();

    clearTeamsCache();
    getStoredTeams.mockResolvedValue([{ slug: "c", name: "C", password: "code-c" }]);
    expect((await teamByPassword("code-c"))?.slug).toBe("c");
  });

  it("teamByCalendarKey only matches a non-empty key", async () => {
    expect((await teamByCalendarKey("key-a"))?.slug).toBe("a");
    expect(await teamByCalendarKey("")).toBeNull();
    expect(await teamByCalendarKey("unknown")).toBeNull();
  });

  it("teamByCalendarKey never matches a team with an empty calendarKey via an empty key", async () => {
    process.env.TEAMS = JSON.stringify([{ slug: "c", name: "C", password: "p", calendarKey: "" }]);
    expect(await teamByCalendarKey("")).toBeNull();
  });

  it("teamBySlug resolves by slug", async () => {
    expect((await teamBySlug("a"))?.name).toBe("Team A");
    expect(await teamBySlug("missing")).toBeNull();
    expect(await teamBySlug("")).toBeNull();
  });
});

describe("teamFromCookieHeader", () => {
  beforeEach(() => { process.env.TEAMS = JSON.stringify([TEAM_A, TEAM_B]); });

  it("resolves the team from the site_auth cookie value", async () => {
    expect((await teamFromCookieHeader("site_auth=code-a"))?.slug).toBe("a");
  });

  it("picks site_auth out of a multi-cookie header", async () => {
    expect((await teamFromCookieHeader("team_slug=a; site_auth=code-b; other=1"))?.slug).toBe("b");
  });

  it("URL-decodes the cookie value before matching", async () => {
    process.env.TEAMS = JSON.stringify([{ slug: "x", name: "X", password: "co de+a", calendarKey: "" }]);
    expect((await teamFromCookieHeader("site_auth=co%20de%2Ba"))?.slug).toBe("x");
  });

  it("returns null when there is no cookie or no site_auth", async () => {
    expect(await teamFromCookieHeader("")).toBeNull();
    expect(await teamFromCookieHeader(null)).toBeNull();
    expect(await teamFromCookieHeader("other=1")).toBeNull();
  });
});
