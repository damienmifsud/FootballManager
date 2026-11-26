import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/teams powers the /admin team wizard: create/edit/remove teams live,
// no env edits. Uses the REAL lib/teams merge (TEAMS env + mocked store) so
// uniqueness checks span both sources. Super admin only, account mode only.
const { auth, getStoredTeams, setStoredTeams, getData, setData, deleteData, getClubAccess } = vi.hoisted(() => ({
  auth: vi.fn(), getStoredTeams: vi.fn(), setStoredTeams: vi.fn(), getData: vi.fn(), setData: vi.fn(), deleteData: vi.fn(), getClubAccess: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/store", () => ({ getStoredTeams, setStoredTeams, getData, setData, deleteData, getClubAccess }));

const KEYS = ["AUTH_SECRET", "ADMIN_EMAILS", "CLUB_ADMIN_EMAILS", "TEAMS", "SITE_PASSWORD"];
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
  getClubAccess.mockResolvedValue({});
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

describe("club admins can run the wizard but not delete", () => {
  const asClubAdmin = async () => {
    process.env.CLUB_ADMIN_EMAILS = "td@club.com";
    const route = await loadRoute();
    auth.mockResolvedValue({ user: { email: "td@club.com" } });
    return route;
  };
  afterEach(() => { delete process.env.CLUB_ADMIN_EMAILS; });

  it("a CLUB_ADMIN_EMAILS email can list, create and edit teams", async () => {
    const { GET, POST, PATCH } = await asClubAdmin();
    expect((await GET()).status).toBe(200);
    const created = await POST(fakeRequest({ body: { name: "Club Made", password: "made-code" } }));
    expect(created.status).toBe(200);
    expect(setStoredTeams).toHaveBeenCalled();
    getStoredTeams.mockResolvedValue([{ slug: "club-made", name: "Club Made", password: "made-code", calendarKey: "k" }]);
    const edited = await PATCH(fakeRequest({ body: { slug: "club-made", name: "Club Made 2" } }));
    expect(edited.status).toBe(200);
  });

  it("a club admin added in the stored access doc works the same", async () => {
    getClubAccess.mockResolvedValue({ clubAdmins: ["TD2@club.com"] });
    const { GET } = await loadRoute();
    auth.mockResolvedValue({ user: { email: "td2@club.com" } });
    expect((await GET()).status).toBe(200);
  });

  it("deleting a team stays super-admin only", async () => {
    const { DELETE } = await asClubAdmin();
    getStoredTeams.mockResolvedValue([{ slug: "club-made", name: "Club Made", password: "made-code", calendarKey: "k" }]);
    const res = await DELETE(fakeRequest({ body: { slug: "club-made" } }));
    expect(res.status).toBe(403);
    expect(setStoredTeams).not.toHaveBeenCalled();
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

  it("seeds an imported Majestri roster (sanitized) into the starter doc", async () => {
    const { POST } = await asAdmin();
    const players = [
      { name: "Spencer M.", number: 1, position: "MID", dob: "2018-03-12", parentName: "Damien Mifsud", parentContact: "0400123456", parentEmails: ["damien@dam.fund"], guardians: [{ name: "Damien Mifsud", email: "damien@dam.fund", mobile: "0400123456" }] },
      { name: "", parentEmails: ["junk"] } // dropped by the sanitizer
    ];
    const res = await POST(fakeRequest({ body: { name: "Wiz C", ageGroup: "U8", password: "gold-roo-77", players } }));
    expect(res.status).toBe(200);
    expect((await res.json()).playersImported).toBe(1);
    const [, doc] = setData.mock.calls[0];
    expect(doc.players).toHaveLength(1);
    expect(doc.players[0]).toMatchObject({ name: "Spencer M.", parentEmails: ["damien@dam.fund"], parentName: "Damien Mifsud" });
    expect(doc.players[0].id).toBeTruthy();
  });

  it("keeps each imported player's last name beside the short display name", async () => {
    const { POST } = await asAdmin();
    const players = [
      { name: "Leo K.", surname: "  Kelly ", number: 1, position: "MID" },
      { name: "Billie", surname: "", number: 2, position: "MID" }
    ];
    const res = await POST(fakeRequest({ body: { name: "Wiz D", ageGroup: "U9", password: "gold-roo-78", players } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.players.map((p) => [p.name, p.surname])).toEqual([["Leo K.", "Kelly"], ["Billie", undefined]]);
    expect("surname" in doc.players[1]).toBe(false);
  });

  it("seeds the training schedule, features, division and WhatsApp into the starter doc", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "Wiz D", ageGroup: "U8", password: "swift-roo-33",
      division: "Kangaroos K1 Central Hub", whatsapp: "https://chat.whatsapp.com/xyz",
      features: { jerseyDuty: true, focus: false },
      training: [{ weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park" }, { weekday: 9, time: "17:00" }]
    } }));
    expect(res.status).toBe(200);
    expect((await res.json()).trainingSeeded).toBe(1); // invalid row dropped
    const [, doc] = setData.mock.calls[0];
    expect(doc.team).toMatchObject({
      division: "Kangaroos K1 Central Hub",
      whatsapp: "https://chat.whatsapp.com/xyz",
      features: { fruitDuty: true, jerseyDuty: true, gkDuty: true, focus: false }
    });
    expect(doc.sessions).toHaveLength(1);
    expect(doc.sessions[0]).toMatchObject({ recur: "weekly", weekday: 2, time: "17:00", endTime: "18:00", location: "Perry Park", kind: "training" });
  });

  it("seeds logo, staff and coach PIN into the starter doc", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "Wiz E", password: "brave-boot-19",
      logo: "data:image/png;base64,AAA", coachPin: "2468",
      staff: [{ role: "Head coach", name: "Byron", mobile: "0400 111 222" }, { role: "Manager", name: "" }]
    } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team).toMatchObject({ logo: "data:image/png;base64,AAA", coachPin: "2468" });
    expect(doc.team.staff).toEqual([{ role: "Head coach", name: "Byron", mobile: "0400111222", email: "", photo: "" }]);
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

  it("updates the doc-held fields (features/division) on an existing team document", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    getData.mockResolvedValue({ team: { name: "Wiz B", coachPin: "9" }, players: [{ id: "p1" }], fixtures: [] });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", division: "K2 South", features: { gkDuty: false } } }));
    expect(res.status).toBe(200);
    expect((await res.json()).docUpdated).toBe(true);
    const [, doc] = setData.mock.calls[0];
    // Existing doc content preserved; only the team fields updated.
    expect(doc.players).toEqual([{ id: "p1" }]);
    expect(doc.team).toMatchObject({ coachPin: "9", division: "K2 South", features: expect.objectContaining({ gkDuty: false, fruitDuty: true }) });
  });

  it("updates identity fields on the doc, preserving dashboard-added staff photos", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    getData.mockResolvedValue({
      team: { name: "Wiz B", logo: "data:image/png;base64,OLD", staff: [{ role: "Head coach", name: "Byron", mobile: "", email: "", photo: "data:image/jpeg;base64,PIC" }] },
      players: []
    });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", coachPin: "1357", staff: [{ role: "Head coach", name: "Byron", mobile: "0400111222" }] } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.coachPin).toBe("1357");
    expect(doc.team.logo).toBe("data:image/png;base64,OLD"); // untouched — no new logo sent
    expect(doc.team.staff[0]).toMatchObject({ name: "Byron", mobile: "0400111222", photo: "data:image/jpeg;base64,PIC" });
  });

  it("rotates the calendar key on request", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", rotateCalendarKey: true } }));
    expect(res.status).toBe(200);
    const savedList = setStoredTeams.mock.calls[0][0];
    expect(savedList[0].calendarKey).toMatch(/^[0-9a-f]{32}$/);
    expect(savedList[0].calendarKey).not.toBe("key-b");
  });

  it("404s unknown slugs and 409s a code used by another team", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    const { PATCH } = await asAdmin();
    expect((await PATCH(fakeRequest({ body: { slug: "ghost", name: "X" } }))).status).toBe(404);
    expect((await PATCH(fakeRequest({ body: { slug: "wiz-b", password: "code-a" } }))).status).toBe(409);
  });
});

