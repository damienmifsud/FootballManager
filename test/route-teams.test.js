import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/teams powers the /admin team wizard: create/edit/remove teams live,
// no env edits. Uses the REAL lib/teams merge (TEAMS env + mocked store) so
// uniqueness checks span both sources. Super admin only, account mode only.
const { auth, getStoredTeams, setStoredTeams, getData, setData } = vi.hoisted(() => ({
  auth: vi.fn(), getStoredTeams: vi.fn(), setStoredTeams: vi.fn(), getData: vi.fn(), setData: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getStoredTeams, setStoredTeams, getData, setData }));

const KEYS = ["AUTH_SECRET", "ADMIN_EMAILS", "TEAMS", "SITE_PASSWORD"];
let saved;
beforeEach(() => {
  vi.clearAllMocks();
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.TEAMS = JSON.stringify([{ slug: "env-a", name: "Env A", password: "code-a", calendarKey: "key-a", coachEmails: ["coach@a.com"] }]);
  getStoredTeams.mockResolvedValue([]);
  setStoredTeams.mockResolvedValue();
  getData.mockResolvedValue(null);
  setData.mockResolvedValue();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function loadRoute({ authOn = true, admin = "boss@dam.fund" } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  if (admin) process.env.ADMIN_EMAILS = admin;
  vi.resetModules();
  return import("@/app/api/teams/route");
}
const asAdmin = async () => {
  const route = await loadRoute();
  auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
  return route;
};

describe("gates", () => {
  it("400s in legacy mode, 401s signed-out, 403s non-admins", async () => {
    const legacy = await loadRoute({ authOn: false });
    expect((await legacy.GET()).status).toBe(400);

    const { GET } = await loadRoute();
    auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "coach@a.com" } });
    expect((await GET()).status).toBe(403);
  });
});

describe("GET", () => {
  it("lists env and stored teams with codes and source flags", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    const { GET } = await asAdmin();
    const body = await (await GET()).json();
    const bySlug = Object.fromEntries(body.teams.map((t) => [t.slug, t]));
    expect(bySlug["env-a"]).toMatchObject({ source: "env", password: "code-a", coachEmails: ["coach@a.com"] });
    expect(bySlug["wiz-b"]).toMatchObject({ source: "stored", password: "code-b" });
  });
});

describe("POST — create", () => {
  it("creates a team with derived slug, generated calendar key and a starter doc", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: { name: "Olympic FC U9 Wallabies Blue", ageGroup: "U9", password: "gold-roo-42", coachEmails: "Coach@B.com, junk" } }));
    expect(res.status).toBe(200);
    const { team } = await res.json();
    expect(team).toMatchObject({ slug: "olympic-fc-u9-wallabies-blue", name: "Olympic FC U9 Wallabies Blue", ageGroup: "U9", coachEmails: ["coach@b.com"] });
    expect(team.calendarKey).toMatch(/^[0-9a-f]{32}$/);
    expect(setStoredTeams).toHaveBeenCalledWith([team]);
    // Starter document seeded with the age-group match format (U9 -> 7v7).
    const [slug, doc] = setData.mock.calls[0];
    expect(slug).toBe(team.slug);
    expect(doc.team).toMatchObject({ name: team.name, ageGroup: "U9", matchFormat: expect.objectContaining({ playersOnField: 7 }) });
    expect(doc.players).toEqual([]);
  });

  it("does not overwrite existing data when re-adding a known slug", async () => {
    getData.mockResolvedValue({ team: { name: "Old" }, players: [{ id: "p1" }] });
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: { name: "Wiz B", password: "code-b2" } }));
    expect(res.status).toBe(200);
    expect(setData).not.toHaveBeenCalled();
  });

  it("rejects duplicate slugs and team codes across BOTH sources", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { name: "Env A", password: "fresh-code" } }))).status).toBe(409); // slug clash with env
    expect((await POST(fakeRequest({ body: { name: "New Team", password: "code-a" } }))).status).toBe(409);  // code clash with env
    expect(setStoredTeams).not.toHaveBeenCalled();
  });

  it("validates name, slug shape and code length", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { password: "long-enough" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { name: "X", slug: "Bad Slug!", password: "long-enough" } }))).status).toBe(400);
    expect((await POST(fakeRequest({ body: { name: "X", password: "abc" } }))).status).toBe(400);
  });
});

describe("PATCH — edit", () => {
  it("edits a stored team in place", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", password: "rotated-code", coachEmails: "new@b.com" } }));
    expect(res.status).toBe(200);
    const savedList = setStoredTeams.mock.calls[0][0];
    expect(savedList).toHaveLength(1);
    expect(savedList[0]).toMatchObject({ slug: "wiz-b", password: "rotated-code", coachEmails: ["new@b.com"], calendarKey: "key-b" });
  });

  it("takes over an env team into the store", async () => {
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "env-a", coachEmails: "extra@a.com" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).tookOver).toBe(true);
    const savedList = setStoredTeams.mock.calls[0][0];
    // Env fields carried over, patch applied, stored copy now wins on slug.
    expect(savedList[0]).toMatchObject({ slug: "env-a", name: "Env A", password: "code-a", coachEmails: ["extra@a.com"] });
  });

  it("404s unknown slugs and 409s a code used by another team", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    const { PATCH } = await asAdmin();
    expect((await PATCH(fakeRequest({ body: { slug: "ghost", name: "X" } }))).status).toBe(404);
    expect((await PATCH(fakeRequest({ body: { slug: "wiz-b", password: "code-a" } }))).status).toBe(409);
  });
});

describe("DELETE", () => {
  it("removes a stored team but refuses env teams", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    const { DELETE } = await asAdmin();
    expect((await DELETE(fakeRequest({ body: { slug: "wiz-b" } }))).status).toBe(200);
    expect(setStoredTeams).toHaveBeenCalledWith([]);
    expect((await DELETE(fakeRequest({ body: { slug: "env-a" } }))).status).toBe(400);
  });
});
