// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";

// The league page and the draws the club's set-up holds a fixtures link for
// (pasted in the team wizard). The season's Squadi draw is shown in place for
// a team with no set-up of its own, and every draw is listed to be opened: a
// competition on Dribl is a link out, never something the page reads. In a
// file of its own, beside test/league.test.jsx. Every key, id and name is
// made up.
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
import LeaguePage from "@/app/league/page";

const KEY = "11111111-2222-4333-8444-555555555555";
const SQ = `https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const SQ2 = SQ.replace("20001", "20002").replace("300001", "300002");
const DR = "https://winterleague.dribl.com/fixtures?season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468";
const OWN = { mode: "url", url: "https://registration.squadi.com/liveScoreSeasonFixture?own=1", org: "o", yearId: "8", comp: "c", divisionId: "1", teamId: "2" };
const SEASON = { name: "Season", provider: "squadi", link: SQ, season: true };
const DRIBL = { name: "Premier Invitational", provider: "dribl", link: DR };

let me, league;
beforeEach(() => {
  me = { mode: "account", role: "parent", teamName: "Riverside FC U8 Blues" };
  league = { teamSlug: "u8-blues", squadi: null, saved: false, draws: [] };
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/me")) return { ok: true, status: 200, json: async () => me };
    if (u.includes("/api/league")) return { ok: true, status: 200, json: async () => league };
    throw new Error("unexpected fetch " + u);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const frame = () => document.querySelector("iframe");
const show = async () => { render(<LeaguePage />); await screen.findByText("Riverside FC U8 Blues · Squadi"); await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2)); };
const drawsCard = () => { const h = screen.queryByRole("heading", { name: "Draws" }); return h ? within(h.closest("section")) : null; };
const rows = () => [...document.querySelectorAll("section[aria-labelledby='league-draws'] .adm-row")].map((r) => ({
  name: r.querySelector(".adm-row-main").firstChild.textContent, on: r.querySelector(".adm-row-sub").textContent, href: r.querySelector("a").getAttribute("href")
}));

describe("the season's draw from the club's set-up", () => {
  it("is shown in place for a team with no set-up of its own, with nothing more to do", async () => {
    league.draws = [SEASON];
    await show();
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(SQ));
    expect(screen.getByRole("link", { name: "Open full page" }).getAttribute("href")).toBe(SQ);
    expect(screen.queryByText("Not configured yet.")).toBeNull();
    expect(drawsCard()).toBeNull(); // the one draw is the one showing
  });

  it("does not open the set-up form on a coach who has nothing left to set up", async () => {
    me.role = "coach";
    league.draws = [SEASON];
    await show();
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(SQ));
    expect(screen.getByRole("button", { name: "Set up" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "Set up" })).toBeNull();
  });

  it("gives way to the team's own set-up, and is then listed to be opened", async () => {
    league = { teamSlug: "u8-blues", squadi: OWN, saved: true, draws: [SEASON] };
    await show();
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(OWN.url));
    expect(rows()).toEqual([{ name: "Season", on: "On Squadi", href: SQ }]);
  });

  it("a two-team squad shows its first side's draw and lists both", async () => {
    league.draws = [{ ...SEASON, name: "Season · Red", side: "Red" }, { name: "Season · White", provider: "squadi", link: SQ2, season: true, side: "White" }];
    await show();
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(SQ));
    expect(rows().map((r) => [r.name, r.href])).toEqual([["Season · Red", SQ], ["Season · White", SQ2]]);
  });
});

describe("the list of draws", () => {
  it("names each one and the site it is on, and opens it in a new tab", async () => {
    league.draws = [SEASON, DRIBL];
    await show();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()).toEqual([{ name: "Season", on: "On Squadi", href: SQ }, { name: "Premier Invitational", on: "On Dribl", href: DR }]);
    for (const a of drawsCard().getAllByRole("link", { name: "Open the draw" })) {
      expect([a.getAttribute("target"), a.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    }
  });

  it("a competition on Dribl is a link out, never put in the page; a team with only that is not called not configured", async () => {
    league.draws = [DRIBL];
    await show();
    await waitFor(() => expect(rows()).toEqual([{ name: "Premier Invitational", on: "On Dribl", href: DR }]));
    expect(frame()).toBeNull();
    expect(screen.queryByText("Not configured yet.")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/<iframe/);
  });

  it("another competition's Squadi draw is listed, not shown in place of a season that has no link", async () => {
    league.draws = [{ name: "Winterfest", provider: "squadi", link: SQ2 }];
    await show();
    await waitFor(() => expect(rows()).toEqual([{ name: "Winterfest", on: "On Squadi", href: SQ2 }]));
    expect(frame()).toBeNull();
  });

  it("ignores anything that is not an https link, however it got there", async () => {
    league.draws = [{ name: "Odd", provider: "dribl", link: "javascript:alert(1)" }, { name: "Plain", provider: "squadi", link: "http://registration.squadi.com/x", season: true }, null, "nope", DRIBL];
    await show();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0].name).toBe("Premier Invitational");
    expect(frame()).toBeNull();
    expect(document.body.innerHTML).not.toContain("javascript:");
  });

  it("with no draws and nothing saved the page says so, as it always has", async () => {
    await show();
    expect(await screen.findByText("Not configured yet.")).toBeTruthy();
    expect(drawsCard()).toBeNull();
    expect(frame()).toBeNull();
  });

  it("an answer with no list of draws at all (an older server) is no draws", async () => {
    delete league.draws;
    league.squadi = OWN; league.saved = true;
    await show();
    await waitFor(() => expect(frame()?.getAttribute("src")).toBe(OWN.url));
    expect(drawsCard()).toBeNull();
  });
});
