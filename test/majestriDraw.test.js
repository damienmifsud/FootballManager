import { describe, it, expect, vi } from "vitest";
import {
  parseMajestriLink, isMajestriLink, majestriCompUrl, sanitizeMajestriSource, majestriReady,
  majestriDate, majestriTime, readMajestriPage, ourMajestriTeam, majestriRecords,
  fetchMajestriPage, fetchMajestri, lookupMajestriLink,
  NOT_A_MAJESTRI_LINK, MAJESTRI_NEEDS_COMPETITION, MAJESTRI_WHICH_TEAM, MAJESTRI_NOT_READABLE, MAJESTRI_UNREACHABLE
} from "@/lib/majestriDraw";

// lib/majestriDraw: a competition whose draw is on a club's Majestri site, read
// from a made-up page in a real one's shape (test/helpers/majestriPage.js).

import { HOST, COMP, TEAM_PAGE, ladderRow, PAGE } from "./helpers/majestriPage";

describe("parseMajestriLink — a pasted Majestri link", () => {
  it("reads a competition's page, and a team's own page, whatever case its parts are in", () => {
    expect(parseMajestriLink(COMP)).toEqual({ provider: "majestri", link: COMP, host: HOST, compId: "9001", teamId: "" });
    expect(parseMajestriLink(`  ${TEAM_PAGE}\n`)).toEqual({ provider: "majestri", link: TEAM_PAGE, host: HOST, compId: "9001", teamId: "7001" });
    expect(parseMajestriLink(`https://${HOST}/comp-summary?COMPID=9001&teamid=7001`)).toMatchObject({ compId: "9001", teamId: "7001" });
    expect(parseMajestriLink(`https://RiversideFC.Majestri.com.au/comp-summary?compID=9001`).host).toBe(HOST);
    expect(isMajestriLink(COMP)).toBe(true);
  });

  it("is a page on a club's Majestri site, and nothing that only looks like one", () => {
    for (const bad of [`http://${HOST}/comp-summary?compID=9001`, `https://majestri.com.au/comp-summary?compID=9001`, `https://${HOST}.evil.example/comp-summary?compID=9001`,
      `https://riversidefc.majestri.com/comp-summary?compID=9001`, `https://x@${HOST}/comp-summary?compID=9001`, `https://${HOST}:8443/comp-summary?compID=9001`,
      "https://example.com/comp-summary?compID=9001", "not a link", "", null, 7, `https://${HOST}/comp-summary?compID=9001&` + "a".repeat(1000)]) {
      expect(parseMajestriLink(bad), String(bad).slice(0, 60)).toEqual({ error: NOT_A_MAJESTRI_LINK });
      expect(isMajestriLink(bad)).toBe(false);
    }
  });

  it("must name a competition; a team number that is not one is simply not taken", () => {
    for (const bad of [`https://${HOST}/`, `https://${HOST}/comp-summary`, `https://${HOST}/comp-summary?compID=`, `https://${HOST}/comp-summary?compID=12ab`, `https://${HOST}/comp-summary?compID=1234567890`]) {
      expect(parseMajestriLink(bad), bad).toEqual({ error: MAJESTRI_NEEDS_COMPETITION });
    }
    expect(parseMajestriLink(`https://${HOST}/team-summary?teamID=x7&compID=9001`).teamId).toBe("");
  });
});

