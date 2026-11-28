import { describe, it, expect, vi } from "vitest";
import { driblDrawNames, fetchDriblItems, fetchDribl, driblTimeZone, UNREACHABLE } from "@/lib/dribl";

// What the set-up reads back from a Dribl draw before it is saved, and the
// fetch it shares with the sync: every game Dribl lists for a stored request,
// as Dribl sent them. Every id and name is made up.

const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FSydney";
const game = (id, home, away, more = {}) => ({
  type: "fixtures", hash_id: id,
  attributes: { date: "2031-06-07T23:30:00.000000Z", round: "R1", full_round: "Round 1", home_team_name: home, away_team_name: away, ground_name: "Riverside Park", field_name: "Field 2", bye_flag: false, ...more }
});
const US = "Riverside FC U8 Blues";

describe("driblDrawNames — what a draw's games say about themselves", () => {
  it("counts the games, names every team with the busiest first, and says which is ours when one team is in every game", () => {
    const items = [game("g1", US, "Hilltop United U8", { competition_name: "Winter League", league_name: "Under 8" }), game("g2", "Lakeside Rovers U8", US), game("g3", "Hilltop United U8", US)];
    expect(driblDrawNames(items)).toEqual({
      games: 3, ourGames: 3, ourPast: 0, ourFinished: 0, ourResults: 0, shape: expect.any(Object), teams: [US, "Hilltop United U8", "Lakeside Rovers U8"], ours: US, problem: "", logos: { teams: 2, withLogo: 0, shown: 0, hosts: {}, elsewhere: [], logoField: "", teamIdField: "", clubIdField: "" }, competition: "Winter League", league: "Under 8"
    });
  });

  it("leaves ours empty, with no problem, when the draw does not show it: two of the club's teams, or a single game", () => {
    const two = [game("g1", "Riverside FC U8 Blues", "Hilltop United U8"), game("g2", "Riverside FC U8 Golds", "Lakeside Rovers U8")];
    expect(driblDrawNames(two)).toMatchObject({ games: 2, ourGames: 0, ours: "", problem: "" });
    // Teams in the same number of games are listed in name order.
    expect(driblDrawNames(two).teams).toEqual(["Hilltop United U8", "Lakeside Rovers U8", "Riverside FC U8 Blues", "Riverside FC U8 Golds"]);
    expect(driblDrawNames([game("g1", US, "Hilltop United U8")])).toMatchObject({ games: 1, ours: "", problem: "" });
  });

  it("takes the name the set-up gives: the whole name in any case, or a part that fits one team", () => {
    const two = [game("g1", "Riverside FC U8 Blues", "Hilltop United U8"), game("g2", "Riverside FC U8 Golds", "Lakeside Rovers U8"), game("g3", "Riverside FC U8 Golds", "Hilltop United U8")];
    expect(driblDrawNames(two, "riverside fc u8 blues")).toMatchObject({ ours: "Riverside FC U8 Blues", ourGames: 1, games: 3, problem: "" });
    expect(driblDrawNames(two, "  Golds ")).toMatchObject({ ours: "Riverside FC U8 Golds", ourGames: 2, problem: "" });
  });

  it("gives the sentence when the name given is not in the draw or fits more than one team", () => {
    const two = [game("g1", "Riverside FC U8 Blues", "Hilltop United U8"), game("g2", "Riverside FC U8 Golds", "Lakeside Rovers U8")];
    expect(driblDrawNames(two, "Seaside FC")).toMatchObject({ ours: "", ourGames: 0, problem: 'No team called "Seaside FC" is in this Dribl draw.' });
    expect(driblDrawNames(two, "Riverside")).toMatchObject({ ours: "", problem: 'More than one team in this Dribl draw has "Riverside" in its name. Use the whole name as Dribl shows it.' });
  });

  it("leaves byes and half-named games out of the count, and reads a name however Dribl spaced it", () => {
    const items = [game("g1", ` ${US}  `, "Hilltop  United U8"), game("g2", US, "", { bye_flag: true }), game("g3", US, "Bye", { bye_flag: true }), game("g4", "", "Valley Wanderers U8"), game("g5", "Lakeside Rovers U8", US)];
    expect(driblDrawNames(items)).toMatchObject({ games: 2, ourGames: 2, ours: US, teams: [US, "Hilltop United U8", "Lakeside Rovers U8"] });
  });

  it("is an empty read-back for an empty draw, or one whose games it cannot read", () => {
    const nothing = { games: 0, ourGames: 0, ourPast: 0, ourFinished: 0, ourResults: 0, shape: { fields: [], statuses: {}, scoreFields: [] }, teams: [], ours: "", problem: "", logos: { teams: 0, withLogo: 0, shown: 0, hosts: {}, elsewhere: [], logoField: "", teamIdField: "", clubIdField: "" }, competition: "", league: "" };
    expect(driblDrawNames([])).toEqual(nothing);
    expect(driblDrawNames([{ id: 7, match: { home: "A" } }, null, "x"])).toEqual(nothing);
    expect(driblDrawNames([], "Riverside")).toEqual(nothing); // nothing to look the name up in, so nothing wrong with it
  });

  it("keeps the draw's own names to one short line of text, and nothing that is not text", () => {
    const named = (competition_name, league_name) => driblDrawNames([game("g1", US, "Hilltop United U8", { competition_name, league_name }), game("g2", US, "Lakeside Rovers U8")]);
    expect(named("  Winter \n League ", "U8")).toMatchObject({ competition: "Winter League", league: "U8" });
    expect(named("x".repeat(200), 8).competition).toHaveLength(60);
    expect(named({ name: "Winter" }, ["U8"])).toMatchObject({ competition: "", league: "" });
  });

  it("is told, like the reader, when what it was handed is not a list", () => {
    for (const notList of [null, undefined, {}, "games", 3]) expect(() => driblDrawNames(notList)).toThrow("Unexpected Dribl response shape");
  });
});

