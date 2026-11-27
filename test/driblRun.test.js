import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runDriblSync, failureOf, says, siteBase, DEFAULT_CLUB_HEADER } from "@/lib/driblRun";
import { UNREACHABLE, NOT_READABLE, WHICH_TEAM, politeness } from "@/lib/dribl";

// Dribl asked again after a wait (lib/dribl.js): instant here.
const realWait = politeness.wait;
beforeEach(() => { politeness.wait = async () => {}; });
afterEach(() => { politeness.wait = realWait; });

// The scheduled Dribl reader (scripts/dribl-sync.mjs runs it on GitHub's
// servers). It asks the site what to read, reads each draw from Dribl with
// plain requests, and posts each team's games back. The site and Dribl are
// stood in for; every name, id and key is made up.

const SITE = "https://club.example.org";
const KEY = "cr0n-key-123";
const CLUB = "club-agreed-value-456";
const REQ_1 = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FBrisbane";
const REQ_2 = REQ_1.replace("league=ZyXwVu5678", "league=OtHeR12345");
const REQ_3 = REQ_1.replace("club=MnOpQr2468", "club=ClUbTwo999");
const ASKED = { teams: [
  { team: "riverside-u8", sources: [{ comp: "cwinter01", name: "Winter League", url: REQ_1, team: "" }, { comp: "cshield01", name: "Shield", url: REQ_2, team: "Riverside FC U8 Blues" }] },
  { team: "riverside-u10", sources: [{ comp: "ccup00001", name: "Gala Cup", url: REQ_3, team: "" }] }
] };
const game = (id, home, away, more = {}) => ({ type: "fixtures", hash_id: id, attributes: { date: "2031-06-07T23:30:00.000000Z", round: "R1", full_round: "Round 1", home_team_name: home, away_team_name: away, ground_name: "Riverside Park", field_name: "Field 2", bye_flag: false, ...more } });
const BLUES = "Riverside FC U8 Blues";
const DRAWS = {
  [REQ_1]: [game("g1", BLUES, "Hilltop United U8"), game("g2", "Lakeside Rovers U8", BLUES)],
  [REQ_2]: [game("g3", BLUES, "Riverside FC U8 Golds"), game("g4", "Riverside FC U8 Golds", "Valley Wanderers U8"), game("g5", BLUES, "Valley Wanderers U8")],
  [REQ_3]: [game("g6", "Riverside FC U10", "Seaside FC U10"), game("g7", "Hilltop United U10", "Riverside FC U10")]
};
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A stand-in for the network: the site's two calls and Dribl's fixtures requests.
function network({ site = {}, dribl = {} } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u === `${SITE}/api/dribl` && (opts.method || "GET") === "GET") {
      if (site.get instanceof Error) throw site.get;
      return site.get || json(ASKED);
    }
    if (u === `${SITE}/api/dribl` && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      const answer = typeof site.post === "function" ? site.post(body) : site.post;
      if (answer instanceof Error) throw answer;
      return answer || json({ ok: true, matchesSeen: body.draws.reduce((n, d) => n + d.records.length, 0), created: 2, changes: ["Round 1 moved"] });
    }
    if (u.startsWith("https://mc-api.dribl.com/api/fixtures")) {
      const request = u.replace(/&cursor=[^&]*$/, "");
      const answer = typeof dribl[request] === "function" ? dribl[request](u) : dribl[request];
      if (answer instanceof Error) throw answer;
      return answer || json({ data: DRAWS[request] || [], links: {}, meta: {} });
    }
    throw new TypeError("Failed to fetch");
  });
  return { fetchImpl, calls, posts: () => calls.filter((c) => c.opts.method === "POST").map((c) => JSON.parse(c.opts.body)), toDribl: () => calls.filter((c) => c.url.startsWith("https://mc-api.dribl.com/")) };
}
async function run(net, more = {}) {
  const lines = [];
  const result = await runDriblSync({ site: SITE, cronKey: KEY, fetchImpl: net.fetchImpl, log: (l) => lines.push(l), ...more });
  return { result, lines };
}