describe("parentsSee — what parents see of match day", () => {
  const DEFAULTS = { planBeforeKickoff: false, liveScore: true, liveLineup: true, ownChildMinutes: false, everyoneMinutes: false };

  it("POST without parentsSee seeds the defaults into the starter doc", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: { name: "Wiz F", password: "lucky-goal-51" } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.parentsSee).toEqual(DEFAULTS);
  });

  it("POST with a partial object seeds it sanitised (unknown key dropped, values coerced)", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "Wiz G", password: "mighty-boot-62",
      parentsSee: { planBeforeKickoff: "yes", liveScore: 0, secretFlag: true }
    } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.parentsSee).toEqual({ ...DEFAULTS, planBeforeKickoff: true, liveScore: false });
    expect(doc.team.parentsSee).not.toHaveProperty("secretFlag");
  });

  it("PATCH updates only parentsSee on the doc, preserving other team keys and players", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    getData.mockResolvedValue({
      team: { name: "Wiz B", coachPin: "9", division: "K1", features: { gkDuty: false }, parentsSee: { ...DEFAULTS, liveScore: false } },
      players: [{ id: "p1" }], fixtures: [{ id: "f1" }]
    });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", parentsSee: { ownChildMinutes: true, everyoneMinutes: "1" } } }));
    expect(res.status).toBe(200);
    expect((await res.json()).docUpdated).toBe(true);
    const [slug, doc] = setData.mock.calls[0];
    expect(slug).toBe("wiz-b");
    expect(doc.team.parentsSee).toEqual({ ...DEFAULTS, ownChildMinutes: true, everyoneMinutes: true });
    // Untouched team keys and the rest of the document survive the write.
    expect(doc.team).toMatchObject({ name: "Wiz B", coachPin: "9", division: "K1", features: { gkDuty: false } });
    expect(doc.players).toEqual([{ id: "p1" }]);
    expect(doc.fixtures).toEqual([{ id: "f1" }]);
  });

  it("GET reports parentsSee merged with defaults for a team whose doc has none", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    getData.mockImplementation(async (slug) => (slug === "wiz-b" ? { team: { name: "Wiz B", parentsSee: { liveLineup: false } }, players: [] } : null));
    const { GET } = await asAdmin();
    const body = await (await GET()).json();
    const bySlug = Object.fromEntries(body.teams.map((t) => [t.slug, t]));
    expect(bySlug["env-a"].parentsSee).toEqual(DEFAULTS);                        // no doc at all
    expect(bySlug["wiz-b"].parentsSee).toEqual({ ...DEFAULTS, liveLineup: false }); // partial doc value merged over defaults
  });
});