describe("sanitizeMajestriSource — a competition's Majestri draw as the registry keeps it", () => {
  it("is the competition's page in one stored form, with our team", () => {
    expect(majestriCompUrl(HOST, "9001")).toBe(COMP);
    expect(sanitizeMajestriSource({ url: `${COMP}&utm=x`, team: "  Riverside   Rockets " })).toEqual({ url: COMP, team: "Riverside Rockets" });
    // A team's own page is kept as the competition's, with the team's number.
    expect(sanitizeMajestriSource({ url: TEAM_PAGE })).toEqual({ url: COMP, teamId: "7001" });
    expect(sanitizeMajestriSource({ url: COMP, team: "Riverside Rockets", teamId: "7001" })).toEqual({ url: COMP, team: "Riverside Rockets", teamId: "7001" });
    // A number sent with the source decides over one in the link; one that is not a number is not kept.
    expect(sanitizeMajestriSource({ url: TEAM_PAGE, teamId: "7002" }).teamId).toBe("7002");
    expect(sanitizeMajestriSource({ url: COMP, team: "Riverside Rockets", teamId: "x" })).toEqual({ url: COMP, team: "Riverside Rockets" });
    expect(sanitizeMajestriSource({ url: COMP, team: "x".repeat(200) }).team).toHaveLength(80);
  });

  it("is nothing when nothing was entered, and says what is wrong otherwise", () => {
    for (const nothing of [null, undefined, {}, { url: "" }, { url: "   " }, "x", [COMP]]) expect(sanitizeMajestriSource(nothing)).toBeNull();
    expect(sanitizeMajestriSource({ url: "https://example.com/x" })).toEqual({ error: NOT_A_MAJESTRI_LINK });
    expect(sanitizeMajestriSource({ url: `https://${HOST}/` , team: "Riverside Rockets" })).toEqual({ error: MAJESTRI_NEEDS_COMPETITION });
    expect(sanitizeMajestriSource({ url: COMP })).toEqual({ error: MAJESTRI_WHICH_TEAM });
    expect(sanitizeMajestriSource({ url: COMP, team: "   " })).toEqual({ error: MAJESTRI_WHICH_TEAM });
  });

  it("majestriReady: a source the server can read", () => {
    expect(majestriReady({ url: COMP, team: "Riverside Rockets" })).toBe(true);
    expect(majestriReady({ url: TEAM_PAGE })).toBe(true);
    for (const no of [null, {}, { url: COMP }, { url: "https://example.com", team: "x" }]) expect(majestriReady(no)).toBe(false);
  });
});

describe("majestriDate and majestriTime", () => {
  it("read Majestri's day headings and times", () => {
    expect(["Thursday, 15 Oct 2026", "Sat 3 January 2031", "1 Feb 2032", "Thursday, 3 Dec 2026"].map(majestriDate)).toEqual(["2026-10-15", "2031-01-03", "2032-02-01", "2026-12-03"]);
    expect(["", "Thursday", "31 Feb 2031", "15 Foo 2026", "15 Oct"].map(majestriDate)).toEqual(["", "", "", "", ""]);
    expect(["4:30 pm", "4:30pm", "12:15 pm", "12:05 am", "9:00 AM", "4:30 p.m.", "16:30", "7:05"].map(majestriTime)).toEqual(["16:30", "16:30", "12:15", "00:05", "09:00", "16:30", "16:30", "07:05"]);
    expect(["", "TBA", "13:30 pm", "4:61 pm", "24:00", "noon"].map(majestriTime)).toEqual(["", "", "", "", "", ""]);
  });
});

