// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// The league page (Direction C restyle): the Squadi draw embedded under the
// dashboard's sub-header, with the coach's set-up card. The logic is what it
// was (who may set up, what is saved, what the sync reports); these pin it
// through the new markup.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
import LeaguePage from "@/app/league/page";
import { ADMIN_CSS } from "@/components/AdminShell";

const SAVED = { mode: "url", url: "https://registration.squadi.com/liveScoreSeasonFixture?x=1", org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" };
let me, data, dataStatus, saveReply, syncReply, posts;
const json = (ok, status, body) => ({ ok, status, json: async () => body });
beforeEach(() => {
  me = { mode: "account", role: "coach", teamName: "Olympic FC U8 White" };
  data = { team: { name: "Olympic FC U8 White" }, fixtures: [], squadi: SAVED };
  dataStatus = 200; saveReply = json(true, 200, { ok: true }); syncReply = json(true, 200, { ok: true, changes: [] }); posts = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/api/me")) return json(true, 200, me);
    if (u.includes("/api/sync")) return syncReply;
    if (u.includes("/api/data")) {
      if (opts.method === "POST") { posts.push(JSON.parse(opts.body)); return saveReply; }
      return dataStatus === 200 ? json(true, 200, data) : json(false, dataStatus, { error: "nope" });
    }
    throw new Error("unexpected fetch " + u);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const frame = () => document.querySelector("iframe");

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
    expect(document.body.innerHTML).not.toMatch(/gradient/);
    expect(document.body.textContent).not.toMatch(/[↗←]/);
    expect(ADMIN_CSS).not.toMatch(/gradient/);
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

  it("opens the set-up card by itself when nothing is saved yet", async () => {
    data = { ...data, squadi: undefined };
    render(<LeaguePage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
    // Build from filters is the default; its fields are labelled.
    expect(screen.getByRole("button", { name: "Build from filters" }).getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Year", "Division ID (age group)", "Competition key", "Organisation key", "Team ID (optional, pins one team)"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Paste full URL" }));
    expect(screen.getByLabelText("Squadi embed URL")).toBeTruthy();
    expect(screen.queryByLabelText("Competition key")).toBeNull();
  });

  it("Save for everyone posts the team document with the new config and closes the card", async () => {
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.change(screen.getByLabelText("Squadi embed URL"), { target: { value: "https://registration.squadi.com/liveScoreSeasonFixture?y=2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ ...data, squadi: { ...SAVED, url: "https://registration.squadi.com/liveScoreSeasonFixture?y=2" } });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull());
    expect(frame().getAttribute("src")).toBe("https://registration.squadi.com/liveScoreSeasonFixture?y=2");
  });

  it("a refused save shows the server's reason as an alert and keeps the card open", async () => {
    saveReply = json(false, 403, { error: "Only coaches can change the league setup." });
    render(<LeaguePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for everyone" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Only coaches can change the league setup.");
    expect(screen.getByRole("heading", { level: 2, name: "Set up" })).toBeTruthy();
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

  it("no team linked: says so instead of bouncing to login", async () => {
    dataStatus = 401;
    render(<LeaguePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("No team linked to your account. Ask your coach to add you to the team.");
  });

  it("another load failure shows the server's reason", async () => {
    dataStatus = 500;
    render(<LeaguePage />);
    expect((await screen.findByRole("alert")).textContent).toBe("nope");
  });

  it("with no usable link there is a calm empty card instead of a frame", async () => {
    data = { ...data, squadi: { ...SAVED, mode: "builder", comp: "" } };
    me = { mode: "account", role: "parent", teamName: "T" };
    render(<LeaguePage />);
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(screen.getByText("The coach has not linked the Squadi fixtures for this team yet.")).toBeTruthy();
    expect(frame()).toBeNull();
  });
});
