import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeRequest } from "./helpers/fakeRequest";

// /api/logo-site: the team's own logo from its club's website, for the coach's
// Club logo card and the admins' team form. The session, the directory, the
// viewer and the site reader are stand-ins; every name and address is made up.
const { auth, isAdminEmail, isClubAdminEmail, viewingAs, resolveViewer, readClubSite, readLogoImage } = vi.hoisted(() => ({
  auth: vi.fn(), isAdminEmail: vi.fn(), isClubAdminEmail: vi.fn(), viewingAs: vi.fn(), resolveViewer: vi.fn(), readClubSite: vi.fn(), readLogoImage: vi.fn()
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ isAdminEmail, isClubAdminEmail, viewingAs }));
vi.mock("@/lib/viewer", () => ({ resolveViewer, READ_ONLY_MESSAGE: "You're viewing as another user — read only. Exit view-as to make changes." }));
vi.mock("@/lib/clubSite", () => ({ readClubSite, readLogoImage }));

const SITE_LOGO = "https://valleywanderers.example/img/crest.png";
const coach = { mode: "account", hat: { role: "coach" }, team: { slug: "u10" } };
const parent = { mode: "account", hat: { role: "parent" }, team: { slug: "u10" } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = "test-secret";
  auth.mockResolvedValue({ user: { email: "coach@example.com" } });
  isAdminEmail.mockImplementation((e) => e === "owner@example.com");
  isClubAdminEmail.mockImplementation(async (e) => e === "club@example.com");
  viewingAs.mockReturnValue(null);
  resolveViewer.mockResolvedValue(coach);
  readClubSite.mockResolvedValue({ site: "https://valleywanderers.example/", candidates: [{ url: SITE_LOGO, kind: "logo" }] });
  readLogoImage.mockResolvedValue({ type: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
});

async function route() {
  vi.resetModules();
  return import("@/app/api/logo-site/route");
}
const post = (r, body) => r.POST(fakeRequest({ url: "http://localhost/api/logo-site", body }));

describe("POST /api/logo-site", () => {
  it("reads the club's website for a coach of the team, keeping nothing", async () => {
    const res = await post(await route(), { action: "site", url: "valleywanderers.example" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, site: "https://valleywanderers.example/", candidates: [{ url: SITE_LOGO, kind: "logo" }] });
    expect(readClubSite).toHaveBeenCalledWith("valleywanderers.example");
    expect(resolveViewer).toHaveBeenCalledWith(expect.anything(), { write: true });
  });

  it("hands back the picture picked, as the bytes it is", async () => {
    const res = await post(await route(), { action: "image", url: SITE_LOGO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, type: "image/png", picture: "data:image/png;base64,iVBORw==" });
    expect(readLogoImage).toHaveBeenCalledWith(SITE_LOGO);
  });

  it("lets the super admin and a club admin in without a team, and nobody else but the team's coaches", async () => {
    resolveViewer.mockResolvedValue({ error: 409, message: "Pick a team first." });
    for (const email of ["owner@example.com", "club@example.com"]) {
      auth.mockResolvedValue({ user: { email } });
      expect((await post(await route(), { action: "site", url: "valleywanderers.example" })).status).toBe(200);
    }
    auth.mockResolvedValue({ user: { email: "coach@example.com" } });
    expect((await post(await route(), { action: "site", url: "valleywanderers.example" })).status).toBe(409);
    resolveViewer.mockResolvedValue(parent);
    expect((await post(await route(), { action: "site", url: "valleywanderers.example" })).status).toBe(403);
    expect(readClubSite).toHaveBeenCalledTimes(2);
  });

  it("refuses the signed out, anyone viewing as someone else, and team-code mode", async () => {
    auth.mockResolvedValue(null);
    expect((await post(await route(), { action: "site", url: "valleywanderers.example" })).status).toBe(401);
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    viewingAs.mockReturnValue("coach@example.com");
    const res = await post(await route(), { action: "image", url: SITE_LOGO });
    expect([res.status, (await res.json()).error]).toEqual([403, expect.stringMatching(/read only/)]);
    viewingAs.mockReturnValue(null);
    delete process.env.AUTH_SECRET;
    expect((await post(await route(), { action: "site", url: "valleywanderers.example" })).status).toBe(400);
    expect(readClubSite).not.toHaveBeenCalled();
    expect(readLogoImage).not.toHaveBeenCalled();
  });

  it("refuses a request it doesn't know, or one with no link", async () => {
    const r = await route();
    expect((await post(r, { action: "club", url: SITE_LOGO })).status).toBe(400);
    expect((await post(r, { action: "site", url: "  " })).status).toBe(400);
    expect((await post(r, { action: "image" })).status).toBe(400);
    expect((await r.POST(fakeRequest({ url: "http://localhost/api/logo-site" }))).status).toBe(400);
    expect(readClubSite).not.toHaveBeenCalled();
  });

  it("passes on what the reader says went wrong, and nothing else", async () => {
    readLogoImage.mockRejectedValueOnce(Object.assign(new Error("That picture is too big to be a logo."), { siteError: "tooBig" }));
    let res = await post(await route(), { action: "image", url: SITE_LOGO });
    expect([res.status, (await res.json()).error]).toEqual([422, "That picture is too big to be a logo."]);
    readClubSite.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:443"));
    res = await post(await route(), { action: "site", url: "valleywanderers.example" });
    expect((await res.json()).error).toBe("The site couldn't be read.");
  });

  it("gives each sign-in only so many reads in a few minutes", async () => {
    const r = await route();
    for (let i = 0; i < r.READS_PER_WINDOW; i++) expect((await post(r, { action: "site", url: "valleywanderers.example" })).status).toBe(200);
    const res = await post(r, { action: "image", url: SITE_LOGO });
    expect([res.status, (await res.json()).error]).toEqual([429, expect.stringMatching(/Wait a few minutes/)]);
    expect(readLogoImage).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { email: "owner@example.com" } });
    expect((await post(r, { action: "image", url: SITE_LOGO })).status).toBe(200);
  });
});
