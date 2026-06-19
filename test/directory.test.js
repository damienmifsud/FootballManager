import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// directory.js reads ADMIN_EMAILS at module load and pulls team data from the
// store, so we mock the store and (re)import the module per test after setting
// the relevant env. getTeams is the real implementation, driven by TEAMS.
const { getData } = vi.hoisted(() => ({ getData: vi.fn() }));
vi.mock("@/lib/store", () => ({ getData }));

const KEYS = ["TEAMS", "ADMIN_EMAILS"];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  getData.mockReset();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

// Re-evaluate directory.js so its module-load ADMIN_EMAILS reflects current env.
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

  it("returns no memberships for an unknown email", async () => {
    withRosters({ a: { players: [] }, b: { players: [] } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("stranger@nowhere.com");
    expect(memberships).toEqual([]);
  });

  it("grants a superuser coach access to every team with admin flagged", async () => {
    process.env.ADMIN_EMAILS = "boss@dam.fund";
    withRosters({ a: { players: [] }, b: { players: [] } });
    const { membershipsForEmail } = await loadDir();
    const { memberships } = await membershipsForEmail("boss@dam.fund");
    expect(memberships).toHaveLength(2);
    expect(memberships.every((m) => m.role === "coach" && m.admin === true)).toBe(true);
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
