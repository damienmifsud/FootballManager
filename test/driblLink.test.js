import { describe, it, expect, vi } from "vitest";
import { matchCentreLookups, matchCentreId, driblRequestFromLink, readDriblDraw, readDriblLink, NOT_A_DRIBL_LINK, NO_MATCH_CENTRE } from "@/lib/driblLink";
import { DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";
import { UNREACHABLE, NOT_READABLE, driblFixturesUrl } from "@/lib/dribl";

// lib/driblLink: a Dribl fixtures page link, as copied from the address bar,
// turned into the fixtures request the sync fetches. The one thing the link
// does not carry, which match centre it is, is asked of Dribl by the browser.
// Dribl is stood in for throughout; every id and name is made up.

const LINK = "https://winterleague.dribl.com/fixtures?date_range=default&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FSydney";
const WHERE = { host: "winterleague.dribl.com", site: "winterleague" };
const BY_BOTH = "https://mc-api.dribl.com/api/tenants?mc_link=winterleague.dribl.com&slug=winterleague";
const BY_SLUG = "https://mc-api.dribl.com/api/tenants?slug=winterleague";
const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FSydney";
const CENTRE = { type: "tenants", id: "Tn12345678", attributes: { name: "Winter League", slug: "winterleague", mc_link: "winterleague.dribl.com" } };

const answer = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (json === undefined) throw new Error("not json"); return json; } });
// A stand-in for the browser's fetch: `routes` maps an address (or its start) to an answer or a function.
function dribl(routes) {
  const asked = [];
  const fetchImpl = vi.fn(async (url, opts) => {
    asked.push({ url: String(url), opts });
    const key = Object.keys(routes).find((k) => String(url) === k) ?? Object.keys(routes).find((k) => String(url).startsWith(k));
    if (key === undefined) throw new TypeError("Failed to fetch");
    const made = typeof routes[key] === "function" ? routes[key](String(url)) : routes[key];
    if (made instanceof Error) throw made;
    return made;
  });
  return { fetchImpl, asked, urls: () => asked.map((a) => a.url) };
}

const game = (id, home, away, more = {}) => ({
  type: "fixtures", hash_id: id,
  attributes: { date: "2031-06-07T23:30:00.000000Z", round: "R1", full_round: "Round 1", home_team_name: home, away_team_name: away, ground_name: "Riverside Park", field_name: "Field 2", competition_name: "Winter League", league_name: "Under 8", bye_flag: false, ...more }
});
const US = "Riverside FC U8 Blues";
const ONE_TEAM = [game("g1", US, "Hilltop United U8"), game("g2", "Lakeside Rovers U8", US, { round: "R2", full_round: "Round 2" }), game("g3", US, "Valley Wanderers U8", { round: "R3", full_round: "Round 3" })];
const TWO_TEAMS = [game("g1", "Riverside FC U8 Blues", "Hilltop United U8"), game("g2", "Riverside FC U8 Golds", "Lakeside Rovers U8"), game("g3", "Hilltop United U8", "Riverside FC U8 Golds"), game("g4", "Riverside FC U8 Blues", "Riverside FC U8 Golds")];

describe("matchCentreLookups — the questions asked of Dribl", () => {
  it("asks by the match centre's address and short name together, then by short name alone", () => {
    expect(matchCentreLookups(WHERE)).toEqual([BY_BOTH, BY_SLUG]);
  });

  it("only ever asks Dribl's API, whatever the names hold", () => {
    for (const lookup of matchCentreLookups({ host: "a&b=c.dribl.com", site: "a&b=c/../x?y#z" })) {
      const u = new URL(lookup);
      expect([u.protocol, u.host, u.pathname]).toEqual(["https:", "mc-api.dribl.com", "/api/tenants"]);
      expect(u.searchParams.get("slug")).toBe("a&b=c/../x?y#z");
      expect([...u.searchParams.keys()].every((k) => k === "mc_link" || k === "slug")).toBe(true);
    }
  });
});