describe("fetchDriblItems — every game of a stored request, as Dribl sent them", () => {
  const page = (data, next = "") => ({ ok: true, status: 200, json: async () => ({ data, links: {}, meta: { next_cursor: next } }) });

  it("fetches page after page with the same plain request, and hands back the items untouched", async () => {
    const first = [game("g1", US, "Hilltop United U8")], second = [game("g2", "Lakeside Rovers U8", US)];
    const fetchImpl = vi.fn(async (url) => (String(url).includes("cursor=") ? page(second) : page(first, "abc123")));
    expect(await fetchDriblItems({ url: REQUEST }, fetchImpl)).toEqual([...first, ...second]);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([REQUEST, `${REQUEST}&cursor=abc123`]);
    for (const [, opts] of fetchImpl.mock.calls) expect(opts).toEqual({ headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" });
  });

  it("is what fetchDribl reads its records from, in the request's own timezone", async () => {
    // 23:30 UTC on the 7th is 9:30 the next morning in Sydney.
    const fetchImpl = vi.fn(async () => page([game("g1", US, "Hilltop United U8"), game("g2", "Lakeside Rovers U8", US)]));
    const records = await fetchDribl({ url: REQUEST }, fetchImpl);
    expect(records.map((r) => [r.squadiId, r.dateISO, r.time, r.opponent, r.homeAway])).toEqual([
      ["dribl:g1", "2031-06-08", "09:30", "Hilltop United U8", "H"], ["dribl:g2", "2031-06-08", "09:30", "Lakeside Rovers U8", "A"]
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails in words: not a request, unreachable, refused, or not a draw", async () => {
    await expect(fetchDriblItems({ url: "https://winterleague.dribl.com/fixtures?club=MnOpQr2468" }, vi.fn())).rejects.toThrow("Not a Dribl fixtures request");
    await expect(fetchDriblItems(null, vi.fn())).rejects.toThrow("Not a Dribl fixtures request");
    await expect(fetchDriblItems({ url: REQUEST }, vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).rejects.toThrow(UNREACHABLE);
    await expect(fetchDriblItems({ url: REQUEST }, vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))).rejects.toThrow("Dribl responded 403");
    await expect(fetchDriblItems({ url: REQUEST }, vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fixtures: [] }) })))).rejects.toThrow("Unexpected Dribl response shape");
  });
});

describe("driblTimeZone — the timezone a stored request asks in", () => {
  it("is the request's own, and Brisbane's when it names none or is not a request", () => {
    expect(driblTimeZone(REQUEST)).toBe("Australia/Sydney");
    expect(driblTimeZone("https://mc-api.dribl.com/api/fixtures?club=MnOpQr2468&tenant=Tn12345678")).toBe("Australia/Brisbane");
    for (const notOne of ["", null, undefined, "https://example.com/?timezone=Australia%2FPerth", 7]) expect(driblTimeZone(notOne)).toBe("Australia/Brisbane");
  });
});