describe("staff emails — coach-level login from the staff list", () => {
  const stored = () => getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);

  it("POST stores staff emails (lower-cased) and a custom title", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "Wiz H", password: "rapid-eagle-28",
      staff: [
        { role: "Head coach", name: "Byron", mobile: "0400 111 222", email: "  Byron@Club.COM " },
        { role: "Manager", name: "Alex", email: "not-an-email" },
        { role: "Goalkeeper coach", name: "Sam", email: "sam@club.com" }
      ]
    } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.staff).toEqual([
      { role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com", photo: "" },
      { role: "Manager", name: "Alex", mobile: "", email: "", photo: "" },
      { role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com", photo: "" }
    ]);
  });

  it("PATCH from a client that omits emails keeps the stored email for the same-named row", async () => {
    stored();
    getData.mockResolvedValue({
      team: { name: "Wiz B", staff: [
        { role: "Head coach", name: "Byron", mobile: "", email: "byron@club.com", photo: "data:image/jpeg;base64,PIC" },
        { role: "Manager", name: "Alex", mobile: "", email: "alex@club.com", photo: "" }
      ] },
      players: []
    });
    const { PATCH } = await asAdmin();
    // Older wizard payload: role/name/mobile only, and Alex renamed away.
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", staff: [
      { role: "Head coach", name: "Byron", mobile: "0400111222" },
      { role: "Manager", name: "Alexandra" }
    ] } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.staff).toEqual([
      { role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com", photo: "data:image/jpeg;base64,PIC" },
      { role: "Manager", name: "Alexandra", mobile: "", email: "", photo: "" } // no same-named row to inherit from
    ]);
  });

  it("PATCH with a new email replaces the stored one, and an explicit empty email clears it", async () => {
    stored();
    getData.mockResolvedValue({
      team: { name: "Wiz B", staff: [
        { role: "Head coach", name: "Byron", mobile: "", email: "byron@club.com", photo: "" },
        { role: "Manager", name: "Alex", mobile: "", email: "alex@club.com", photo: "" }
      ] },
      players: []
    });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", staff: [
      { role: "Head coach", name: "Byron", email: "NEW@club.com" },
      { role: "Manager", name: "Alex", email: "" }
    ] } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.staff.map((s) => [s.name, s.email])).toEqual([["Byron", "new@club.com"], ["Alex", ""]]);
  });

  it("PATCH round-trips a custom-titled row alongside the standard ones", async () => {
    stored();
    getData.mockResolvedValue({
      team: { name: "Wiz B", staff: [{ role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com", photo: "data:image/jpeg;base64,SAM" }] },
      players: []
    });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "wiz-b", staff: [
      { role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com" },
      { role: "Head coach", name: "Byron", mobile: "", email: "byron@club.com" }
    ] } }));
    expect(res.status).toBe(200);
    const [, doc] = setData.mock.calls[0];
    expect(doc.team.staff).toEqual([
      { role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com", photo: "data:image/jpeg;base64,SAM" },
      { role: "Head coach", name: "Byron", mobile: "", email: "byron@club.com", photo: "" }
    ]);
  });

  it("GET exposes staff emails (not photos) to the super admin", async () => {
    stored();
    getData.mockImplementation(async (slug) => (slug === "wiz-b" ? {
      team: { name: "Wiz B", staff: [
        { role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com", photo: "data:image/jpeg;base64,PIC" },
        { role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com", photo: "" }
      ] },
      players: []
    } : null));
    const { GET } = await asAdmin();
    const body = await (await GET()).json();
    const bySlug = Object.fromEntries(body.teams.map((t) => [t.slug, t]));
    expect(bySlug["wiz-b"].staff).toEqual([
      { role: "Head coach", name: "Byron", mobile: "0400111222", email: "byron@club.com" },
      { role: "Goalkeeper coach", name: "Sam", mobile: "", email: "sam@club.com" }
    ]);
    expect(bySlug["env-a"].staff).toEqual([]); // no doc
  });
});

describe("DELETE", () => {
  it("removes a stored team but refuses env teams", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    const { DELETE } = await asAdmin();
    expect((await DELETE(fakeRequest({ body: { slug: "wiz-b" } }))).status).toBe(200);
    expect(setStoredTeams).toHaveBeenCalledWith([]);
    expect(deleteData).not.toHaveBeenCalled(); // data kept by default
    expect((await DELETE(fakeRequest({ body: { slug: "env-a" } }))).status).toBe(400);
  });

  it("purgeData: true also wipes the team's document so re-creating the slug seeds fresh", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }]);
    deleteData.mockResolvedValue();
    const { DELETE } = await asAdmin();
    const res = await DELETE(fakeRequest({ body: { slug: "wiz-b", purgeData: true } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, purged: true });
    expect(deleteData).toHaveBeenCalledWith("wiz-b");
    // Env teams are still refused, data untouched.
    expect((await DELETE(fakeRequest({ body: { slug: "env-a", purgeData: true } }))).status).toBe(400);
    expect(deleteData).toHaveBeenCalledTimes(1);
  });
});