describe("readMajestriPage — a competition's page as plain data", () => {
  const page = readMajestriPage(PAGE);

  it("names the competition, the division and the season", () => {
    expect([page.competition, page.division, page.season]).toEqual(["Winter Fives 2031", "Under 9 Mixed", "2031"]);
  });

  it("lists the ladder's teams with Majestri's numbers for them, read as text", () => {
    expect(page.teams).toEqual([
      { id: "7001", name: "Riverside Rockets" }, { id: "7002", name: "Hilltop Hawks" }, { id: "7003", name: "Lakeside Lions & Co" },
      { id: "7004", name: "Valley Vipers" }, { id: "7005", name: "Riverside Rovers" }
    ]);
  });

  it("reads every game in page order with its round, date, time, teams, scores and field, and nothing from a script", () => {
    expect(page.games.map((g) => [g.roundName, g.round, g.dateISO, g.time, g.home, g.away, g.homeScore, g.awayScore, g.field, g.tba])).toEqual([
      ["Semi Finals", null, "2031-07-03", "17:10", "Riverside Rockets", "Valley Vipers", null, null, "Field 6", false],
      ["Semi Finals", null, "2031-07-03", "16:30", "Hilltop Hawks", "Lakeside Lions & Co", null, null, "Field 5", false],
      ["Finals", null, "2031-07-10", "17:50", "TBA", "TBA", null, null, "Field 5", true],
      ["Round 1", 1, "2031-06-05", "16:30", "Riverside Rockets", "Hilltop Hawks", 5, 2, "Field 5", false],
      ["Round 1", 1, "2031-06-05", "16:30", "Lakeside Lions & Co", "Valley Vipers", 1, 1, "Field 6", false],
      ["Round 2", 2, "2031-06-12", "12:15", "Valley Vipers", "Riverside Rockets", null, null, "Field 7", false],
      ["Round 2", 2, "2031-06-12", "16:30", "Hilltop Hawks", "Riverside Rovers", null, null, "Field 5", false],
      ["Round 10", 10, "2031-06-19", "16:30", "Riverside Rockets", "Lakeside Lions & Co", null, null, "Field 5", false],
      ["Round 10", 10, "2031-06-19", "17:10", "Hilltop Hawks", "Riverside Rockets", null, null, "Field 5", false],
      ["Round 10", 10, "2031-06-19", "17:50", "Riverside Rockets", "Bye", null, null, "Field 5", false]
    ]);
    expect(page.games[0].title).toBe("Semi Final 1st vs 4th");
    expect(page.games.some((g) => g.round === 99)).toBe(false);
  });

  it("is an error, never an empty draw, for a page that is not a competition's", () => {
    for (const other of ["<html><body><h1>Sign in</h1><form></form></body></html>", "<html></html>", "", null, 7, "x".repeat(3_000_001)]) {
      expect(() => readMajestriPage(other)).toThrow(MAJESTRI_NOT_READABLE);
    }
    expect(() => readMajestriPage("<html><body><p>Hello</p></body></html>")).toThrow(`${MAJESTRI_NOT_READABLE} It has no rounds, games or ladder.`);
    // A competition with its ladder but no games yet is a page, with no games in it.
    expect(readMajestriPage(`<body>${ladderRow(7001, "Riverside Rockets")}</body>`).games).toEqual([]);
  });
});

describe("ourMajestriTeam — which team is ours", () => {
  const page = readMajestriPage(PAGE);
  it("is the team with Majestri's number when it is on the page, whatever name is given", () => {
    expect(ourMajestriTeam(page, { teamId: "7004", team: "Riverside Rockets" })).toBe("Valley Vipers");
  });
  it("is the name given, whole in any case, or a part that fits one team", () => {
    expect(ourMajestriTeam(page, { team: "riverside rockets" })).toBe("Riverside Rockets");
    expect(ourMajestriTeam(page, { team: "Hawks" })).toBe("Hilltop Hawks");
    expect(ourMajestriTeam(page, { team: "lions & co" })).toBe("Lakeside Lions & Co");
    // A number no longer on the page falls back to the name.
    expect(ourMajestriTeam(page, { teamId: "9999", team: "Valley Vipers" })).toBe("Valley Vipers");
  });
  it("says so when no team is given, the name fits none or several, or the number is gone", () => {
    expect(() => ourMajestriTeam(page, {})).toThrow(MAJESTRI_WHICH_TEAM);
    expect(() => ourMajestriTeam(page, { team: "Seaside" })).toThrow('No team called "Seaside" is in this Majestri competition.');
    expect(() => ourMajestriTeam(page, { team: "Riverside" })).toThrow('More than one team in this Majestri competition has "Riverside" in its name. Use the whole name as Majestri shows it.');
    expect(() => ourMajestriTeam(page, { teamId: "9999" })).toThrow("Your team is no longer in this Majestri competition. Choose it again from the names on the page.");
  });
});

