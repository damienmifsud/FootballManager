import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// directory.js reads ADMIN_EMAILS / CLUB_ADMIN_EMAILS at module load and pulls
// team data + the club access doc from the store, so we mock the store and
// (re)import the module per test after setting the relevant env. getTeams is
// the real implementation, driven by TEAMS.
const { getData, getClubAccess, getStoredTeams } = vi.hoisted(() => ({ getData: vi.fn(), getClubAccess: vi.fn(), getStoredTeams: vi.fn() }));
vi.mock("@/lib/store", () => ({ getData, getClubAccess, getStoredTeams }));

const KEYS = ["TEAMS", "ADMIN_EMAILS", "CLUB_ADMIN_EMAILS"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  getData.mockReset();
  getClubAccess.mockReset();
  getClubAccess.mockResolvedValue({});
  getStoredTeams.mockResolvedValue([]);
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

// Re-evaluate directory.js so its module-load env lists reflect current env.
async function loadDir() {
  vi.resetModules();
  return import("@/lib/directory");
}

const TWO_TEAMS = JSON.stringify([
  { slug: "a", name: "Team A", password: "pa", coachEmails: ["coach@a.com"] },
  { slug: "b", name: "Team B", password: "pb" }
]);

// getData returns per-slug team documents with player rosters.
function withRosters(rosters) {
  getData.mockImplementation(async (slug) => rosters[slug] ?? null);
}

describe("membershipsForEmail", () => {
  beforeEach(() => { process.env.TEAMS = TWO_TEAMS; });

  it("returns no memberships for an empty email without hitting the store", async () => {
    const { membershipsForEmail } = await loadDir();
    const res = await membershipsForEmail("");
    expect(res).toEqual({ email: "", memberships: [] });
    expect(getData).not.toHaveBeenCalled();
  });

  it("matches a parent by their child's parentEmails (case/space-insensitive)", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["Mum@A.com"] }] },
      b: { players: [] }
    });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("  mum@a.com ");
    expect(memberships).toEqual([{ teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }]);
  });

  it("matches a coach by the team's coachEmails", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("coach@a.com");
    expect(memberships).toEqual([{ teamSlug: "a", teamName: "Team A", role: "coach" }]);
  });

  it("does not duplicate a parent membership when the email is also the team coach", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Kid", parentEmails: ["coach@a.com"] }] },
      b: { players: [] }
    });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("coach@a.com");
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("coach");
  });

  it("gives a parent one membership per team their kids are in", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["mum@x.com"] }] },
      b: { players: [{ id: "p2", name: "Lee", parentEmails: ["mum@x.com"] }] }
    });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("mum@x.com");
    expect(memberships.map((m) => m.teamSlug).sort()).toEqual(["a", "b"]);
  });

  it("gives a parent one membership per child within the same team", async () => {
    withRosters({
      a: { players: [
        { id: "p1", name: "Sam", parentEmails: ["mum@x.com"] },
        { id: "p2", name: "Alex", parentEmails: ["mum@x.com"] }
      ] },
      b: { players: [] }
    });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("mum@x.com");
    expect(memberships.map((m) => m.playerId).sort()).toEqual(["p1", "p2"]);
  });

  it("returns no memberships for an unknown email", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("stranger@nowhere.com");
    expect(memberships).toEqual([]);
  });

  it("grants a super admin coach access to every team with admin flagged", async () => {
    process.env.ADMIN_EMAILS = "boss@dam.fund";
    withRosters({ a: { players: [] }, b: { players: [] } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("boss@dam.fund");
    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.role === "coach" && m.admin === true)).toBe(true);
  });
});

describe("club admins (view-only everywhere)", () => {
  beforeEach(() => {
    process.env.TEAMS = TWO_TEAMS;
    withRosters({ a: { players: [] }, b: { players: [] } });
  });

  it("a CLUB_ADMIN_EMAILS email gets a viewer membership on every team", async () => {
    process.env.CLUB_ADMIN_EMAILS = "td@club.com";
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("td@club.com");
    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.role === "viewer" && m.clubAdmin === true)).toBe(true);
  });

  it("a club admin added in the stored access doc works the same", async () => {
    getClubAccess.mockResolvedValue({ clubAdmins: ["TD@club.com"] });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("td@club.com");
    expect(memberships.map((m) => m.role)).toEqual(["viewer", "viewer"]);
  });

  it("viewers are never coaches", async () => {
    process.env.CLUB_ADMIN_EMAILS = "td@club.com";
    const { isCoachForTeam } = await loadDir();
    expect(await isCoachForTeam("td@club.com", "a")).toBe(false);
  });

  it("a club admin who is also a parent keeps the parent role for that team", async () => {
    process.env.CLUB_ADMIN_EMAILS = "td@club.com";
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["td@club.com"] }] },
      b: { players: [] }
    });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("td@club.com");
    const roleBySlug = Object.fromEntries(memberships.map((m) => [m.teamSlug, m.role]));
    expect(roleBySlug).toEqual({ a: "parent", b: "viewer" });
  });
});

