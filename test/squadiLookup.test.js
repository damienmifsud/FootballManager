import { describe, it, expect, vi } from "vitest";
import { competitionFromDivisions, describeDraw, lookupSquadiLink, SQUADI_UNKNOWN_COMPETITION, SQUADI_UNKNOWN_DIVISION, SQUADI_UNREACHABLE } from "@/lib/squadiLookup";
import { NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM } from "@/lib/feedLinks";

// Looking a pasted Squadi link up: the competition's key in the link becomes
// the competition's number the sync uses, and the draw says what was found.
// Squadi's answers are stood in for here in the shape the live service gives
// (checked against it when this was written); every name and id is made up.

const KEY = "11111111-2222-4333-8444-555555555555";
const LINK = `https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&yearId=8&competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const DIVISIONS = [
  { id: 20000, name: "Under 9 Reds A", divisionName: "Under 9", competitionId: 777, competition: { id: 777, name: "Winter League", longName: "Metro | Winter League", contact: "someone@example.com" } },
  { id: 20001, name: "Under 8 Blues K1", divisionName: "Under 8", competitionId: 777, competition: { id: 777, name: "Winter League", longName: "Metro | Winter League", contact: "someone@example.com" } }
];
const team = (id, name) => ({ id, name, logoUrl: "https://images.example.com/x.png" });
const match = (id, t1, t2) => ({ id, startTime: "2026-06-13T00:00:00.000Z", team1: t1, team2: t2 });
const US = team(300001, "Riverside FC U8 Blues");
const DRAW = { rounds: [
  { name: "Round 1", matches: [match(1, US, team(300002, "Hill End U8"))] },
  { name: "Round 2", matches: [match(2, team(300003, "Canal Street U8"), US)] },
  { name: "Round 3", matches: [match(3, US, team(0, "Bye"))] },
  { name: "Round 4", matches: [match(4, team(300004, "Others A"), team(300005, "Others B"))] }
], allRoundsHidden: false };

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const failed = (status) => ({ ok: false, status, json: async () => ({ name: "TypeError", message: "Cannot read properties of undefined" }) });
// A stand-in for fetch that answers by address, and remembers what was asked.
const fakeFetch = (answers) => {
  const fn = vi.fn(async (url) => {
    const hit = Object.entries(answers).find(([part]) => String(url).includes(part));
    if (!hit) throw new Error("unexpected request: " + url);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  });
  fn.urls = () => fn.mock.calls.map((c) => String(c[0]));
  return fn;
};

describe("competitionFromDivisions — the competition's number, from its list of divisions", () => {
  it("finds the link's division and reads the competition number and the names to show back", () => {
    expect(competitionFromDivisions(DIVISIONS, "20001")).toEqual({ competitionId: "777", competition: "Metro | Winter League", division: "Under 8 Blues K1" });
    expect(competitionFromDivisions(DIVISIONS, 20000).division).toBe("Under 9 Reds A"); // the id as a number or as text
  });

  it("falls back to the shorter names, and to the competition object's own id", () => {
    const d = [{ id: 5, divisionName: "Under 8", competition: { id: 42, name: "Cup" } }];
    expect(competitionFromDivisions(d, "5")).toEqual({ competitionId: "42", competition: "Cup", division: "Under 8" });
  });

  it("the division's own word on its competition is enough; two numbers that disagree are not trusted", () => {
    expect(competitionFromDivisions([{ id: 5, name: "Under 8", competitionId: 42 }], "5")).toEqual({ competitionId: "42", competition: "", division: "Under 8" });
    expect(competitionFromDivisions([{ id: 5, name: "Under 8", competitionId: 42, competition: { id: "42", name: "Cup" } }], "5").competitionId).toBe("42");
    expect(competitionFromDivisions([{ id: 5, name: "Under 8", competitionId: 42, competition: { id: 43, name: "Cup" } }], "5")).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
  });

  it("a division that is not in the list is said so; a list that is not one, or has no usable number, is an unknown competition", () => {
    expect(competitionFromDivisions(DIVISIONS, "99999")).toEqual({ error: SQUADI_UNKNOWN_DIVISION });
    for (const bad of [null, undefined, {}, [], "nope", { name: "TypeError" }]) expect(competitionFromDivisions(bad, "20001")).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
    for (const competitionId of [undefined, "", "abc", 0, -3, "12; drop"]) {
      expect(competitionFromDivisions([{ id: 20001, name: "X", competitionId }], "20001")).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
    }
  });

  it("for every division, is the competition they all belong to, with no one division named; divisions that disagree are not trusted", () => {
    expect(competitionFromDivisions(DIVISIONS, "All")).toEqual({ competitionId: "777", competition: "Metro | Winter League", division: "" });
    expect(competitionFromDivisions(DIVISIONS, "all").competitionId).toBe("777");
    expect(competitionFromDivisions([...DIVISIONS, { id: 20002, name: "Other", competitionId: 778 }], "All")).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
    expect(competitionFromDivisions([{ id: 1, name: "X", competitionId: "abc" }], "All")).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
  });

  it("passes on nothing else from Squadi's answer", () => {
    expect(JSON.stringify(competitionFromDivisions(DIVISIONS, "20001"))).not.toMatch(/someone@example|contact/);
  });
});

describe("describeDraw — what the draw says about the team", () => {
  it("names the team as Squadi writes it, from either side, and counts its games without the bye", () => {
    expect(describeDraw(DRAW, 300001)).toEqual({ team: "Riverside FC U8 Blues", games: 2, results: 0 });
    expect(describeDraw(DRAW, "300003")).toEqual({ team: "Canal Street U8", games: 1, results: 0 });
  });

  it("a team with no games yet has no name and none counted; something that is not a draw is nothing", () => {
    expect(describeDraw(DRAW, 999)).toEqual({ team: "", games: 0, results: 0 });
    expect(describeDraw({ rounds: [] }, 300001)).toEqual({ team: "", games: 0, results: 0 });
    expect(describeDraw({ rounds: [{ name: "Round 1" }, { matches: [null, {}] }] }, 300001)).toEqual({ team: "", games: 0, results: 0 });
    for (const bad of [null, undefined, {}, [], { rounds: "x" }]) expect(describeDraw(bad, 300001)).toBeNull();
  });
});

describe("describeDraw — results the competition has confirmed", () => {
  it("counts a game with a final, locked result, and not one shown 0-0 but never locked", () => {
    const result = (id, t1, t2, a, b, locked) => ({ ...match(id, t1, t2), team1Score: a, team2Score: b, resultStatus: "FINAL", isResultsLocked: locked });
    const played = { rounds: [{ name: "Round 1", matches: [result(1, US, team(300002, "Hill End U8"), 2, 1, true), result(2, team(300003, "Canal Street U8"), US, 0, 0, false), result(3, US, team(0, "Bye"), 0, 0, true)] }] };
    expect(describeDraw(played, 300001)).toEqual({ team: "Riverside FC U8 Blues", games: 2, results: 1 });
  });
});

describe("lookupSquadiLink", () => {
  it("a link for every division names the competition from its divisions and reads the team's games in all of them", async () => {
    const fetch = fakeFetch({ "/livescores/division": ok(DIVISIONS), "/livescores/round/matches": ok(DRAW) });
    const all = LINK.replace("divisionId=20001", "divisionId=All");
    expect(await lookupSquadiLink(all, fetch)).toEqual({
      provider: "squadi", link: all,
      squadi: { competitionId: "777", divisionId: "All", teamId: 300001 },
      found: { competition: "Metro | Winter League", division: "", team: "Riverside FC U8 Blues", games: 2, results: 0 }
    });
    expect(fetch.urls()[1]).toBe("https://api.squadi.com/livescores/round/matches?competitionId=777&teamIds=[300001]&ignoreStatuses=[1]");
  });

  it("turns the link into the three ids the sync uses, and says what it found", async () => {
    const fetch = fakeFetch({ "/livescores/division": ok(DIVISIONS), "/livescores/round/matches": ok(DRAW) });
    expect(await lookupSquadiLink(LINK, fetch)).toEqual({
      provider: "squadi", link: LINK,
      squadi: { competitionId: "777", divisionId: "20001", teamId: 300001 },
      found: { competition: "Metro | Winter League", division: "Under 8 Blues K1", team: "Riverside FC U8 Blues", games: 2, results: 0 }
    });
    // Two requests, both to Squadi's own service, built from the checked pieces: the pasted address is never requested.
    expect(fetch.urls()).toEqual([
      `https://api.squadi.com/livescores/division?competitionKey=${KEY}`,
      "https://api.squadi.com/livescores/round/matches?competitionId=777&divisionId=20001&teamIds=[300001]&ignoreStatuses=[1]"
    ]);
  });

  it("a competition Squadi does not know (it answers with an error), or a division it does not list, is said in words", async () => {
    expect(await lookupSquadiLink(LINK, fakeFetch({ "/livescores/division": failed(500) }))).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
    expect(await lookupSquadiLink(LINK, fakeFetch({ "/livescores/division": ok({ not: "a list" }) }))).toEqual({ error: SQUADI_UNKNOWN_COMPETITION });
    expect(await lookupSquadiLink(LINK.replace("divisionId=20001", "divisionId=20009"), fakeFetch({ "/livescores/division": ok(DIVISIONS) }))).toEqual({ error: SQUADI_UNKNOWN_DIVISION });
  });

  it("Squadi being out of reach is not blamed on the link", async () => {
    expect(await lookupSquadiLink(LINK, fakeFetch({ "/livescores/division": new Error("getaddrinfo ENOTFOUND") }))).toEqual({ error: SQUADI_UNREACHABLE });
  });

  it("the ids stand even when the draw cannot be read just now: the games are simply not counted", async () => {
    for (const draw of [failed(503), ok({ unexpected: true }), new Error("timeout")]) {
      const r = await lookupSquadiLink(LINK, fakeFetch({ "/livescores/division": ok(DIVISIONS), "/livescores/round/matches": draw }));
      expect(r.squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: 300001 });
      expect(r.found).toEqual({ competition: "Metro | Winter League", division: "Under 8 Blues K1", team: "", games: null, results: null });
    }
  });

  it("a draw with nothing for the team yet is found with no games, so a wrong team in the link can be seen", async () => {
    const r = await lookupSquadiLink(LINK.replace("teamId=300001", "teamId=300099"), fakeFetch({ "/livescores/division": ok(DIVISIONS), "/livescores/round/matches": ok(DRAW) }));
    expect(r.found).toMatchObject({ team: "", games: 0 });
    expect(r.squadi.teamId).toBe(300099);
  });

  it("asks Squadi nothing for a link that is not a team's Squadi link", async () => {
    const fetch = fakeFetch({});
    expect(await lookupSquadiLink("https://example.com/x", fetch)).toEqual({ error: NOT_A_FEED_LINK });
    expect(await lookupSquadiLink("https://winterleague.dribl.com/fixtures?competition=1pQrStUv90", fetch)).toEqual({ error: NOT_A_FEED_LINK });
    expect(await lookupSquadiLink(LINK.replace("&teamId=300001", ""), fetch)).toEqual({ error: SQUADI_NEEDS_TEAM });
    expect(await lookupSquadiLink(undefined, fetch)).toEqual({ error: NOT_A_FEED_LINK });
    expect(fetch).not.toHaveBeenCalled();
  });
});
