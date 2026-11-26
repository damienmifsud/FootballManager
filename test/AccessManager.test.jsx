// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

// The /admin page (Direction C restyle). Behaviour is what it always was:
// super admins manage club admins, per-team overrides and view-as through
// /api/access; club admins get the wizard, the role table and the league
// link only. The markup is the AdminShell's (sub-header, hairline cards,
// tinted pills, lucide icons).
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
// The wizard has its own test file; here it only needs to expose the hook the
// page hands it.
vi.mock("@/components/TeamWizard", () => ({
  default: ({ onTeamsChanged }) => <button data-testid="wizard" data-hook={onTeamsChanged ? "yes" : "no"} onClick={() => onTeamsChanged?.()}>wizard stub</button>
}));

import AccessManager from "@/components/AccessManager";
import { ADMIN_CSS } from "@/components/AdminShell";

const EMOJI = /\p{Extended_Pictographic}/u;
const TEAMS = [{ slug: "a", name: "Team A", coachEmails: [] }, { slug: "b", name: "Team B", coachEmails: [] }];

let doc;      // what GET /api/access answers with
let posts;    // every POST body, in order
let failNext; // { status, error } for the next POST
beforeEach(() => {
  doc = { teams: TEAMS, clubAdmins: ["td@club.com"], envClubAdmins: ["env@club.com"], overrides: {}, roles: ["coach", "parent", "viewer", "blocked"], viewingAs: null };
  posts = [];
  failNext = null;
  global.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).includes("/api/access")) throw new Error("unexpected fetch " + url);
    if (!opts.method || opts.method === "GET") return { ok: true, json: async () => JSON.parse(JSON.stringify(doc)) };
    const body = JSON.parse(opts.body);
    posts.push(body);
    if (failNext) { const f = failNext; failNext = null; return { ok: false, status: f.status, json: async () => ({ error: f.error }) }; }
    if (body.action === "addClubAdmin") doc.clubAdmins = [...doc.clubAdmins, body.email];
    if (body.action === "removeClubAdmin") doc.clubAdmins = doc.clubAdmins.filter((e) => e !== body.email);
    if (body.action === "setOverride") {
      const mine = { ...(doc.overrides[body.email] || {}) };
      if (body.role === null) delete mine[body.teamSlug]; else mine[body.teamSlug] = body.role;
      doc.overrides = { ...doc.overrides, [body.email]: mine };
      if (!Object.keys(mine).length) delete doc.overrides[body.email];
    }
    if (body.action === "clearViewAs") doc.viewingAs = null;
    return { ok: true, json: async () => ({ ok: true }) };
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderSuper = async () => {
  render(<AccessManager adminEmail="boss@club.com" scope="super" />);
  await screen.findByRole("heading", { name: "Club admins" });
};
const card = (heading) => screen.getByRole("heading", { name: heading }).closest("section");

describe("AccessManager — the shell", () => {
  it("uses the dashboard's sub-header: back to the team hub, title, role and email, sign out", async () => {
    await renderSuper();
    expect(screen.getByRole("heading", { level: 1, name: "Club admin" })).toBeTruthy();
    expect(screen.getByText("Super admin · boss@club.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the team hub" }).getAttribute("href")).toBe("/");
    document.cookie = "team_slug=a; path=/";
    document.cookie = "act_as=coach; path=/";
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
    // Signing out drops the team and hat cookies so the next login starts clean.
    expect(document.cookie).not.toContain("team_slug=a");
    expect(document.cookie).not.toContain("act_as=coach");
  });

  it("has no gradient, no emoji and no arrow glyphs left from the old look", async () => {
    doc.viewingAs = "mum@a.com"; // the state that used to show the eye emoji
    await renderSuper();
    expect(ADMIN_CSS).not.toMatch(/gradient/);
    expect(document.body.innerHTML).not.toMatch(/gradient/);
    expect(document.body.textContent).not.toMatch(EMOJI);
    expect(document.body.textContent).not.toMatch(/[▸↗←＋↻✕✓]/);
    // Tokens are the dashboard's.
    for (const token of ["--pitch:#C8102E", "--ink:#1A1012", "--paper:#F4F4F3", "--line:#E7E3E3", "'DM Sans'"]) expect(ADMIN_CSS).toContain(token);
  });

  it("puts Teams first, then the access cards, the role table and the league link", async () => {
    await renderSuper();
    const order = [...document.querySelectorAll("main .adm-col > *")].map((el) =>
      el.getAttribute("data-testid") || el.querySelector("h2")?.textContent || el.querySelector(".adm-lc-title")?.textContent);
    expect(order).toEqual(["wizard", "View as a user", "Club admins", "Per-team role overrides", "Who can do what", "League page"]);
    expect(screen.getByRole("link", { name: /League page/ }).getAttribute("href")).toBe("/league");
  });

  it("the role table is folded away until asked for", async () => {
    await renderSuper();
    const fold = screen.getByText("Who can do what").closest("details");
    expect(fold.open).toBe(false);
    expect(within(fold).getByText("Every role, every feature")).toBeTruthy();
    expect(within(fold).getByRole("table", { hidden: true })).toBeTruthy();
  });
});