describe("majestriRecords — our games, as the sync applies them", () => {
  const page = readMajestriPage(PAGE);
  it("are our games only, home or away, with the opponent, the round, local time and the field", () => {
    const r = majestriRecords(page, { team: "Riverside Rockets", compId: "9001" });
    expect(r).toEqual([
      { squadiId: "majestri:9001:rnd9f9f9f9:0", round: null, dateISO: "2031-07-03", time: "17:10", opponent: "Valley Vipers", opponentLogo: "", ourLogo: "", homeAway: "H", venue: "Field 6" },
      { squadiId: "majestri:9001:rnd0a1b2c3:0", round: 1, dateISO: "2031-06-05", time: "16:30", opponent: "Hilltop Hawks", opponentLogo: "", ourLogo: "", homeAway: "H", venue: "Field 5" },
      { squadiId: "majestri:9001:rnd4d5e6f7:0", round: 2, dateISO: "2031-06-12", time: "12:15", opponent: "Valley Vipers", opponentLogo: "", ourLogo: "", homeAway: "A", venue: "Field 7" },
      { squadiId: "majestri:9001:rnd1c1c1c1:0", round: 10, dateISO: "2031-06-19", time: "16:30", opponent: "Lakeside Lions & Co", opponentLogo: "", ourLogo: "", homeAway: "H", venue: "Field 5" },
      { squadiId: "majestri:9001:rnd1c1c1c1:1", round: 10, dateISO: "2031-06-19", time: "17:10", opponent: "Hilltop Hawks", opponentLogo: "", ourLogo: "", homeAway: "A", venue: "Field 5" },
      { squadiId: "majestri:9001:rnd1c1c1c1:2", round: 10, bye: true }
    ]);
  });

  it("leaves out a game whose teams are not known yet, and keeps a game's id when it moves time or field or gets its opponent", () => {
    const later = readMajestriPage(PAGE.replace('<span class="time">12:15 pm</span>', '<span class="time">1:00 pm</span>').replace('<span class="locn">Field 7</span>', '<span class="locn">Field 8</span>'));
    const before = majestriRecords(page, { team: "Valley Vipers", compId: "9001" });
    const after = majestriRecords(later, { team: "Valley Vipers", compId: "9001" });
    expect(after.map((g) => g.squadiId)).toEqual(before.map((g) => g.squadiId));
    expect(after.find((g) => g.round === 2)).toMatchObject({ time: "13:00", venue: "Field 8" });
    expect(before.some((g) => g.opponent === "TBA")).toBe(false);
    // A final with one side known is still not drawn, whether or not the page marks it so.
    const half = PAGE.replace('<span class="name">TBA</span></span><span class="team away">', '<span class="name">Valley Vipers</span></span><span class="team away">');
    for (const html of [half, half.replace(' class="tba"', "")]) {
      const p = readMajestriPage(html);
      expect(p.games.find((g) => g.title === "Grand Final")).toMatchObject({ home: "Valley Vipers", away: "TBA", tba: true });
      expect(majestriRecords(p, { team: "Valley Vipers", compId: "9001" })).toEqual(before);
    }
  });

  it("says so when a game of ours has a date it cannot read", () => {
    const broken = readMajestriPage(PAGE.replace("Thursday, 12 Jun 2031", "Thursday"));
    expect(() => majestriRecords(broken, { team: "Valley Vipers", compId: "9001" })).toThrow(`${MAJESTRI_NOT_READABLE} A game's date could not be read.`);
  });
});

describe("fetching a competition's page — the server's part", () => {
  const ok = (body) => ({ status: 200, ok: true, text: async () => body });

  it("asks for the competition's page as stored, built from checked pieces: never the pasted address, no redirects", async () => {
    const fetchImpl = vi.fn(async () => ok(PAGE));
    const page = await fetchMajestriPage(`${TEAM_PAGE}&next=https://evil.example/`, fetchImpl);
    expect(page.teams).toHaveLength(5);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(COMP);
    expect(opts).toMatchObject({ headers: { Accept: "text/html" }, cache: "no-store", redirect: "manual" });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails in words: not reachable, refused, moved, or not a competition's page", async () => {
    await expect(fetchMajestriPage(COMP, vi.fn(async () => { throw new TypeError("fetch failed"); }))).rejects.toThrow(MAJESTRI_UNREACHABLE);
    for (const status of [302, 403, 404, 500]) {
      await expect(fetchMajestriPage(COMP, vi.fn(async () => ({ status, ok: status < 300, text: async () => "" })))).rejects.toThrow(`Majestri responded ${status}`);
    }
    await expect(fetchMajestriPage(COMP, vi.fn(async () => ok("<html><body>Login</body></html>")))).rejects.toThrow(MAJESTRI_NOT_READABLE);
    await expect(fetchMajestriPage("https://example.com/", vi.fn())).rejects.toThrow(NOT_A_MAJESTRI_LINK);
  });

  it("fetchMajestri: a stored source's games", async () => {
    const fetchImpl = vi.fn(async () => ok(PAGE));
    expect((await fetchMajestri({ url: COMP, team: "Hilltop Hawks" }, fetchImpl)).map((g) => [g.squadiId, g.opponent])).toEqual([
      ["majestri:9001:rnd9f9f9f9:0", "Lakeside Lions & Co"], ["majestri:9001:rnd0a1b2c3:0", "Riverside Rockets"], ["majestri:9001:rnd4d5e6f7:0", "Riverside Rovers"], ["majestri:9001:rnd1c1c1c1:0", "Riverside Rockets"]
    ]);
    await expect(fetchMajestri({ url: COMP }, fetchImpl)).rejects.toThrow(MAJESTRI_WHICH_TEAM);
    await expect(fetchMajestri(null, fetchImpl)).rejects.toThrow(NOT_A_MAJESTRI_LINK);
  });
});