describe("matchCentreId — the match centre in Dribl's answer", () => {
  it("reads the centre's id from an answer of one centre, or a list of one", () => {
    expect(matchCentreId({ data: CENTRE }, WHERE)).toBe("Tn12345678");
    expect(matchCentreId({ data: [CENTRE] }, WHERE)).toBe("Tn12345678");
  });

  it("picks the centre that carries our address or short name out of several", () => {
    const other = { id: "Zz99999999", attributes: { slug: "summerleague", mc_link: "summerleague.dribl.com" } };
    expect(matchCentreId({ data: [other, CENTRE] }, WHERE)).toBe("Tn12345678");
    // The address may be held with its scheme, a trailing slash or capitals; the short name in any case.
    const byAddress = { id: "Ab12345678", attributes: { slug: "wl-prod", mc_link: "https://WinterLeague.dribl.com/" } };
    expect(matchCentreId({ data: [other, byAddress] }, WHERE)).toBe("Ab12345678");
    const byName = { id: "Cd12345678", attributes: { slug: "WinterLeague", mc_link: "fixtures.example.org" } };
    expect(matchCentreId({ data: [byName, other] }, WHERE)).toBe("Cd12345678");
    // Fields that sit on the centre itself, not under attributes, are read the same.
    expect(matchCentreId({ data: [other, { id: "Ef12345678", slug: "winterleague" }] }, WHERE)).toBe("Ef12345678");
  });

  it("takes an answer of exactly one centre as the one asked for, even when it is named differently", () => {
    expect(matchCentreId({ data: { id: "Gh12345678", attributes: { slug: "wl-prod", mc_link: "fixtures.example.org" } } }, WHERE)).toBe("Gh12345678");
    expect(matchCentreId({ data: [{ id: "Gh12345678" }] }, WHERE)).toBe("Gh12345678");
  });

  it("is no answer when several centres come back with nothing to tell them apart, or two both claim the name", () => {
    const a = { id: "Aa11111111", attributes: { slug: "one" } }, b = { id: "Bb22222222", attributes: { slug: "two" } };
    expect(matchCentreId({ data: [a, b] }, WHERE)).toBe("");
    expect(matchCentreId({ data: [CENTRE, { ...CENTRE, id: "Xx00000000" }] }, WHERE)).toBe("");
  });

  it("finds the id where Dribl puts it, and takes nothing that is not a short letter-and-digit id", () => {
    expect(matchCentreId({ data: { hash_id: "Hh12345678", attributes: { slug: "winterleague" } } }, WHERE)).toBe("Hh12345678");
    expect(matchCentreId({ data: { attributes: { slug: "winterleague", hash_id: "Ii12345678" } } }, WHERE)).toBe("Ii12345678");
    expect(matchCentreId({ data: { id: "  Jj12345678 ", attributes: { slug: "winterleague" } } }, WHERE)).toBe("Jj12345678");
    for (const id of [12345678, "", "abc", "has spaces1", "x&club=Evil1234", "../../tenants", "a".repeat(25), { id: "Tn12345678" }, ["Tn12345678"], null]) {
      expect(matchCentreId({ data: { id, attributes: { slug: "winterleague" } } }, WHERE), JSON.stringify(id)).toBe("");
    }
  });

  it("is no answer for anything that is not one", () => {
    for (const json of [null, undefined, "tenants", 42, [], [CENTRE], {}, { data: null }, { data: "Tn12345678" }, { data: [] }, { data: [null, "x", 7] }, { tenants: [CENTRE] }]) {
      expect(matchCentreId(json, WHERE), JSON.stringify(json)).toBe("");
    }
  });
});