describe("AccessManager — club admins", () => {
  it("lists env and managed club admins; only managed ones can be removed", async () => {
    await renderSuper();
    const c = within(card("Club admins"));
    expect(c.getByText("env@club.com")).toBeTruthy();
    expect(c.getByText("Set in the environment")).toBeTruthy();
    expect(c.getByText("td@club.com")).toBeTruthy();
    expect(c.queryByRole("button", { name: "Remove env@club.com" })).toBeNull();
    fireEvent.click(c.getByRole("button", { name: "Remove td@club.com" }));
    await waitFor(() => expect(c.queryByText("td@club.com")).toBeNull());
    expect(posts).toEqual([{ action: "removeClubAdmin", email: "td@club.com" }]);
  });

  it("Add is disabled until there is an email, then posts addClubAdmin and reloads", async () => {
    await renderSuper();
    const c = within(card("Club admins"));
    const add = c.getByRole("button", { name: "Add" });
    expect(add.disabled).toBe(true);
    fireEvent.change(c.getByLabelText("Club admin email"), { target: { value: "new@club.com" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(await c.findByText("new@club.com")).toBeTruthy();
    expect(posts).toEqual([{ action: "addClubAdmin", email: "new@club.com" }]);
    expect(c.getByLabelText("Club admin email").value).toBe("");
  });

  it("says so when there are none", async () => {
    doc.clubAdmins = []; doc.envClubAdmins = [];
    await renderSuper();
    expect(within(card("Club admins")).getByText("No club admins yet.")).toBeTruthy();
  });
});

describe("AccessManager — view as", () => {
  it("posts viewAs for the typed email", async () => {
    await renderSuper();
    const c = within(card("View as a user"));
    const go = c.getByRole("button", { name: "View as" });
    expect(go.disabled).toBe(true);
    fireEvent.change(c.getByLabelText("Email to view as"), { target: { value: "mum@a.com" } });
    fireEvent.click(go);
    await waitFor(() => expect(posts).toEqual([{ action: "viewAs", email: "mum@a.com" }]));
  });

  it("while viewing as someone: a pill names them, with Open their view and Exit view-as", async () => {
    doc.viewingAs = "mum@a.com";
    await renderSuper();
    const c = within(card("View as a user"));
    expect(c.getByText("Viewing as mum@a.com")).toBeTruthy();
    expect(c.getByRole("link", { name: "Open their view" }).getAttribute("href")).toBe("/");
    expect(c.queryByLabelText("Email to view as")).toBeNull();
    fireEvent.click(c.getByRole("button", { name: "Exit view-as" }));
    expect(await c.findByLabelText("Email to view as")).toBeTruthy();
    expect(posts).toEqual([{ action: "clearViewAs" }]);
  });

  it("a refusal is shown as an alert and the form stays usable", async () => {
    await renderSuper();
    const c = within(card("View as a user"));
    failNext = { status: 400, error: "you already are the super admin" };
    fireEvent.change(c.getByLabelText("Email to view as"), { target: { value: "boss@club.com" } });
    fireEvent.click(c.getByRole("button", { name: "View as" }));
    expect((await screen.findByRole("alert")).textContent).toBe("you already are the super admin");
    await waitFor(() => expect(c.getByRole("button", { name: "View as" }).disabled).toBe(false));
  });
});

describe("AccessManager — per-team overrides", () => {
  it("lists overrides with the team name and a role pill, and clears one", async () => {
    doc.overrides = { "x@a.com": { b: "blocked" }, "y@a.com": { a: "coach" } };
    await renderSuper();
    const c = within(card("Per-team role overrides"));
    const row = c.getByText("x@a.com").closest(".adm-row");
    expect(within(row).getByText("Team B")).toBeTruthy();
    expect(within(row).getByText("Blocked").className).toContain("bad");
    expect(within(c.getByText("y@a.com").closest(".adm-row")).getByText("Coach").className).toContain("ok");
    fireEvent.click(c.getByRole("button", { name: "Clear the override for x@a.com on Team B" }));
    await waitFor(() => expect(c.queryByText("x@a.com")).toBeNull());
    expect(posts).toEqual([{ action: "setOverride", email: "x@a.com", teamSlug: "b", role: null }]);
  });

  it("sets an override for the chosen team and role", async () => {
    await renderSuper();
    const c = within(card("Per-team role overrides"));
    expect(c.getByText("No overrides set.")).toBeTruthy();
    expect(c.getByLabelText("Team").value).toBe("a"); // defaults to the first team
    expect(c.getByLabelText("Role").value).toBe("viewer");
    fireEvent.change(c.getByLabelText("Email for the override"), { target: { value: "z@a.com" } });
    fireEvent.change(c.getByLabelText("Team"), { target: { value: "b" } });
    fireEvent.change(c.getByLabelText("Role"), { target: { value: "parent" } });
    fireEvent.click(c.getByRole("button", { name: "Set" }));
    expect(await c.findByText("z@a.com")).toBeTruthy();
    expect(posts).toEqual([{ action: "setOverride", email: "z@a.com", teamSlug: "b", role: "parent" }]);
    expect(within(c.getByText("z@a.com").closest(".adm-row")).getByText("Parent").className).toContain("info");
  });

  it("with no teams yet there is nothing to override: a note replaces the form, and no error is raised", async () => {
    doc.teams = [];
    await renderSuper();
    const c = within(card("Per-team role overrides"));
    expect(c.getByText("Add a team first, then set overrides for it here.")).toBeTruthy();
    expect(c.queryByLabelText("Team")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the team menu follows the wizard: a team created there appears here without a reload", async () => {
    await renderSuper();
    expect(screen.getByTestId("wizard").getAttribute("data-hook")).toBe("yes");
    doc.teams = [...TEAMS, { slug: "c", name: "Team C", coachEmails: [] }];
    fireEvent.click(screen.getByTestId("wizard")); // the wizard reports a change
    const c = within(card("Per-team role overrides"));
    expect(await c.findByRole("option", { name: "Team C" })).toBeTruthy();
  });
});

describe("AccessManager — club admin scope", () => {
  it("shows the wizard, the role table and the league link, and never touches /api/access", async () => {
    render(<AccessManager adminEmail="td@club.com" scope="club" />);
    expect(screen.getByRole("heading", { level: 1, name: "Club teams" })).toBeTruthy();
    expect(screen.getByText("Club admin · td@club.com")).toBeTruthy();
    expect(screen.getByTestId("wizard").getAttribute("data-hook")).toBe("no");
    expect(screen.getByText("Who can do what")).toBeTruthy();
    expect(screen.getByRole("link", { name: /League page/ })).toBeTruthy();
    for (const h of ["Club admins", "View as a user", "Per-team role overrides"]) expect(screen.queryByRole("heading", { name: h })).toBeNull();
    expect(screen.queryByText("Loading access settings…")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("AccessManager — loading and failure", () => {
  it("shows a quiet loading card until the access document arrives", async () => {
    let release;
    global.fetch = vi.fn(() => new Promise((res) => { release = () => res({ ok: true, json: async () => doc }); }));
    render(<AccessManager adminEmail="boss@club.com" scope="super" />);
    expect(screen.getByText("Loading access settings…")).toBeTruthy();
    expect(screen.getByTestId("wizard")).toBeTruthy(); // teams are usable straight away
    release();
    expect(await screen.findByRole("heading", { name: "Club admins" })).toBeTruthy();
    expect(screen.queryByText("Loading access settings…")).toBeNull();
  });

  it("a failed load is an alert, not an endless spinner", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) }));
    render(<AccessManager adminEmail="boss@club.com" scope="super" />);
    expect((await screen.findByRole("alert")).textContent).toBe("forbidden");
    expect(screen.queryByText("Loading access settings…")).toBeNull();
  });
});
