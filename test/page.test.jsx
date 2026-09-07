import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// app/page.jsx is an async server component: call the default export and
// inspect the element tree it returns. Which of TeamPicker / DashboardHost it
// picks (and with what props) is the whole team-and-hat routing decision.
const { auth, membershipsForEmail, isAdminEmail, redirect, cookieJar } = vi.hoisted(() => ({
  auth: vi.fn(), membershipsForEmail: vi.fn(), isAdminEmail: vi.fn(), redirect: vi.fn(), cookieJar: { values: {} }
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/directory", () => ({ membershipsForEmail, isAdminEmail }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name) => (name in cookieJar.values ? { name, value: cookieJar.values[name] } : undefined) })
}));
function TeamPickerStub() { return null; }
function DashboardHostStub() { return null; }
vi.mock("@/components/TeamPicker", () => ({ default: TeamPickerStub }));
vi.mock("@/components/DashboardHost", () => ({ default: DashboardHostStub }));

let savedSecret;
beforeEach(() => {
  vi.clearAllMocks();
  savedSecret = process.env.AUTH_SECRET;
  cookieJar.values = {};
  auth.mockResolvedValue({ user: { email: "me@a.com" } });
  isAdminEmail.mockReturnValue(false);
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
});

// AUTH_ON is module-load state, so set the env and reload the page module.
async function loadPage({ authOn = true } = {}) {
  if (authOn) process.env.AUTH_SECRET = "test-secret"; else delete process.env.AUTH_SECRET;
  vi.resetModules();
  return (await import("@/app/page")).default;
}

// Flatten every string in a React element tree.
function textOf(el) {
  if (el == null || typeof el === "boolean") return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(textOf).join("");
  return textOf(el.props?.children);
}
// First element (depth-first) matching a predicate.
function findEl(el, pred) {
  if (el == null || typeof el !== "object") return null;
  if (Array.isArray(el)) { for (const c of el) { const f = findEl(c, pred); if (f) return f; } return null; }
  if (pred(el)) return el;
  return findEl(el.props?.children, pred);
}

const A_COACH = { teamSlug: "a", teamName: "Team A", role: "coach" };
const A_PARENT = { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" };
const B_COACH = { teamSlug: "b", teamName: "Team B", role: "coach" };

describe("app/page (account mode)", () => {
  it("single team, single hat, no cookies -> DashboardHost with canSwitch false", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(DashboardHostStub);
    expect(el.props.canSwitch).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("two teams and no team_slug cookie -> TeamPicker (no preselect)", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, B_COACH] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(TeamPickerStub);
    expect(el.props.email).toBe("me@a.com");
    expect(el.props.memberships).toEqual([A_COACH, B_COACH]);
    expect(el.props.preselect).toBeUndefined();
  });

  it("a team_slug cookie naming a team the email doesn't hold is ignored", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, B_COACH] });
    cookieJar.values.team_slug = "zzz";
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(TeamPickerStub);
  });

  it("multi-hat team with team_slug but no act_as -> TeamPicker preselected on that team", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, A_PARENT] });
    const Page = await loadPage();
    // A lone team needs no team_slug cookie, but the hat still has to be chosen.
    let el = await Page();
    expect(el.type).toBe(TeamPickerStub);
    expect(el.props.preselect).toBe("a");
    // A forged act_as the email doesn't hold is treated as unset.
    cookieJar.values.team_slug = "a";
    cookieJar.values.act_as = "viewer";
    el = await Page();
    expect(el.type).toBe(TeamPickerStub);
    expect(el.props.preselect).toBe("a");
  });

  it("multi-hat team with a valid act_as -> DashboardHost with canSwitch true", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, A_PARENT] });
    cookieJar.values.team_slug = "a";
    cookieJar.values.act_as = "parent";
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(DashboardHostStub);
    expect(el.props.canSwitch).toBe(true);
  });

  it("two single-hat teams with a valid team_slug -> DashboardHost, canSwitch true", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, B_COACH] });
    cookieJar.values.team_slug = "b";
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(DashboardHostStub);
    expect(el.props.canSwitch).toBe(true);
  });

  it("empty club + super admin -> 'No teams yet' with an Open club admin link", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    isAdminEmail.mockImplementation((e) => e === "boss@dam.fund");
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const Page = await loadPage();
    const el = await Page();
    const text = textOf(el);
    expect(text).toContain("No teams yet");
    expect(text).toContain("You're the club's super admin. Create the first team to get started.");
    const link = findEl(el, (n) => n.type === "a" && n.props.href === "/admin");
    expect(link).toBeTruthy();
    expect(textOf(link)).toBe("Open club admin");
  });

  it("empty memberships for a plain user keeps the 'No team linked' message", async () => {
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const Page = await loadPage();
    const text = textOf(await Page());
    expect(text).toContain("No team linked to me@a.com");
    expect(text).toContain("Ask your coach to add this email");
    expect(text).not.toContain("Open club admin");
  });

  it("a super admin viewing as someone with no access sees the view-as variant, not the admin splash", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    isAdminEmail.mockImplementation((e) => e === "boss@dam.fund");
    cookieJar.values.view_as = encodeURIComponent("nobody@x.com");
    membershipsForEmail.mockResolvedValue({ memberships: [] });
    const Page = await loadPage();
    const text = textOf(await Page());
    expect(membershipsForEmail).toHaveBeenCalledWith("nobody@x.com");
    expect(text).toContain("No team linked to nobody@x.com");
    expect(text).toContain("exit view-as");
    expect(text).not.toContain("No teams yet");
  });

  it("view-as labels the picker email with '(viewing as)'", async () => {
    auth.mockResolvedValue({ user: { email: "boss@dam.fund" } });
    isAdminEmail.mockImplementation((e) => e === "boss@dam.fund");
    cookieJar.values.view_as = "mum@a.com";
    membershipsForEmail.mockResolvedValue({ memberships: [A_COACH, B_COACH] });
    const Page = await loadPage();
    const el = await Page();
    expect(el.type).toBe(TeamPickerStub);
    expect(el.props.email).toBe("mum@a.com (viewing as)");
  });

  it("no session -> redirect to /login", async () => {
    auth.mockResolvedValue(null);
    redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
    const Page = await loadPage();
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("app/page (legacy team-code mode)", () => {
  it("renders DashboardHost without touching auth or the directory", async () => {
    const Page = await loadPage({ authOn: false });
    const el = await Page();
    expect(el.type).toBe(DashboardHostStub);
    expect(el.props.canSwitch).toBeUndefined();
    expect(auth).not.toHaveBeenCalled();
    expect(membershipsForEmail).not.toHaveBeenCalled();
  });
});