describe("driblRequestFromLink — a page link to the request the sync fetches", () => {
  it("asks Dribl once, as a plain GET with no cookies, and builds the request from the link's own filters", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: CENTRE }) });
    expect(await driblRequestFromLink(`  ${LINK}\n`, d.fetchImpl)).toEqual({ link: LINK, url: REQUEST });
    expect(d.asked).toEqual([{ url: BY_BOTH, opts: { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" } }]);
    // What comes out is a request in its stored form: every date, the filters in one order.
    expect(driblFixturesUrl(REQUEST)).toBe(REQUEST);
  });

  it("carries only the filters the link names, and Brisbane time when the link gives none", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: [CENTRE] }) });
    expect((await driblRequestFromLink("https://winterleague.dribl.com/fixtures?club=MnOpQr2468", d.fetchImpl)).url)
      .toBe("https://mc-api.dribl.com/api/fixtures?date_range=all&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FBrisbane");
    expect((await driblRequestFromLink("https://winterleague.dribl.com/fixtures?league=ZyXwVu5678&competition=1pQrStUv90&cursor=abc&utm_source=x", d.fetchImpl)).url)
      .toBe("https://mc-api.dribl.com/api/fixtures?date_range=all&competition=1pQrStUv90&league=ZyXwVu5678&tenant=Tn12345678&timezone=Australia%2FBrisbane");
  });

  it("asks the second way when the first is refused, or does not name a centre, or is not data", async () => {
    for (const first of [answer({ message: "Not Found" }, 404), answer({ data: [] }), answer(undefined), answer({ data: [{ id: "Aa11111111" }, { id: "Bb22222222" }] })]) {
      const d = dribl({ [BY_BOTH]: first, [BY_SLUG]: answer({ data: CENTRE }) });
      expect((await driblRequestFromLink(LINK, d.fetchImpl)).url).toBe(REQUEST);
      expect(d.urls()).toEqual([BY_BOTH, BY_SLUG]);
    }
  });

  it("says what Dribl answered when neither names the match centre, with field names and never what they held", async () => {
    const refused = dribl({ [BY_BOTH]: answer({}, 404), [BY_SLUG]: answer({}, 403) });
    await expect(driblRequestFromLink(LINK, refused.fetchImpl)).rejects.toThrow("Dribl responded 403 when asked which match centre this is.");
    expect(refused.urls()).toEqual([BY_BOTH, BY_SLUG]);

    const odd = dribl({ "https://mc-api.dribl.com/api/tenants": answer({ data: [{ id: "Aa11111111", secret: "s3cr3t-value" }, { id: "Bb22222222" }], meta: { per_page: 30 } }) });
    const said = await driblRequestFromLink(LINK, odd.fetchImpl).catch((e) => e.message);
    expect(said).toBe(`${NO_MATCH_CENTRE} Its answer has: data, meta; data: id, secret.`);
    expect(said).not.toContain("s3cr3t");

    const empty = dribl({ "https://mc-api.dribl.com/api/tenants": answer({ data: [] }) });
    await expect(driblRequestFromLink(LINK, empty.fetchImpl)).rejects.toThrow(`${NO_MATCH_CENTRE} Its answer has: data.`);
    const page = dribl({ "https://mc-api.dribl.com/api/tenants": answer(undefined) });
    await expect(driblRequestFromLink(LINK, page.fetchImpl)).rejects.toThrow(`${NO_MATCH_CENTRE} Its answer has: nothing this app could read.`);
  });

  it("says Dribl could not be reached when the browser cannot ask at all, and does not ask again", async () => {
    const d = dribl({});
    await expect(driblRequestFromLink(LINK, d.fetchImpl)).rejects.toThrow(UNREACHABLE);
    expect(d.urls()).toEqual([BY_BOTH]);
  });

  it("never builds a request from an id that is not one", async () => {
    for (const id of ["Tn1234&club=Evil9999", "../fixtures", "x y", ""]) {
      const d = dribl({ "https://mc-api.dribl.com/api/tenants": answer({ data: { id, attributes: { slug: "winterleague" } } }) });
      await expect(driblRequestFromLink(LINK, d.fetchImpl)).rejects.toThrow(NO_MATCH_CENTRE);
    }
  });

  it("asks nothing for text that is not a Dribl fixtures link, and says which kind of mistake it is", async () => {
    const d = dribl({ "https://": answer({ data: CENTRE }) });
    for (const notOne of ["", "   ", "winterleague.dribl.com/fixtures?club=MnOpQr2468", "https://example.com/fixtures?club=MnOpQr2468", REQUEST, null, 42,
      "https://registration.squadi.com/liveScoreSeasonFixture?competitionUniqueKey=11111111-2222-4333-8444-555555555555&divisionId=20001&teamId=300001",
      "http://winterleague.dribl.com/fixtures?club=MnOpQr2468", "https://dribl.com/fixtures?club=MnOpQr2468"]) {
      await expect(driblRequestFromLink(notOne, d.fetchImpl), String(notOne)).rejects.toThrow(NOT_A_DRIBL_LINK);
    }
    await expect(driblRequestFromLink("https://winterleague.dribl.com/fixtures?date_range=all", d.fetchImpl)).rejects.toThrow(DRIBL_NEEDS_COMPETITION);
    expect(d.asked).toEqual([]);
  });

  it("only ever asks Dribl's API", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: { ...CENTRE, links: { self: { href: "https://evil.example/steal" } } } }) });
    await driblRequestFromLink(LINK, d.fetchImpl);
    expect(d.urls().every((u) => new URL(u).host === "mc-api.dribl.com")).toBe(true);
  });
});

