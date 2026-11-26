// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// The league page: the Squadi draw embedded under the dashboard's sub-header,
// with the coach's set-up card. It reads and saves ONLY the team's league
// set-up, through the narrow /api/league route, and holds no team's ids of
// its own: a team with nothing saved shows "Not configured yet." rather than
// anybody's draw (it used to embed one hard-coded team's fixtures for every
// team that had not saved a set-up).
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
import LeaguePage from "@/app/league/page";
import { ADMIN_CSS } from "@/components/AdminShell";

const FQ_METRO = "b0e92958-980b-4da0-9ec9-a9c2597b06f0";
const SQUADI = "https://registration.squadi.com/liveScoreSeasonFixture?";
const SAVED = { mode: "url", url: SQUADI + "x=1", org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" };
// What the server sends the one team that predates the set-up panel (the
// legacy owner) when it has saved nothing: see lib/leagueSetup.js.
const LEGACY = { mode: "builder", url: "", org: FQ_METRO, yearId: "8", comp: "58ec2bda-ceed-48f2-a33e-5b9d13cc30e8", divisionId: "10661", teamId: "110013" };
// Nothing from the old hard-coded default may reach another team's page: its
// team and age-group names, its division and team ids, its competition keys.
const OTHER_TEAM = /Kangaroos|MiniRoos|Under 8|110013|10661|58ec2bda|b63aa285/;

let me, meStatus, meGate, league, leagueStatus, leagueGate, saveReply, saveGate, syncReply, posts, calls, failing;
const json = (ok, status, body) => ({ ok, status, json: async () => body });
// A promise the test settles by hand, to hold one answer back.
const gate = () => { let open; const p = new Promise((r) => { open = r; }); p.open = open; return p; };
beforeEach(() => {
  me = { mode: "account", role: "coach", teamName: "Olympic FC U8 White" };
  league = { teamSlug: "u8-white", squadi: SAVED, saved: true };
  meStatus = 200; meGate = null; leagueStatus = 200; leagueGate = null; saveReply = null; saveGate = null;
  syncReply = json(true, 200, { ok: true, changes: [] }); posts = []; calls = []; failing = "";
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const call = (opts.method || "GET") + " " + u;
    calls.push(call);
    if (failing && call === failing) throw new Error("boom");
    if (u.includes("/api/me")) {
      if (meGate) await meGate;
      return meStatus === 200 ? json(true, 200, me) : json(false, meStatus, { error: "unauthorized" });
    }
    if (u.includes("/api/sync")) return syncReply;
    if (u.includes("/api/league")) {
      if (opts.method === "POST") {
        const body = JSON.parse(opts.body);
        posts.push(body);
        if (saveGate) await saveGate;
        // The real route echoes the sanitised set-up it stored.
        return saveReply || json(true, 200, { ok: true, squadi: body.squadi });
      }
      if (leagueGate) await leagueGate;
      return leagueStatus === 200 ? json(true, 200, league) : json(false, leagueStatus, { error: "nope" });
    }
    // In particular /api/data: the page must never read or write the whole team document.
    throw new Error("unexpected fetch " + u);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const frame = () => document.querySelector("iframe");
const notConfigured = () => screen.queryByText("Not configured yet.");

describe("League page", () => {
  it("wears the dashboard's sub-header and embeds the saved draw", async () => {
    render(<LeaguePage />);
    expect(screen.getByRole("heading", { level: 1, name: "League fixtures and ladder" })).toBeTruthy();
    expect(await screen.findByText("Olympic FC U8 White · Squadi")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the team hub" }).getAttribute("href")).toBe("/");
    await waitFor(() => expect(frame().getAttribute("src")).toBe(SAVED.url));
    expect(frame().getAttribute("title")).toBe("Squadi fixtures");
    const full = screen.getByRole("link", { name: "Open full page" });
    expect(full.getAttribute("href")).toBe(SAVED.url);
    expect(full.getAttribute("target")).toBe("_blank");
    expect(notConfigured()).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/gradient/);
    expect(document.body.textContent).not.toMatch(/[↗←]/);
    expect(ADMIN_CSS).not.toMatch(/gradient/);
    // The set-up comes from its own route; the team document is never fetched.
    expect(calls.filter((c) => c.includes("/api/league"))).toEqual(["GET /api/league"]);
    expect(calls.some((c) => c.includes("/api/data"))).toBe(false);
  });

  it("a coach can open Set up; a parent never sees it", async () => {
    render(<LeaguePage />);
    const toggle = await screen.findByRole("button", { name: "Set up" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull(); // closed: a config is already saved
    fireEvent.click(toggle);
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" }).getAttribute("aria-expanded")).toBe("true");
    cleanup();
    me = { mode: "account", role: "parent", teamName: "Olympic FC U8 White" };
    render(<LeaguePage />);
    await waitFor(() => expect(frame()).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("team-code mode has no roles: anyone with the code can set up", async () => {
    me = { mode: "code", role: null, teamName: "" };
    render(<LeaguePage />);
    expect(await screen.findByRole("button", { name: "Set up" })).toBeTruthy();
    expect(screen.getByText("Squadi")).toBeTruthy(); // kicker without a team name
  });

  it("opens the set-up card by itself when nothing is saved yet, on an empty form", async () => {
    me = { mode: "account", role: "coach", teamName: "Olympic FC Over 35s" };
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    render(<LeaguePage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    // Build from filters is the default; its fields are labelled.
    expect(screen.getByRole("button", { name: "Build from filters" }).getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Year", "Division ID (age group)", "Competition key", "Organisation key", "Team ID (optional, pins one team)"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // Only the region and the year are filled in: no competition, age group or team.
    expect(screen.getByLabelText("Year").value).toBe("8");
    expect(screen.getByLabelText("Organisation key").value).toBe(FQ_METRO);
    expect(screen.getByLabelText("Competition key").value).toBe("");
    expect(screen.getByLabelText("Division ID (age group)").value).toBe("");
    expect(screen.getByLabelText("Team ID (optional, pins one team)").value).toBe("");
    // Still no draw, and the coach's version of the empty card.
    expect(frame()).toBeNull();
    expect(notConfigured()).toBeTruthy();
    expect(screen.getByText(/either build the link from filters or paste the embed URL/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paste full URL" }));
    expect(screen.getByLabelText("Squadi embed URL")).toBeTruthy();
    expect(screen.queryByLabelText("Competition key")).toBeNull();
  });

  it("a team with nothing saved shows Not configured yet, never another team's draw", async () => {
    me = { mode: "account", role: "parent", teamName: "Olympic FC Over 35s" };
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    render(<LeaguePage />);
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(screen.getByText("The coach has not linked the Squadi fixtures for this team yet.")).toBeTruthy();
    expect(frame()).toBeNull();
    expect(screen.queryByRole("link", { name: "Open full page" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(OTHER_TEAM);
    // The same holds for the coach, with the set-up card open on top.
    cleanup();
    me = { mode: "account", role: "coach", teamName: "Olympic FC Over 35s" };
    render(<LeaguePage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    expect(frame()).toBeNull();
    expect(document.body.innerHTML).not.toMatch(OTHER_TEAM);
  });

  it("embeds nothing, and claims nothing, until the team's own set-up has arrived", async () => {
    leagueGate = gate();
    render(<LeaguePage />);
    // /api/me has answered; /api/league has not.
    expect(await screen.findByText("Olympic FC U8 White · Squadi")).toBeTruthy();
    expect(frame()).toBeNull();
    expect(notConfigured()).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(OTHER_TEAM);
    await act(async () => { leagueGate.open(); });
    await waitFor(() => expect(frame().getAttribute("src")).toBe(SAVED.url));
    expect(screen.getByRole("button", { name: "Set up" })).toBeTruthy();
  });

  it("the legacy owner's default comes from the server and is embedded like any set-up", async () => {
    me = { mode: "account", role: "parent", teamName: "Olympic FC U8 Kangaroos White" };
    league = { teamSlug: "kangaroos-white", squadi: LEGACY, saved: false };
    render(<LeaguePage />);
    const built = SQUADI + `organisationKey=${FQ_METRO}&yearId=8&competitionUniqueKey=${LEGACY.comp}&divisionId=10661&teamId=110013`;
    await waitFor(() => expect(frame().getAttribute("src")).toBe(built));
    expect(screen.getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe(built);
    expect(notConfigured()).toBeNull();
    // Its coach still gets the set-up card opened (nothing is saved), filled in with those values.
    cleanup();
    me = { mode: "account", role: "coach", teamName: "Olympic FC U8 Kangaroos White" };
    render(<LeaguePage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    expect(screen.getByLabelText("Competition key").value).toBe(LEGACY.comp);
    expect(screen.getByLabelText("Division ID (age group)").value).toBe("10661");
    expect(screen.getByLabelText("Team ID (optional, pins one team)").value).toBe("110013");
    expect(frame().getAttribute("src")).toBe(built);
  });

  it("the set-up note names the current team and no other, and links to Squadi's fixtures page", async () => {
    me = { mode: "account", role: "coach", teamName: "Olympic FC Over 35s" };
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    render(<LeaguePage />);
    const note = await screen.findByText(/One-time setup for/);
    expect(note.textContent).toBe("One-time setup for Olympic FC Over 35s:");
    const text = note.closest(".adm-note").textContent;
    expect(text).toMatch(/open the Squadi fixtures page \(the link below\) and choose the year, organisation, competition, age group and team\./);
    expect(text).toMatch(/Copy that URL, switch to Paste full URL here, paste it and Save for everyone\.$/);
    // Nothing is showing yet, so the note gives the starting point itself:
    // Squadi's page for the organisation and year in the form, no competition chosen.
    const start = screen.getByRole("link", { name: "Open the Squadi fixtures page" });
    expect(start.getAttribute("href")).toBe(SQUADI + `organisationKey=${FQ_METRO}&yearId=8`);
    expect(start.getAttribute("target")).toBe("_blank");
    expect(start.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "7" } });
    expect(start.getAttribute("href")).toBe(SQUADI + `organisationKey=${FQ_METRO}&yearId=7`);
    // No hard-coded team, age group or competition anywhere in the card, placeholders included.
    expect(document.body.innerHTML).not.toMatch(OTHER_TEAM);
    expect(screen.getByLabelText("Competition key").getAttribute("placeholder")).toBe("competitionUniqueKey from the Squadi link");
  });

  it("the set-up note says this team when the team has no name to show", async () => {
    me = { mode: "code", role: null, teamName: "" };
    league = { teamSlug: "default", squadi: null, saved: false };
    render(<LeaguePage />);
    expect((await screen.findByText(/One-time setup for/)).textContent).toBe("One-time setup for this team:");
  });

  it("the Year list offers 2027, and a set-up built for it carries Squadi's id for that season", async () => {
    league = { teamSlug: "u9-academy", squadi: null, saved: false };
    render(<LeaguePage />);
    await screen.findByRole("heading", { level: 2, name: "Set up" });
    const year = screen.getByLabelText("Year");
    expect([...year.options].map((o) => [o.textContent, o.value])).toEqual([["2027", "9"], ["2026", "8"], ["2025", "7"]]);
    fireEvent.change(year, { target: { value: "9" } });
    expect(screen.getByRole("link", { name: "Open the Squadi fixtures page" }).getAttribute("href")).toBe(SQUADI + `organisationKey=${FQ_METRO}&yearId=9`);
    fireEvent.change(screen.getByLabelText("Organisation key"), { target: { value: "74f39f3a-6e73-48a8-b837-705aba4c4512" } });
    fireEvent.change(screen.getByLabelText("Competition key"), { target: { value: "51b128e2-c6ac-4416-8ae6-dc59504cdaf2" } });
    fireEvent.change(screen.getByLabelText("Division ID (age group)"), { target: { value: "12962" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].squadi).toMatchObject({ mode: "builder", yearId: "9", org: "74f39f3a-6e73-48a8-b837-705aba4c4512", comp: "51b128e2-c6ac-4416-8ae6-dc59504cdaf2", divisionId: "12962" });
    const frame = await waitFor(() => { const f = document.querySelector("iframe"); expect(f).toBeTruthy(); return f; });
    expect(frame.getAttribute("src")).toBe(SQUADI + "organisationKey=74f39f3a-6e73-48a8-b837-705aba4c4512&yearId=9&competitionUniqueKey=51b128e2-c6ac-4416-8ae6-dc59504cdaf2&divisionId=12962");
  });

  it("a set-up saved for 2027 opens showing 2027, not the first year on the list by default", async () => {
    league = { teamSlug: "u9-academy", squadi: { mode: "builder", url: "", org: FQ_METRO, yearId: "9", comp: "c", divisionId: "1", teamId: "" }, saved: true };
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    const year = screen.getByLabelText("Year");
    expect(year.value).toBe("9");
    expect(year.selectedOptions[0].textContent).toBe("2027");
    expect(year.options).toHaveLength(3);
  });

  it("a set-up whose season this page does not know keeps it: the list shows that id rather than another year", async () => {
    league = { teamSlug: "u9-academy", squadi: { mode: "builder", url: "", org: FQ_METRO, yearId: "10", comp: "c", divisionId: "1", teamId: "" }, saved: true };
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    const year = screen.getByLabelText("Year");
    expect(year.value).toBe("10");
    expect([...year.options].map((o) => [o.textContent, o.value])).toEqual([["Season id 10", "10"], ["2027", "9"], ["2026", "8"], ["2025", "7"]]);
    // Saving without touching the year keeps it.
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].squadi.yearId).toBe("10");
    // Once a known year is chosen the unknown one is no longer offered.
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "9" } });
    expect(screen.getByLabelText("Year").options).toHaveLength(3);
  });

  it("Save for everyone posts only the league set-up to its narrow route and closes the card", async () => {
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.change(screen.getByLabelText("Squadi embed URL"), { target: { value: SQUADI + "y=2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // The set-up, and the team the page loaded it for. Nothing else: no team
    // document, players, fixtures or sessions ride along.
    expect(posts[0]).toEqual({ teamSlug: "u8-white", squadi: { ...SAVED, url: SQUADI + "y=2" } });
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /api/league"]);
    expect(calls.some((c) => c.includes("/api/data"))).toBe(false);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull());
    expect(frame().getAttribute("src")).toBe(SQUADI + "y=2");
  });

  it("after a save the page shows what the server stored, not what was typed", async () => {
    me = { mode: "account", role: "coach", teamName: "Olympic FC Over 35s" };
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    const stored = { mode: "url", url: SQUADI + "z=3", org: FQ_METRO, yearId: "8", comp: "", divisionId: "", teamId: "" };
    saveReply = json(true, 200, { ok: true, squadi: stored });
    render(<LeaguePage />);
    await screen.findByRole("heading", { level: 2, name: "Set up" });
    fireEvent.click(screen.getByRole("button", { name: "Paste full URL" }));
    fireEvent.change(screen.getByLabelText("Squadi embed URL"), { target: { value: "  " + SQUADI + "z=3  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull());
    expect(posts[0].teamSlug).toBe("over-35s");
    expect(posts[0].squadi.url).toBe("  " + SQUADI + "z=3  "); // sent as typed; the server tidies it
    expect(frame().getAttribute("src")).toBe(SQUADI + "z=3");
    expect(notConfigured()).toBeNull();
    // Reopened by hand, the field holds the stored link.
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.getByLabelText("Squadi embed URL").value).toBe(SQUADI + "z=3");
  });

  it("a refused save shows the server's reason as an alert and keeps the card open", async () => {
    saveReply = json(false, 403, { error: "Only coaches can change the league setup." });
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only coaches can change the league setup.");
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
  });

  it("a save meant for another team is refused out loud and the card stays open", async () => {
    // The team was switched in another tab after this page loaded: the server
    // acts on the cookies' team, sees the page's team is a different one, and refuses.
    saveReply = json(false, 412, { error: "This page was opened for another team. Reload it, then save again." });
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This page was opened for another team. Reload it, then save again.");
    expect(posts[0].teamSlug).toBe("u8-white");
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save for everyone" }).disabled).toBe(false);
  });

  it("while a save is in flight the button says so and cannot be pressed twice", async () => {
    saveGate = gate();
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    const busy = await screen.findByRole("button", { name: "Saving…" });
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(posts).toHaveLength(1);
    await act(async () => { saveGate.open(); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull());
    expect(posts).toHaveLength(1);
  });

  it("a save that cannot reach the server says so and can be tried again", async () => {
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    failing = "POST /api/league";
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Save failed: boom");
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    failing = "";
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull());
    // The old failure is gone for good: reopening the card does not bring it back.
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Sync now reports what changed, or that nothing did", async () => {
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    expect((await screen.findByRole("status")).textContent).toBe("Already up to date with Squadi.");
    syncReply = json(true, 200, { ok: true, changes: ["R5 moved to 09:00", "R6 venue changed"] });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Updated 2 items: R5 moved to 09:00 · R6 venue changed"));
    syncReply = json(false, 500, { ok: false, error: "squadi down" });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Sync failed: squadi down"));
  });

  it("Sync now names a draw that could not be fetched, beside what the others changed", async () => {
    // A team can have several draws (its season and other competitions): one failing never hides the rest.
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    syncReply = json(true, 200, { ok: true, changes: ["R5 moved to 09:00"], failed: [{ name: "Winterfest", error: "Squadi responded 404" }] });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    expect((await screen.findByRole("status")).textContent).toBe("Updated 1 item: R5 moved to 09:00 Could not sync Winterfest (Squadi responded 404).");
    syncReply = json(true, 200, { ok: true, changes: [], failed: [{ name: "Season", error: "Squadi responded 503" }, { name: "Winterfest", error: "Unexpected Squadi response shape" }] });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Already up to date with Squadi. Could not sync Season (Squadi responded 503); Winterfest (Unexpected Squadi response shape)."));
    // An empty list is no failure at all.
    syncReply = json(true, 200, { ok: true, changes: [], failed: [] });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Already up to date with Squadi."));
  });

  it("Sync now says so when no draw is set up yet, rather than claiming to be up to date", async () => {
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    syncReply = json(true, 200, { ok: true, changes: [], team: "u8-white", skipped: "no squadi config" });
    fireEvent.click(screen.getByRole("button", { name: "Sync fixtures from Squadi now" }));
    expect((await screen.findByRole("status")).textContent).toBe("No Squadi draw is set up for this team yet.");
  });

  it("no team linked: says so instead of bouncing to login, and shows no draw", async () => {
    leagueStatus = 401;
    render(<LeaguePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("No team linked to your account. Ask your coach to add you to the team.");
    expect(frame()).toBeNull();
    expect(notConfigured()).toBeNull(); // not known, so not claimed
    expect(document.body.innerHTML).not.toMatch(OTHER_TEAM);
  });

  it("another load failure shows the server's reason, and offers no set-up over a set-up it could not read", async () => {
    leagueStatus = 500;
    render(<LeaguePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
    expect(await screen.findByText("Olympic FC U8 White · Squadi")).toBeTruthy(); // /api/me answered: a coach
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(frame()).toBeNull();
    expect(notConfigured()).toBeNull();
  });

  it("a load that cannot reach the server says so and shows no draw", async () => {
    failing = "GET /api/league";
    render(<LeaguePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not load the team.");
    expect(frame()).toBeNull();
    expect(notConfigured()).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("the empty card waits to know who is looking: a coach is never shown the parent wording first", async () => {
    me = { mode: "account", role: "coach", teamName: "Olympic FC Over 35s" };
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    meGate = gate();
    render(<LeaguePage />);
    // /api/league has answered (nothing saved); /api/me has not.
    await waitFor(() => expect(calls).toContain("GET /api/league"));
    await act(async () => {});
    expect(notConfigured()).toBeNull();
    expect(screen.queryByText(/The coach has not linked/)).toBeNull();
    await act(async () => { meGate.open(); });
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(screen.getByText(/either build the link from filters or paste the embed URL/)).toBeTruthy();
    expect(screen.queryByText(/The coach has not linked/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
  });

  it("when /api/me cannot say who is looking, the page is read only", async () => {
    meStatus = 401;
    league = { teamSlug: "over-35s", squadi: null, saved: false };
    render(<LeaguePage />);
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(screen.getByText("The coach has not linked the Squadi fixtures for this team yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
    expect(screen.getByText("Squadi")).toBeTruthy(); // kicker without a team name
  });

  it("with no usable link there is a calm empty card instead of a frame", async () => {
    league = { teamSlug: "t", squadi: { ...SAVED, mode: "builder", comp: "" }, saved: true };
    me = { mode: "account", role: "parent", teamName: "T" };
    render(<LeaguePage />);
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(screen.getByText("The coach has not linked the Squadi fixtures for this team yet.")).toBeTruthy();
    expect(frame()).toBeNull();
  });
});