describe("runDriblSync — a run that reads every draw", () => {
  it("asks the site with the key, reads each draw from Dribl with plain requests, and posts each team's games back", async () => {
    const net = network();
    const { result, lines } = await run(net);
    expect(result).toEqual({ ok: true, teams: 2, draws: 3, read: 3, failed: [], refused: 0, saved: 2 });
    // The site: asked once with the key, then one post per team.
    const toSite = net.calls.filter((c) => c.url.startsWith(SITE));
    expect(toSite.map((c) => [c.opts.method || "GET", c.opts.headers.Authorization])).toEqual([["GET", `Bearer ${KEY}`], ["POST", `Bearer ${KEY}`], ["POST", `Bearer ${KEY}`]]);
    expect(net.posts().map((p) => [p.team, p.draws.map((d) => [d.comp, d.records.map((r) => r.squadiId)])])).toEqual([
      ["riverside-u8", [["cwinter01", ["dribl:g1", "dribl:g2"]], ["cshield01", ["dribl:g3", "dribl:g5"]]]],
      ["riverside-u10", [["ccup00001", ["dribl:g6", "dribl:g7"]]]]
    ]);
    // The records are the ones the app reads from Dribl: our side, the opponent, local time.
    const first = net.posts()[0].draws[0].records[0];
    expect(first).toMatchObject({ dateISO: "2031-06-08", time: "09:30", opponent: "Hilltop United U8", homeAway: "H", venue: "Riverside Park – Field 2" });
    expect(lines).toEqual([
      "2 teams have 3 draws on Dribl.",
      "Team 1, draw 1: 2 games read.", "Team 1, draw 2: 2 games read.", "Team 1: saved. 2 new, 1 change.",
      "Team 2, draw 1: 2 games read.", "Team 2: saved. 2 new, 1 change.",
      "Done: 3 of 3 draws read."
    ]);
  });

  it("asks Dribl plainly: the Accept header, no cookies, a time limit, and nothing that claims to be a browser", async () => {
    const net = network();
    await run(net);
    expect(net.toDribl()).toHaveLength(3);
    for (const { opts } of net.toDribl()) {
      expect(opts.headers).toEqual({ Accept: "application/json" });
      expect(opts.credentials).toBe("omit");
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.stringify(opts.headers)).not.toMatch(/user-agent|sec-ch|Mozilla|Chrome/i);
    }
    // The site's key is never sent to Dribl.
    expect(JSON.stringify(net.toDribl())).not.toContain(KEY);
  });

  it("sends the club's agreed header to Dribl when there is one, on every page, and never to anyone else", async () => {
    const net = network({ dribl: { [REQ_1]: (u) => json(u.includes("cursor=") ? { data: [game("g9", BLUES, "Seaside FC U8")], meta: {} } : { data: DRAWS[REQ_1], meta: { next_cursor: "page2" } }) } });
    const { lines } = await run(net, { clubKey: CLUB });
    expect(DEFAULT_CLUB_HEADER).toBe("X-Club-Sync");
    expect(net.toDribl()).toHaveLength(4); // two pages of the first draw
    for (const { opts } of net.toDribl()) expect(opts.headers).toEqual({ Accept: "application/json", "X-Club-Sync": CLUB });
    for (const c of net.calls.filter((x) => x.url.startsWith(SITE))) expect(JSON.stringify(c.opts.headers)).not.toContain(CLUB);
    expect(lines[0]).toBe("2 teams have 3 draws on Dribl. Sending the club's agreed header.");
    expect(lines.join("\n")).not.toContain(CLUB);
  });

  it("uses the header name Dribl chose, and refuses one that is not a header name", async () => {
    const named = network();
    await run(named, { clubKey: CLUB, clubHeader: " X-Riverside-Key " });
    expect(named.toDribl()[0].opts.headers).toEqual({ Accept: "application/json", "X-Riverside-Key": CLUB });
    for (const bad of ["Bad Header", "x:y", "-x", "é", "x".repeat(65)]) {
      const net = network();
      const { result, lines } = await run(net, { clubKey: CLUB, clubHeader: bad });
      expect(result.ok, bad).toBe(false);
      expect(lines).toEqual(["DRIBL_CLUB_HEADER is not a header name, so nothing was asked of Dribl."]);
      expect(net.calls).toEqual([]);
    }
    // With no club key, the name is not used, so it is not checked.
    expect((await run(network(), { clubHeader: "Bad Header" })).result.ok).toBe(true);
  });
});

describe("runDriblSync — nothing to read", () => {
  it("asks Dribl nothing when no team has a draw on Dribl, and that is a run that worked", async () => {
    for (const teams of [[], [{ team: "riverside-u8", sources: [] }]]) {
      const net = network({ site: { get: json({ teams }) } });
      const { result, lines } = await run(net);
      expect(result).toMatchObject({ ok: true, draws: 0, read: 0 });
      expect(lines).toEqual(["No team has a draw on Dribl set up, so Dribl was not asked anything."]);
      expect(net.toDribl()).toEqual([]);
      expect(net.posts()).toEqual([]);
    }
  });
});