describe("season — the team's window", () => {
  const SEASON = { startISO: "2027-02-01", endISO: "2027-11-30" };

  it("POST seeds season into the starter doc, and stores null when omitted or invalid", async () => {
    const { POST } = await asAdmin();
    expect((await POST(fakeRequest({ body: { name: "Wiz S", password: "swift-roo-44", season: SEASON } }))).status).toBe(200);
    expect(setData.mock.calls[0][1].team.season).toEqual(SEASON);
    getStoredTeams.mockResolvedValue([]);
    expect((await POST(fakeRequest({ body: { name: "Wiz T", password: "swift-roo-45" } }))).status).toBe(200);
    expect(setData.mock.calls[1][1].team.season).toBeNull();
    expect((await POST(fakeRequest({ body: { name: "Wiz U", password: "swift-roo-46", season: { startISO: "2027-11-30", endISO: "2027-02-01" } } }))).status).toBe(200);
    expect(setData.mock.calls[2][1].team.season).toBeNull(); // inverted → unset
    // Seeded training stays unbounded: the window clamps it, so moving the season later moves the training.
    expect((await POST(fakeRequest({ body: { name: "Wiz V", password: "swift-roo-47", season: SEASON, training: [{ weekday: 2, time: "17:00" }] } }))).status).toBe(200);
    const doc = setData.mock.calls[3][1];
    expect(doc.sessions[0]).not.toHaveProperty("startISO");
    expect(doc.sessions[0]).not.toHaveProperty("untilISO");
  });

  it("PATCH updates the doc's season, clears it with null and leaves it alone when the key is absent", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b", calendarKey: "key-b" }]);
    getData.mockResolvedValue({ team: { name: "Wiz B", division: "K2" }, players: [{ id: "p1" }], fixtures: [], sessions: [{ id: "s1" }] });
    const { PATCH } = await asAdmin();
    let res = await PATCH(fakeRequest({ body: { slug: "wiz-b", season: SEASON } }));
    expect(res.status).toBe(200);
    expect((await res.json()).docUpdated).toBe(true);
    expect(setData.mock.calls[0][1].team).toMatchObject({ division: "K2", season: SEASON });
    expect(setData.mock.calls[0][1].sessions).toEqual([{ id: "s1" }]);

    getData.mockResolvedValue({ team: { name: "Wiz B", season: SEASON }, players: [], fixtures: [] });
    res = await PATCH(fakeRequest({ body: { slug: "wiz-b", season: null } }));
    expect((await res.json()).docUpdated).toBe(true);
    expect(setData.mock.calls[1][1].team.season).toBeNull();

    res = await PATCH(fakeRequest({ body: { slug: "wiz-b", season: { startISO: "nope", endISO: "2027-11-30" } } }));
    expect(setData.mock.calls[2][1].team.season).toBeNull(); // invalid → unset

    setData.mockClear();
    res = await PATCH(fakeRequest({ body: { slug: "wiz-b", name: "Wiz B2" } }));
    expect(setData.mock.calls[0][1].team.season).toEqual(SEASON); // untouched
  });

  it("GET returns the sanitised season, or null", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "wiz-b", name: "Wiz B", password: "code-b" }, { slug: "wiz-c", name: "Wiz C", password: "code-c" }]);
    getData.mockImplementation(async (slug) => slug === "wiz-b"
      ? { team: { name: "Wiz B", season: SEASON } }
      : slug === "wiz-c" ? { team: { name: "Wiz C", season: { startISO: "2027-11-30", endISO: "2027-02-01" } } } : null);
    const { GET } = await asAdmin();
    const body = await (await GET()).json();
    const bySlug = Object.fromEntries(body.teams.map((t) => [t.slug, t]));
    expect(bySlug["wiz-b"].season).toEqual(SEASON);
    expect(bySlug["wiz-c"].season).toBeNull();
    expect(bySlug["env-a"].season).toBeNull();
  });
});