describe("per-team overrides (set by the super admin)", () => {
  beforeEach(() => {
    process.env.TEAMS = TWO_TEAMS;
  });

  it("demotes a would-be coach to parent on a team where their kid plays", async () => {
    // coach@a.com also coaches team B via env config, but the super admin
    // wants them parent-only on B.
    process.env.TEAMS = JSON.stringify([
      { slug: "a", name: "Team A", password: "pa", coachEmails: ["coach@a.com"] },
      { slug: "b", name: "Team B", password: "pb", coachEmails: ["coach@a.com"] }
    ]);
    withRosters({
      a: { players: [] },
      b: { players: [{ id: "p9", name: "Kid", parentEmails: ["coach@a.com"] }] }
    });
    getClubAccess.mockResolvedValue({ overrides: { "coach@a.com": { b: "parent" } } });
    const { membershipsForEmail, isCoachForTeam } = await loadDir();
    const { memberships } = await membershipsForEmail("coach@a.com");
    const roleBySlug = Object.fromEntries(memberships.map((m) => [m.teamSlug, m.role]));
    expect(roleBySlug).toEqual({ a: "coach", b: "parent" });
    expect(memberships.find((m) => m.teamSlug === "b")).toMatchObject({ playerId: "p9", overridden: true });
    expect(await isCoachForTeam("coach@a.com", "a")).toBe(true);
    expect(await isCoachForTeam("coach@a.com", "b")).toBe(false); // revoked without env changes
  });

  it("can force coach access for someone not in coachEmails", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    getClubAccess.mockResolvedValue({ overrides: { "helper@x.com": { a: "coach" } } });
    const { membershipsForEmail, isCoachForTeam } = await loadDir();
    const { memberships } = await membershipsForEmail("helper@x.com");
    expect(memberships).toEqual([expect.objectContaining({ teamSlug: "a", role: "coach", overridden: true })]);
    expect(await isCoachForTeam("helper@x.com", "a")).toBe(true);
  });

  it("blocks access to one team while leaving the other untouched", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["mum@x.com"] }] },
      b: { players: [{ id: "p2", name: "Lee", parentEmails: ["mum@x.com"] }] }
    });
    getClubAccess.mockResolvedValue({ overrides: { "mum@x.com": { b: "blocked" } } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("mum@x.com");
    expect(memberships.map((m) => m.teamSlug)).toEqual(["a"]);
  });

  it("forcing parent with no child on that roster falls back to view-only", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    getClubAccess.mockResolvedValue({ overrides: { "aunt@x.com": { a: "parent" } } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("aunt@x.com");
    expect(memberships).toEqual([expect.objectContaining({ teamSlug: "a", role: "viewer" })]);
  });

  it("never limits the super admin", async () => {
    process.env.ADMIN_EMAILS = "boss@dam.fund";
    withRosters({ a: { players: [] }, b: { players: [] } });
    getClubAccess.mockResolvedValue({ overrides: { "boss@dam.fund": { a: "blocked", b: "viewer" } } });
    const { membershipsForEmail, isCoachForTeam } = await loadDir();
    const { memberships } = await membershipsForEmail("boss@dam.fund");
    expect(memberships.every((m) => m.role === "coach")).toBe(true);
    expect(await isCoachForTeam("boss@dam.fund", "a")).toBe(true);
  });

  it("survives a broken access doc read", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    getClubAccess.mockRejectedValue(new Error("redis down"));
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("coach@a.com");
    expect(memberships).toEqual([{ teamSlug: "a", teamName: "Team A", role: "coach" }]);
  });
});

describe("emailCanAccessTeam / isCoachForTeam / isAdminEmail", () => {
  beforeEach(() => { process.env.TEAMS = TWO_TEAMS; });

  it("emailCanAccessTeam reflects any-role membership", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["mum@a.com"] }] },
      b: { players: [] }
    });
    const { emailCanAccessTeam } = await loadDir();
    expect(await emailCanAccessTeam("mum@a.com", "a")).toBe(true);
    expect(await emailCanAccessTeam("mum@a.com", "b")).toBe(false);
  });

  it("isCoachForTeam is true for a coach, false for a parent", async () => {
    withRosters({
      a: { players: [{ id: "p1", name: "Sam", parentEmails: ["mum@a.com"] }] },
      b: { players: [] }
    });
    const { isCoachForTeam } = await loadDir();
    expect(await isCoachForTeam("coach@a.com", "a")).toBe(true);
    expect(await isCoachForTeam("mum@a.com", "a")).toBe(false);
  });

  it("isCoachForTeam short-circuits true for an admin on any team", async () => {
    process.env.ADMIN_EMAILS = "boss@dam.fund";
    const { isCoachForTeam } = await loadDir();
    expect(await isCoachForTeam("boss@dam.fund", "b")).toBe(true);
    expect(getData).not.toHaveBeenCalled(); // admin path avoids a roster lookup
  });

  it("isAdminEmail normalises and matches the configured list", async () => {
    process.env.ADMIN_EMAILS = "boss@dam.fund, Other@X.com";
    const { isAdminEmail } = await loadDir();
    expect(isAdminEmail("BOSS@dam.fund")).toBe(true);
    expect(isAdminEmail(" other@x.com ")).toBe(true);
    expect(isAdminEmail("nobody@x.com")).toBe(false);
  });
});