describe("lookupMajestriLink — what a pasted link says, read back before it is saved", () => {
  const ok = vi.fn(async () => ({ status: 200, ok: true, text: async () => PAGE }));
  it("a competition's page: its names, its teams and how many games, with our team left to choose", async () => {
    expect(await lookupMajestriLink(COMP, ok)).toEqual({
      provider: "majestri", link: COMP, majestri: { url: COMP },
      found: { competition: "Winter Fives 2031", division: "Under 9 Mixed", season: "2031", teams: ["Riverside Rockets", "Hilltop Hawks", "Lakeside Lions & Co", "Valley Vipers", "Riverside Rovers"], games: 9, ours: "", ourGames: 0 }
    });
  });
  it("a team's own page names our team, and counts its games", async () => {
    const got = await lookupMajestriLink(TEAM_PAGE, ok);
    expect(got.majestri).toEqual({ url: COMP, team: "Riverside Rockets", teamId: "7001" });
    expect([got.found.ours, got.found.ourGames]).toEqual(["Riverside Rockets", 5]); // the bye is not a game
  });
  it("a competition's page read for the team the set-up already has: a name that is one of its teams is ours, with Majestri's number for it", async () => {
    const vipers = await lookupMajestriLink(COMP, ok, { team: "Valley Vipers" });
    expect(vipers.majestri).toEqual({ url: COMP, team: "Valley Vipers", teamId: "7004" });
    expect([vipers.found.ours, vipers.found.ourGames]).toEqual(["Valley Vipers", 3]);
    // Read as the page spells it, and a part of a name that fits one team only.
    expect((await lookupMajestriLink(COMP, ok, { team: "lakeside lions & co" })).majestri).toEqual({ url: COMP, team: "Lakeside Lions & Co", teamId: "7003" });
    expect((await lookupMajestriLink(COMP, ok, { team: "Rovers" })).found.ours).toBe("Riverside Rovers");
  });
  it("a name that fits no team, or more than one, is no team, and is asked for again", async () => {
    for (const team of ["Mountain Goats", "Riverside"]) {
      const got = await lookupMajestriLink(COMP, ok, { team });
      expect([got.majestri, got.found.ours, got.found.ourGames]).toEqual([{ url: COMP }, "", 0]);
    }
  });
  it("a team's own page names our team whatever name was given", async () => {
    expect((await lookupMajestriLink(TEAM_PAGE, ok, { team: "Valley Vipers" })).majestri).toEqual({ url: COMP, team: "Riverside Rockets", teamId: "7001" });
  });
  it("says what went wrong, asking nothing when the link is not one", async () => {
    const none = vi.fn();
    expect(await lookupMajestriLink("https://example.com/x", none)).toEqual({ error: NOT_A_MAJESTRI_LINK });
    expect(none).not.toHaveBeenCalled();
    expect(await lookupMajestriLink(COMP, vi.fn(async () => { throw new Error("x"); }))).toEqual({ error: MAJESTRI_UNREACHABLE });
  });
});