describe("runDriblSync — when it cannot be done", () => {
  it("says what is missing, and asks nobody anything, when SITE_URL or CRON_SECRET is not set", async () => {
    for (const site of [undefined, "", "club.example.org", "ftp://club.example.org", "https://user:pw@club.example.org", "not a link"]) {
      const net = network();
      const { result, lines } = await run(net, { site });
      expect(result.ok, String(site)).toBe(false);
      expect(lines).toEqual(["SITE_URL is not set to the site's address (https://…), so there is nothing to ask."]);
      expect(net.calls).toEqual([]);
    }
    const net = network();
    const { result, lines } = await run(net, { cronKey: "" });
    expect([result.ok, lines]).toEqual([false, ["CRON_SECRET is not set, so the site would not answer. Set it to the same value as on the site."]]);
    expect(net.calls).toEqual([]);
  });

  it("says so when the site refuses the key, cannot be reached, or does not answer with draws, and asks Dribl nothing", async () => {
    for (const [get, said] of [
      [json({ error: "unauthorized" }, 401), "The site did not accept the key (401): CRON_SECRET here must be the same as on the site."],
      [new TypeError("fetch failed"), "The site could not be reached at SITE_URL."],
      [json({ error: "boom" }, 500), "The site did not say what to read (500)."],
      [json({ sources: [] }), "The site did not say what to read (200)."],
      [{ ok: true, status: 200, json: async () => { throw new SyntaxError("not json"); } }, "The site did not say what to read (200)."]
    ]) {
      const net = network({ site: { get } });
      const { result, lines } = await run(net);
      expect(result.ok).toBe(false);
      expect(lines).toEqual([said]);
      expect(net.toDribl()).toEqual([]);
    }
  });

  it("a draw Dribl refuses is said to be refused, the others are still read and saved, and the run fails with the cue", async () => {
    const net = network({ dribl: { [REQ_2]: json({}, 403) } });
    const { result, lines } = await run(net);
    expect(result).toEqual({ ok: false, teams: 2, draws: 3, read: 2, failed: [{ team: 1, draw: 2, kind: "refused", status: 403 }], refused: 1, saved: 2 });
    expect(lines).toContain("Team 1, draw 2: refused by Dribl (403).");
    expect(net.posts().map((p) => p.draws.map((d) => d.comp))).toEqual([["cwinter01"], ["ccup00001"]]);
    expect(lines.slice(-2)).toEqual([
      "Done: 2 of 3 draws read, 1 not.",
      "Dribl refused the reader's requests. That is the cue to take it up with Dribl: see \"A scheduled Dribl sync\" in the README."
    ]);
  });

  it("a team whose draws all failed posts nothing, and each kind of failure is named without Dribl's own words", async () => {
    const net = network({ dribl: {
      [REQ_1]: json({}, 503),
      [REQ_2]: new TypeError("Failed to fetch"),
      [REQ_3]: json({ data: [{ id: 7, match: { home: "Riverside FC U10" } }] })
    } });
    const { result, lines } = await run(net);
    expect(result).toMatchObject({ ok: false, read: 0, refused: 0, saved: 0 });
    expect(lines.slice(1, 4)).toEqual([
      "Team 1, draw 1: Dribl had a problem (503).",
      "Team 1, draw 2: Dribl did not answer.",
      "Team 2, draw 1: Dribl's answer was not in the form the app reads."
    ]);
    expect(net.posts()).toEqual([]);
    expect(lines.at(-1)).toBe("Done: 0 of 3 draws read, 3 not.");
  });

  it("a draw that does not show which team is ours says to check the set-up, never naming a team", async () => {
    // Two of the club's teams in one draw, and no team name in the set-up.
    const net = network({ site: { get: json({ teams: [{ team: "riverside-u8", sources: [{ comp: "cshield01", name: "Shield", url: REQ_2, team: "" }] }] }) } });
    const { lines } = await run(net);
    expect(lines[1]).toBe("Team 1, draw 1: the team's name on Dribl needs checking in the team's set-up.");
    const misnamed = network({ site: { get: json({ teams: [{ team: "riverside-u8", sources: [{ comp: "cshield01", name: "Shield", url: REQ_2, team: "Seaside" }] }] }) } });
    const second = await run(misnamed);
    expect(second.lines[1]).toBe("Team 1, draw 1: the team's name on Dribl needs checking in the team's set-up.");
    expect(second.lines.join("\n")).not.toContain("Seaside");
  });

  it("says so when the site does not save a team's games, with the site's own sentence, and goes on to the next team", async () => {
    const net = network({ site: { post: (body) => (body.team === "riverside-u8" ? json({ error: "That competition does not take its draw from Dribl." }, 400) : undefined) } });
    const { result, lines } = await run(net);
    expect(result).toMatchObject({ ok: false, saved: 1, failed: [{ team: 1, kind: "site", status: 400 }] });
    expect(lines).toContain("Team 1: the site did not save the games (400: That competition does not take its draw from Dribl.).");
    expect(lines).toContain("Team 2: saved. 2 new, 1 change.");
    const down = network({ site: { post: new TypeError("fetch failed") } });
    const again = await run(down);
    expect(again.lines.filter((l) => l.includes("could not be reached"))).toEqual(["Team 1: the site could not be reached to save the games.", "Team 2: the site could not be reached to save the games."]);
  });
});