describe("readDriblDraw — what a request's draw says before it is saved", () => {
  const fixtures = (items) => dribl({ "https://mc-api.dribl.com/api/fixtures": answer({ data: items, links: {}, meta: {} }) });

  it("says how many games, for which team, and what the draw calls itself", async () => {
    const d = fixtures(ONE_TEAM);
    expect(await readDriblDraw({ url: REQUEST }, d.fetchImpl)).toEqual({
      draw: { games: 3, ourGames: 3, teams: [US, "Hilltop United U8", "Lakeside Rovers U8", "Valley Wanderers U8"], ours: US, problem: "", competition: "Winter League", league: "Under 8" },
      problem: ""
    });
    expect(d.urls()).toEqual([REQUEST]);
  });

  it("leaves which team is ours to the set-up when the draw does not show it, offering the busiest first", async () => {
    const { draw, problem } = await readDriblDraw({ url: REQUEST }, fixtures(TWO_TEAMS).fetchImpl);
    expect(problem).toBe("");
    expect([draw.games, draw.ours, draw.ourGames]).toEqual([4, "", 0]);
    expect(draw.teams).toEqual(["Riverside FC U8 Golds", "Hilltop United U8", "Riverside FC U8 Blues", "Lakeside Rovers U8"]);
  });

  it("counts our team's games once its name is given, whole or in part", async () => {
    const whole = await readDriblDraw({ url: REQUEST, team: "Riverside FC U8 Blues" }, fixtures(TWO_TEAMS).fetchImpl);
    expect([whole.draw.ours, whole.draw.ourGames, whole.draw.games, whole.problem]).toEqual(["Riverside FC U8 Blues", 2, 4, ""]);
    const part = await readDriblDraw({ url: REQUEST, team: "golds" }, fixtures(TWO_TEAMS).fetchImpl);
    expect([part.draw.ours, part.draw.ourGames, part.problem]).toEqual(["Riverside FC U8 Golds", 3, ""]);
  });

  it("says so when the name given is not in the draw, or fits more than one team", async () => {
    const missing = await readDriblDraw({ url: REQUEST, team: "Seaside FC" }, fixtures(TWO_TEAMS).fetchImpl);
    expect(missing.problem).toBe('No team called "Seaside FC" is in this Dribl draw.');
    expect([missing.draw.ours, missing.draw.games]).toEqual(["", 4]);
    const vague = await readDriblDraw({ url: REQUEST, team: "Riverside" }, fixtures(TWO_TEAMS).fetchImpl);
    expect(vague.problem).toBe('More than one team in this Dribl draw has "Riverside" in its name. Use the whole name as Dribl shows it.');
  });

  it("reads a draw with nothing in it yet as no games and no problem", async () => {
    expect(await readDriblDraw({ url: REQUEST }, fixtures([]).fetchImpl)).toEqual({
      draw: { games: 0, ourGames: 0, teams: [], ours: "", problem: "", competition: "", league: "" }, problem: ""
    });
  });

  it("says why when Dribl does not give the draw", async () => {
    expect(await readDriblDraw({ url: REQUEST }, dribl({ [REQUEST]: answer({}, 500) }).fetchImpl)).toEqual({ draw: null, problem: "Dribl responded 500" });
    expect(await readDriblDraw({ url: REQUEST }, dribl({}).fetchImpl)).toEqual({ draw: null, problem: UNREACHABLE });
    expect(await readDriblDraw({ url: REQUEST }, dribl({ [REQUEST]: answer({ games: [] }) }).fetchImpl)).toEqual({ draw: null, problem: "Unexpected Dribl response shape" });
    expect(await readDriblDraw({ url: "https://example.com/" }, dribl({}).fetchImpl)).toEqual({ draw: null, problem: "Not a Dribl fixtures request" });
  });

  it("says now what the sync would say later: games it cannot read, or a kick-off it cannot make sense of", async () => {
    const unreadable = await readDriblDraw({ url: REQUEST }, fixtures([{ id: 7, match: { home: "A", away: "B" } }]).fetchImpl);
    expect(unreadable.problem).toBe(`${NOT_READABLE} A game there has: id, match.`);
    expect(unreadable.draw.games).toBe(0);
    const noDate = await readDriblDraw({ url: REQUEST }, fixtures([game("g1", US, "Hilltop United U8", { date: "sometime" }), game("g2", "Lakeside Rovers U8", US)]).fetchImpl);
    expect(noDate.problem).toBe(`${NOT_READABLE} A game's date reads: "sometime".`);
    expect(noDate.draw.ours).toBe(US);
  });
});