// A team's competitions beyond its season (lib/competitions.js, the real
// module): each has a permanent id, a name and, once its draw is published,
// Squadi ids. They live on the team's registry entry beside the season's ids.
describe("competitions — the team's other draws", () => {
  const WINTER = { competitionId: "1750", divisionId: "20001", teamId: "300123" };
  const ID = /^c[0-9a-f]{8}$/;

  it("POST stores them on the registry entry: an id each, ids as numbers, a name-only one kept", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "U10 Red", password: "red-code-1",
      squadi: { competitionId: "1439", divisionId: "10661", teamId: "110020" },
      competitions: [{ name: " Winterfest ", squadi: WINTER }, { name: "Premier Invitational" }, { name: "" }, { name: "  ", squadi: {} }]
    } }));
    expect(res.status).toBe(200);
    const stored = setStoredTeams.mock.calls[0][0][0];
    expect(stored.squadi).toEqual({ competitionId: "1439", divisionId: "10661", teamId: 110020 });
    expect(stored.competitions).toHaveLength(2);
    expect(stored.competitions[0]).toEqual({ id: expect.stringMatching(ID), name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } });
    expect(stored.competitions[1]).toEqual({ id: expect.stringMatching(ID), name: "Premier Invitational" });
    expect(stored.competitions[0].id).not.toBe(stored.competitions[1].id);
    // The response carries the stored team, ids included.
    expect((await res.json()).team.competitions).toEqual(stored.competitions);
    // Competitions are registry-only: nothing about them goes into the starter document.
    expect(JSON.stringify(setData.mock.calls[0][1])).not.toMatch(/Winterfest|competitions/);
  });

  it("POST with none stores no competitions key at all", async () => {
    const { POST } = await asAdmin();
    await POST(fakeRequest({ body: { name: "Plain", password: "plain-code" } }));
    expect("competitions" in setStoredTeams.mock.calls[0][0][0]).toBe(false);
    setStoredTeams.mockClear();
    await POST(fakeRequest({ body: { name: "Plain Two", password: "plain-code-2", competitions: [] } }));
    expect("competitions" in setStoredTeams.mock.calls[0][0][0]).toBe(false);
  });

  it("PATCH replaces the list: ids kept, a rename and new ids applied, a missing row removed, a new row given an id", async () => {
    const existing = {
      slug: "u10-red", name: "U10 Red", password: "red-code-1", calendarKey: "k",
      squadi: { competitionId: "1439", divisionId: "10661", teamId: 110020 },
      competitions: [
        { id: "c1a2b3c4d", name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } },
        { id: "c5e6f7a8b", name: "Premier Invitational" },
        { id: "c9d8e7f6a", name: "Old Cup", squadi: { competitionId: "9", divisionId: "8", teamId: 7 } }
      ]
    };
    getStoredTeams.mockResolvedValue([existing]);
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "u10-red", competitions: [
      { id: "c1a2b3c4d", name: "Winterfest 2027", squadi: { competitionId: "1900", divisionId: "22000", teamId: "400000" } },
      { id: "c5e6f7a8b", name: "Premier Invitational", squadi: { competitionId: "1800", divisionId: "21000", teamId: 310000 } },
      { name: "Spring Cup" }
    ] } }));
    expect(res.status).toBe(200);
    const stored = setStoredTeams.mock.calls[0][0][0];
    expect(stored.competitions).toEqual([
      { id: "c1a2b3c4d", name: "Winterfest 2027", squadi: { competitionId: "1900", divisionId: "22000", teamId: 400000 } },
      { id: "c5e6f7a8b", name: "Premier Invitational", squadi: { competitionId: "1800", divisionId: "21000", teamId: 310000 } },
      { id: expect.stringMatching(ID), name: "Spring Cup" }
    ]);
    // The season's ids were not sent, so they are as they were.
    expect(stored.squadi).toEqual(existing.squadi);
  });

  it("PATCH without the key leaves them alone; an empty list removes them all", async () => {
    const existing = { slug: "u10-red", name: "U10 Red", password: "red-code-1", calendarKey: "k", competitions: [{ id: "c1a2b3c4d", name: "Winterfest" }] };
    getStoredTeams.mockResolvedValue([existing]);
    const { PATCH } = await asAdmin();
    await PATCH(fakeRequest({ body: { slug: "u10-red", name: "U10 Red Renamed" } }));
    expect(setStoredTeams.mock.calls[0][0][0].competitions).toEqual(existing.competitions);
    setStoredTeams.mockClear();
    await PATCH(fakeRequest({ body: { slug: "u10-red", competitions: [] } }));
    expect("competitions" in setStoredTeams.mock.calls[0][0][0]).toBe(false);
  });

  it("PATCH on an env-defined team takes it over with its competitions, and never touches the team document for them", async () => {
    getData.mockResolvedValue({ team: { name: "Env A" }, players: [], fixtures: [] });
    const { PATCH } = await asAdmin();
    const res = await PATCH(fakeRequest({ body: { slug: "env-a", competitions: [{ name: "Winterfest", squadi: WINTER }] } }));
    expect(res.status).toBe(200);
    const stored = setStoredTeams.mock.calls[0][0][0];
    expect(stored).toMatchObject({ slug: "env-a", name: "Env A", password: "code-a" });
    expect(stored.competitions).toEqual([{ id: expect.stringMatching(ID), name: "Winterfest", squadi: { competitionId: "1750", divisionId: "20001", teamId: 300123 } }]);
    expect((await res.json()).docUpdated).toBe(false);
    expect(setData).not.toHaveBeenCalled();
  });

  it("caps the list at eight and refuses nothing: junk is dropped, not an error", async () => {
    const { POST } = await asAdmin();
    const res = await POST(fakeRequest({ body: {
      name: "Many", password: "many-code",
      competitions: [...Array.from({ length: 12 }, (_, i) => ({ name: `Comp ${i + 1}` })), "junk", null, 7]
    } }));
    expect(res.status).toBe(200);
    expect(setStoredTeams.mock.calls[0][0][0].competitions.map((c) => c.name)).toEqual(Array.from({ length: 8 }, (_, i) => `Comp ${i + 1}`));
    setStoredTeams.mockClear();
    const odd = await POST(fakeRequest({ body: { name: "Odd", password: "odd-code-1", competitions: "Winterfest" } }));
    expect(odd.status).toBe(200);
    expect("competitions" in setStoredTeams.mock.calls[0][0][0]).toBe(false);
  });

  it("GET lists each team's competitions, an empty list when it has none", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "u10-red", name: "U10 Red", password: "red-code-1", calendarKey: "k", competitions: [{ id: "c1a2b3c4d", name: "Winterfest" }] }]);
    const { GET } = await asAdmin();
    const { teams } = await (await GET()).json();
    expect(teams.find((t) => t.slug === "u10-red").competitions).toEqual([{ id: "c1a2b3c4d", name: "Winterfest" }]);
    expect(teams.find((t) => t.slug === "env-a").competitions).toEqual([]);
  });

  it("the season's ids are sanitised as before: partial ids kept, an all-blank set removes them", async () => {
    getStoredTeams.mockResolvedValue([{ slug: "u10-red", name: "U10 Red", password: "red-code-1", calendarKey: "k", squadi: { competitionId: "1439", divisionId: "10661", teamId: 110020 } }]);
    const { PATCH } = await asAdmin();
    await PATCH(fakeRequest({ body: { slug: "u10-red", squadi: { competitionId: " 1500 ", divisionId: "", teamId: "" } } }));
    expect(setStoredTeams.mock.calls[0][0][0].squadi).toEqual({ competitionId: "1500", divisionId: "", teamId: 0 });
    setStoredTeams.mockClear();
    await PATCH(fakeRequest({ body: { slug: "u10-red", squadi: { competitionId: "", divisionId: "", teamId: "" } } }));
    expect("squadi" in setStoredTeams.mock.calls[0][0][0]).toBe(false);
  });
});