describe("runDriblSync — counting what it did", () => {
  it("a bye is not counted as a game read, though it is still posted for the app to handle", async () => {
    const withBye = [...DRAWS[REQ_1], game("g8", BLUES, "", { bye_flag: true, round: "R3", full_round: "Round 3" })];
    const net = network({ dribl: { [REQ_1]: json({ data: withBye }) } });
    const { lines } = await run(net);
    expect(lines[1]).toBe("Team 1, draw 1: 2 games read.");
    expect(net.posts()[0].draws[0].records.map((r) => [r.squadiId, !!r.bye])).toEqual([["dribl:g1", false], ["dribl:g2", false], ["dribl:g8", true]]);
  });

  it("a save the site does not confirm is not counted as saved: an answer that is not the site's, or says no", async () => {
    for (const answer of [{ ok: true, status: 200, json: async () => { throw new SyntaxError("a page, not json"); } }, json({ ok: false }), json({})]) {
      const net = network({ site: { post: () => answer } });
      const { result, lines } = await run(net);
      expect(result).toMatchObject({ ok: false, saved: 0 });
      expect(lines).toContain("Team 1: the site did not save the games (200).");
    }
  });
});

describe("what a run prints is safe in a public repository", () => {
  it("never a team's slug or name, a competition, an id, a link or a key, whatever happens", async () => {
    const secrets = [KEY, CLUB, "riverside", "Riverside", "Winter League", "Shield", "Gala Cup", "cwinter01", "cshield01", "ccup00001", "AbCdEf1234", "1pQrStUv90", "ZyXwVu5678", "MnOpQr2468", "Tn12345678", "mc-api", "https://", "Hilltop", "Lakeside", "Valley", "Seaside", "Field 2"];
    const all = [];
    for (const net of [
      network(),
      network({ dribl: { [REQ_1]: json({}, 403), [REQ_2]: json({ data: [{ id: 1, attributes: { name: "Riverside FC U8 Blues" } }] }), [REQ_3]: new TypeError("x") } }),
      network({ site: { post: () => json({ error: "That competition does not take its draw from Dribl." }, 400) } }),
      network({ site: { get: json({}, 401) } })
    ]) all.push(...(await run(net, { clubKey: CLUB })).lines);
    const printed = all.join("\n");
    for (const s of secrets) expect(printed, s).not.toContain(s);
  });
});

describe("failureOf and says — a failure by its kind", () => {
  it("reads Dribl's status: a refusal is 401, 403 or 429; any other status is Dribl's own problem", () => {
    for (const status of [401, 403, 429]) expect(failureOf(new Error(`Dribl responded ${status}`))).toEqual({ kind: "refused", status });
    for (const status of [404, 500, 502, 503]) expect(failureOf(new Error(`Dribl responded ${status}`))).toEqual({ kind: "dribl-error", status });
    expect(says({ kind: "refused", status: 403 })).toBe("refused by Dribl (403)");
  });

  it("names the rest by kind", () => {
    const err = (m, name) => Object.assign(new Error(m), name ? { name } : {});
    expect(failureOf(err(UNREACHABLE))).toEqual({ kind: "unreachable" });
    expect(failureOf(err("The operation was aborted due to timeout", "TimeoutError"))).toEqual({ kind: "unreachable" });
    expect(failureOf(err(`${NOT_READABLE} A game there has: id, match.`))).toEqual({ kind: "unreadable" });
    expect(failureOf(err("Unexpected Dribl response shape"))).toEqual({ kind: "unreadable" });
    expect(failureOf(err(WHICH_TEAM))).toEqual({ kind: "which-team" });
    expect(failureOf(err('No team called "X" is in this Dribl draw.'))).toEqual({ kind: "which-team" });
    expect(failureOf(err('More than one team in this Dribl draw has "X" in its name. Use the whole name as Dribl shows it.'))).toEqual({ kind: "which-team" });
    expect(failureOf(err("Not a Dribl fixtures request"))).toEqual({ kind: "not-a-request" });
    expect(failureOf(err("anything else"))).toEqual({ kind: "other" });
    expect(failureOf(undefined)).toEqual({ kind: "other" });
    expect(says({ kind: "other" })).toBe("something else went wrong");
  });
});

describe("siteBase — the site's address", () => {
  it("is the origin of an http or https address, and nothing else", () => {
    expect(siteBase("https://club.example.org")).toBe("https://club.example.org");
    expect(siteBase("  https://club.example.org/some/page?x=1  ")).toBe("https://club.example.org");
    expect(siteBase("http://localhost:3111")).toBe("http://localhost:3111");
    for (const bad of [undefined, null, "", "club.example.org", "ftp://club.example.org", "https://u:p@club.example.org", "javascript:alert(1)"]) expect(siteBase(bad), String(bad)).toBeNull();
  });
});