describe("readDriblLink — a pasted link, all the way", () => {
  it("looks the match centre up, then reads the draw of the request it built: two requests, both to Dribl's API", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: CENTRE }), [REQUEST]: answer({ data: ONE_TEAM }) });
    const got = await readDriblLink(LINK, { fetchImpl: d.fetchImpl });
    expect(got).toEqual({
      link: LINK, url: REQUEST, problem: "",
      draw: { games: 3, ourGames: 3, teams: [US, "Hilltop United U8", "Lakeside Rovers U8", "Valley Wanderers U8"], ours: US, problem: "", competition: "Winter League", league: "Under 8" }
    });
    expect(d.urls()).toEqual([BY_BOTH, REQUEST]);
  });

  it("uses the team name the set-up already has", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: CENTRE }), [REQUEST]: answer({ data: TWO_TEAMS }) });
    expect((await readDriblLink(LINK, { team: "Riverside FC U8 Blues", fetchImpl: d.fetchImpl })).draw.ours).toBe("Riverside FC U8 Blues");
  });

  it("still gives the request when its draw could not be read, with the reason", async () => {
    const d = dribl({ [BY_BOTH]: answer({ data: CENTRE }), [REQUEST]: answer({}, 503) });
    expect(await readDriblLink(LINK, { fetchImpl: d.fetchImpl })).toEqual({ link: LINK, url: REQUEST, draw: null, problem: "Dribl responded 503" });
  });

  it("throws when no request could be worked out, and reads no draw", async () => {
    const d = dribl({ "https://mc-api.dribl.com/api/tenants": answer({ data: [] }), [REQUEST]: answer({ data: ONE_TEAM }) });
    await expect(readDriblLink(LINK, { fetchImpl: d.fetchImpl })).rejects.toThrow(NO_MATCH_CENTRE);
    expect(d.urls()).toEqual([BY_BOTH, BY_SLUG]);
  });
});
