// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import TeamWizard, { DRIBL_IN_SEASON, LINK_BEING_READ, DRIBL_BY_HAND, arrived } from "@/components/TeamWizard";
import { SQUADI_NEEDS_TEAM, DRIBL_NEEDS_COMPETITION } from "@/lib/feedLinks";
import { NO_MATCH_CENTRE } from "@/lib/driblLink";
import { UNREACHABLE } from "@/lib/dribl";

// The Competitions step of the team wizard: a draw is set up from its website
// link when that link is the team's fixtures page. A Squadi link is looked up
// through /api/feed-link and fills in the three ids. A Dribl link is turned
// into the competition's fixtures request by the browser itself, which asks
// Dribl which match centre it is and reads the draw once. What was found is
// read back under the field, and the link is kept as the draw's website link.
// The link readers are real; /api/teams, /api/feed-link and Dribl are stood in
// for. Every key, id and name is made up.

const KEY = "11111111-2222-4333-8444-555555555555";
const SQ = `https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&yearId=8&competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const DR = "https://winterleague.dribl.com/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FBrisbane";
const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&tenant=Tn12345678&timezone=Australia%2FBrisbane";
const LOOKUP = "https://mc-api.dribl.com/api/tenants?mc_link=winterleague.dribl.com&slug=winterleague";
const OTHER_SITE = "https://www.example.org/winter-cup/draw";
const FOUND = {
  ok: true, provider: "squadi", link: SQ, squadi: { competitionId: "777", divisionId: "20001", teamId: 300001 },
  found: { competition: "Metro | Winter League", division: "Under 8 Blues K1", team: "Riverside FC U8 Blues", games: 14 }
};
const READ_BACK = "Riverside FC U8 Blues · Under 8 Blues K1 · Metro | Winter League. 14 games found. They sync by themselves.";
const SAVED = {
  slug: "u8-blues", name: "Riverside FC U8 Blues", ageGroup: "U8", password: "blue-kanga-42", calendarKey: "abc123", coachEmails: [], source: "stored",
  squadi: { competitionId: "777", divisionId: "20001", teamId: 300001, link: SQ },
  competitions: [{ id: "cdribl001", name: "Winter League", dribl: { url: REQUEST, team: "Riverside FC U8 Blues" }, link: DR }]
};

const game = (id, home, away, more = {}) => ({
  type: "fixtures", hash_id: id,
  attributes: { date: "2031-06-07T23:30:00.000000Z", round: "R1", full_round: "Round 1", home_team_name: home, away_team_name: away, ground_name: "Riverside Park", field_name: "Field 2", competition_name: "Winter League", league_name: "Under 8", bye_flag: false, ...more }
});
const US = "Riverside FC U8 Blues";
const ONE_TEAM = [game("g1", US, "Hilltop United U8"), game("g2", "Lakeside Rovers U8", US), game("g3", US, "Valley Wanderers U8")];
const TWO_TEAMS = [game("g1", "Riverside FC U8 Blues", "Hilltop United U8"), game("g2", "Riverside FC U8 Golds", "Lakeside Rovers U8"), game("g3", "Hilltop United U8", "Riverside FC U8 Golds"), game("g4", "Riverside FC U8 Blues", "Riverside FC U8 Golds")];
const FOUND_ON_DRIBL = "Riverside FC U8 Blues · Winter League · Under 8. 3 games found. They sync whenever a coach opens the team.";
const WHICH_IS_OURS = "Winter League · Under 8. 4 games found, but the draw does not show which team is yours. Choose it in the team name box above.";

let teams;
let saves;      // bodies sent to /api/teams (POST or PATCH)
let lookups;    // links sent to /api/feed-link
let lookup;     // what /api/feed-link answers: { ok, status, json }, an Error, or a function of the link
let hold;       // a promise the first request of a read waits on before answering
let dribl;      // what Dribl answers: { centre, draw }, each { status, json } or an Error
let asked;      // every request this browser made of Dribl: { url, opts }
beforeEach(() => {
  teams = [SAVED];
  saves = []; lookups = []; asked = []; hold = null;
  lookup = { ok: true, status: 200, json: FOUND };
  dribl = { centre: { status: 200, json: { data: { type: "tenants", id: "Tn12345678", attributes: { slug: "winterleague", mc_link: "winterleague.dribl.com" } } } }, draw: { status: 200, json: { data: ONE_TEAM } } };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    if (u.startsWith("https://mc-api.dribl.com/")) {
      asked.push({ url: u, opts });
      const isLookup = u.startsWith("https://mc-api.dribl.com/api/tenants");
      if (isLookup && hold) await hold;
      const answer = isLookup ? dribl.centre : dribl.draw;
      if (answer instanceof Error) throw answer;
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.json };
    }
    if (u.includes("/api/feed-link")) {
      const { link } = JSON.parse(opts.body);
      lookups.push(link);
      if (hold) await hold;
      const answer = typeof lookup === "function" ? lookup(link) : lookup;
      if (answer instanceof Error) throw answer;
      return { ok: answer.ok, status: answer.status, json: async () => answer.json };
    }
    if (!u.includes("/api/teams")) throw new Error("unexpected fetch " + url);
    if (method === "GET") return { ok: true, json: async () => ({ teams: JSON.parse(JSON.stringify(teams)) }) };
    const body = JSON.parse(opts.body);
    saves.push({ method, body });
    return { ok: true, json: async () => ({ ok: true, team: { slug: "new-team", name: body.name, password: body.password, source: "stored", coachEmails: [] } }) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const step = () => within(screen.getByRole("heading", { level: 4, name: "Competitions" }).closest(".adm-step"));
const field = (label) => step().getByLabelText(label);
const link = (who) => field(`${who} website link`);
const startCreate = async () => {
  render(<TeamWizard />);
  await screen.findByText("Riverside FC U8 Blues");
  fireEvent.click(screen.getByRole("button", { name: "Add a team" }));
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Riverside FC U9 Reds" } });
};
const startEdit = async () => {
  render(<TeamWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Riverside FC U8 Blues" }));
};
// Pasting returns false when the field took the paste over to read it.
const paste = (who, text) => fireEvent.paste(link(who), { clipboardData: { getData: () => text } });
// The whole text arriving in one change, as when a phone's keyboard puts a copied link in without a paste.
const type = (who, text) => fireEvent.change(link(who), { target: { value: text } });
// Typed out, a few characters at a time.
const typeOut = (who, text) => { for (let n = Math.min(3, text.length); ; n = Math.min(n + 3, text.length)) { type(who, text.slice(0, n)); if (n === text.length) break; } };
const ids = (who) => ["competition ID", "division ID", "team ID"].map((k) => field(`${who} ${k}`).value);
const readButton = (who) => step().queryByRole("button", { name: `Read link for ${who}` });
// The note sits under the field's own line, inside the field.
const noteUnder = (who) => link(who).parentElement.nextElementSibling;
const noteOf = (who) => { const n = noteUnder(who); return n ? [n.textContent, n.className, n.getAttribute("role")] : null; };
const request = (who) => field(`${who} Dribl fixtures request`);
const teamBox = (who) => step().queryByLabelText(`${who} team name on Dribl`);
const offered = (who) => { const id = teamBox(who).getAttribute("list"); return id ? [...document.getElementById(id).querySelectorAll("option")].map((o) => o.value) : null; };
const addCompetition = (name) => {
  fireEvent.click(step().getByRole("button", { name: "Add a competition" }));
  const n = step().getAllByLabelText(/^Competition \d+ name$/).length;
  if (name) fireEvent.change(field(`Competition ${n} name`), { target: { value: name } });
};
const create = async () => { fireEvent.click(screen.getByRole("button", { name: "Create team" })); await waitFor(() => expect(saves).toHaveLength(1)); return saves[0].body; };

describe("the season's link", () => {
  it("pasting the team's Squadi fixtures link looks it up, fills in the three ids and reads back what it found; the link is saved with them", async () => {
    await startCreate();
    expect(link("Squadi").getAttribute("placeholder")).toBe("Paste the draw's page link (https://…)");
    expect(paste("Squadi", `  ${SQ}\n`)).toBe(false);
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect(lookups).toEqual([SQ]); // the link as read, without the stray space
    expect(link("Squadi").value).toBe(SQ);
    expect(noteOf("Squadi")).toEqual([READ_BACK, "adm-msg ok", "status"]);
    expect(asked).toEqual([]); // Dribl is asked nothing about a Squadi link
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ });
  });

  it("Read link appears once what is typed is a page on Squadi or Dribl; pressing it, or Enter, reads it, once at a time", async () => {
    await startCreate();
    expect(readButton("Squadi")).toBeNull();
    typeOut("Squadi", SQ.slice(0, 20));
    expect(readButton("Squadi")).toBeNull();
    typeOut("Squadi", SQ);
    expect(link("Squadi").value).toBe(SQ);
    expect(lookups).toEqual([]); // typing alone asks nothing
    expect(readButton("Squadi").textContent).toBe("Read link");
    // It sits after the Open link, at the end of the field's line.
    expect(readButton("Squadi").previousElementSibling.getAttribute("aria-label")).toBe("Open the Squadi website link in a new tab");
    let release;
    hold = new Promise((r) => { release = r; });
    fireEvent.click(readButton("Squadi"));
    await waitFor(() => expect(readButton("Squadi").textContent).toBe("Reading…"));
    expect(readButton("Squadi").disabled).toBe(true);
    fireEvent.keyDown(link("Squadi"), { key: "Enter" }); // not asked twice while one is on its way
    release();
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect(readButton("Squadi").textContent).toBe("Read link");
    expect(lookups).toEqual([SQ]);
    hold = null;
    fireEvent.keyDown(link("Squadi"), { key: "Enter" });
    await waitFor(() => expect(lookups).toEqual([SQ, SQ]));
    fireEvent.keyDown(link("Squadi"), { key: "a" });
    expect(lookups).toHaveLength(2);
  });

  it("a link put in whole is read even when the browser never said it was pasted; the same link typed out is not", async () => {
    await startCreate();
    type("Squadi", `${SQ} `); // one change holding the whole link, as a phone keyboard's clipboard does it
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect(lookups).toEqual([SQ]);
    expect(link("Squadi").value).toBe(SQ);
    expect(noteUnder("Squadi").textContent).toBe(READ_BACK);
    // Replacing it whole with another link reads the new one too.
    const SQ2 = SQ.replace("divisionId=20001", "divisionId=20444").replace("teamId=300001", "teamId=399999");
    lookup = { ok: true, status: 200, json: { ...FOUND, link: SQ2, squadi: { competitionId: "777", divisionId: "20444", teamId: 399999 } } };
    type("Squadi", SQ2);
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20444", "399999"]));
    expect(lookups).toEqual([SQ, SQ2]);
    // Cutting most of it away is not a link arriving, and neither is a letter typed.
    type("Squadi", SQ2.slice(0, 40));
    type("Squadi", SQ2.slice(0, 41));
    expect(lookups).toHaveLength(2);
  });

  it("a link to any other site is simply the website link it always was: nothing to read, nothing asked, saved as typed", async () => {
    await startCreate();
    expect(paste("Squadi", OTHER_SITE)).toBe(true); // an ordinary paste, left to the browser
    type("Squadi", OTHER_SITE);
    expect(readButton("Squadi")).toBeNull();
    fireEvent.keyDown(link("Squadi"), { key: "Enter" });
    expect(noteUnder("Squadi")).toBeNull();
    expect(step().getByRole("link", { name: "Open the Squadi website link in a new tab" }).getAttribute("href")).toBe(OTHER_SITE);
    expect((await create()).squadi).toEqual({ competitionId: "", divisionId: "", teamId: "", link: OTHER_SITE });
    expect([lookups, asked]).toEqual([[], []]);
  });

  it("a Squadi page that does not name one team is said so, gently, and kept as the link it is", async () => {
    await startCreate();
    const wholeDivision = SQ.replace("&teamId=300001", "");
    paste("Squadi", wholeDivision);
    expect(noteOf("Squadi")).toEqual([SQUADI_NEEDS_TEAM, "adm-msg warn", "status"]);
    expect(ids("Squadi")).toEqual(["", "", ""]);
    expect(lookups).toEqual([]);
    expect(link("Squadi").value).toBe(wholeDivision);
    type("Squadi", wholeDivision + "&r=3");
    expect(noteUnder("Squadi")).toBeNull(); // typing puts the note away
    expect((await create()).squadi).toEqual({ competitionId: "", divisionId: "", teamId: "", link: wholeDivision + "&r=3" });
  });

  it("a Dribl link here is pointed to a competition row, and Dribl is asked nothing", async () => {
    await startCreate();
    paste("Squadi", DR);
    expect(noteOf("Squadi")).toEqual([DRIBL_IN_SEASON, "adm-msg warn", "status"]);
    expect(link("Squadi").value).toBe(DR);
    expect([lookups, asked]).toEqual([[], []]);
    expect(ids("Squadi")).toEqual(["", "", ""]);
  });

  it("what Squadi could not tell us is shown as it was said, and the ids are left alone", async () => {
    await startCreate();
    fireEvent.change(field("Squadi competition ID"), { target: { value: "55" } });
    lookup = { ok: false, status: 400, json: { error: "Squadi did not recognise the competition in that link." } };
    paste("Squadi", SQ);
    await waitFor(() => expect(noteOf("Squadi")).toEqual(["Squadi did not recognise the competition in that link.", "adm-msg err", "alert"]));
    expect(ids("Squadi")).toEqual(["55", "", ""]);
    lookup = new Error("network down");
    fireEvent.click(readButton("Squadi"));
    await waitFor(() => expect(noteUnder("Squadi").textContent).toBe("network down"));
    lookup = { ok: true, status: 200, json: { ok: true } }; // an answer with no ids in it is not trusted
    fireEvent.click(readButton("Squadi"));
    await waitFor(() => expect(noteUnder("Squadi").textContent).toBe("Couldn't read that link. Try again."));
    expect(ids("Squadi")).toEqual(["55", "", ""]);
    expect(link("Squadi").value).toBe(SQ); // the link is still the link
  });

  it("says so when no games are out yet, or when the draw could not be read", async () => {
    await startCreate();
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, team: "", games: 0 } } };
    paste("Squadi", SQ);
    await waitFor(() => expect(noteUnder("Squadi")?.textContent).toBe(
      "Under 8 Blues K1 · Metro | Winter League. No games are published for this team yet. They sync by themselves once they are. If that is not right, check the link is your team's."));
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, team: "", games: null } } };
    fireEvent.click(readButton("Squadi"));
    await waitFor(() => expect(noteUnder("Squadi").textContent).toBe(
      "Under 8 Blues K1 · Metro | Winter League. The draw could not be read just now, but the link is good. Its games sync by themselves."));
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, games: 1 } } };
    fireEvent.click(readButton("Squadi"));
    await waitFor(() => expect(noteUnder("Squadi").textContent).toMatch(/\. 1 game found\. They sync by themselves\.$/));
  });

  it("an id changed by hand puts the read-back away; the link stays the draw's link", async () => {
    await startCreate();
    paste("Squadi", SQ);
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    fireEvent.change(field("Squadi team ID"), { target: { value: "300002" } });
    expect(noteUnder("Squadi")).toBeNull();
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300002", link: SQ });
  });

  it("a save pressed while a link is still being read waits for it, rather than keeping the link and none of what it finds", async () => {
    await startCreate();
    let release;
    hold = new Promise((r) => { release = r; });
    paste("Squadi", SQ);
    await waitFor(() => expect(readButton("Squadi").textContent).toBe("Reading…"));
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText(LINK_BEING_READ)).toBeTruthy();
    expect(saves).toEqual([]);
    release();
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ });
  });

  it("each of two teams has its own link", async () => {
    await startCreate();
    fireEvent.click(step().getByRole("button", { name: "Add a second team" }));
    const SQ2 = SQ.replace("divisionId=20001", "divisionId=20002").replace("teamId=300001", "teamId=300002");
    lookup = (asked) => ({ ok: true, status: 200, json: asked === SQ ? FOUND : { ...FOUND, link: SQ2, squadi: { competitionId: "777", divisionId: "20002", teamId: 300002 } } });
    paste("Squadi", SQ);
    paste("Second Squadi", SQ2);
    await waitFor(() => expect([ids("Squadi"), ids("Second Squadi")]).toEqual([["777", "20001", "300001"], ["777", "20002", "300002"]]));
    fireEvent.change(field("Squadi team label"), { target: { value: "Red" } });
    fireEvent.change(field("Second Squadi team label"), { target: { value: "White" } });
    expect((await create()).squadi).toEqual([
      { label: "Red", competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ },
      { label: "White", competitionId: "777", divisionId: "20002", teamId: "300002", link: SQ2 }
    ]);
  });

  it("an answer that comes back after the link was changed is not written over the new one", async () => {
    await startCreate();
    let release;
    hold = new Promise((r) => { release = r; });
    paste("Squadi", SQ);
    await waitFor(() => expect(lookups).toEqual([SQ]));
    const another = SQ.replace("teamId=300001", "teamId=300009");
    type("Squadi", another); // changed while Squadi was answering
    expect(readButton("Squadi").textContent).toBe("Read link"); // not left reading for ever
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ids("Squadi")).toEqual(["", "", ""]);
    expect(link("Squadi").value).toBe(another);
    expect(noteUnder("Squadi")).toBeNull();
  });
});

describe("a competition's link — on Squadi", () => {
  it("fills in its ids and, when it has no name yet, takes Squadi's name for the competition", async () => {
    await startCreate();
    addCompetition();
    paste("Competition 1", SQ);
    await waitFor(() => expect(field("Competition 1 name").value).toBe("Metro | Winter League"));
    expect(ids("Metro | Winter League")).toEqual(["777", "20001", "300001"]);
    expect(noteOf("Metro | Winter League")).toEqual([READ_BACK, "adm-msg ok", "status"]);
    expect((await create()).competitions).toEqual([{ name: "Metro | Winter League", squadi: { competitionId: "777", divisionId: "20001", teamId: "300001" }, link: SQ }]);
  });

  it("keeps a name already typed, and an id changed by hand puts the read-back away", async () => {
    await startCreate();
    addCompetition("Winterfest");
    paste("Winterfest", SQ);
    await waitFor(() => expect(ids("Winterfest")).toEqual(["777", "20001", "300001"]));
    expect(field("Competition 1 name").value).toBe("Winterfest");
    expect(noteUnder("Winterfest").textContent).toBe(READ_BACK);
    fireEvent.change(field("Winterfest division ID"), { target: { value: "20009" } });
    expect(noteUnder("Winterfest")).toBeNull();
    expect((await create()).competitions).toEqual([{ name: "Winterfest", squadi: { competitionId: "777", divisionId: "20009", teamId: "300001" }, link: SQ }]);
  });

  it("takes the place of a Dribl request on the row: a competition has one source", async () => {
    await startCreate();
    addCompetition("Winterfest");
    fireEvent.change(request("Winterfest"), { target: { value: REQUEST } });
    fireEvent.change(teamBox("Winterfest"), { target: { value: US } });
    paste("Winterfest", SQ);
    await waitFor(() => expect(ids("Winterfest")).toEqual(["777", "20001", "300001"]));
    expect(request("Winterfest").value).toBe("");
    expect(teamBox("Winterfest")).toBeNull();
    expect((await create()).competitions).toEqual([{ name: "Winterfest", squadi: { competitionId: "777", divisionId: "20001", teamId: "300001" }, link: SQ }]);
  });
});

describe("a competition's link — on Dribl", () => {
  it("pasting the fixtures page link asks Dribl which match centre it is, fills in the fixtures request and reads back the draw", async () => {
    await startCreate();
    addCompetition();
    expect(paste("Competition 1", ` ${DR} `)).toBe(false);
    await waitFor(() => expect(request("Winter League").value).toBe(REQUEST));
    // A competition with no name yet takes the draw's own name for it.
    expect(field("Competition 1 name").value).toBe("Winter League");
    expect(link("Winter League").value).toBe(DR);
    expect(noteOf("Winter League")).toEqual([FOUND_ON_DRIBL, "adm-msg ok", "status"]);
    // Two plain requests, both to Dribl's API and both without cookies; our own server is not asked to read it.
    expect(asked).toEqual([
      { url: LOOKUP, opts: { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" } },
      { url: REQUEST, opts: { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" } }
    ]);
    expect(lookups).toEqual([]);
    // The team's name is left for the sync to work out, as the draw shows it.
    expect(teamBox("Winter League").value).toBe("");
    expect((await create()).competitions).toEqual([{ name: "Winter League", dribl: { url: REQUEST, team: "" }, link: DR }]);
  });

  it("typing the link and pressing Read link, or Enter, does the same, and says when it is reading", async () => {
    await startCreate();
    addCompetition("Cup");
    typeOut("Cup", DR);
    expect(asked).toEqual([]);
    let release;
    hold = new Promise((r) => { release = r; });
    fireEvent.click(readButton("Cup"));
    await waitFor(() => expect(readButton("Cup").textContent).toBe("Reading…"));
    fireEvent.keyDown(link("Cup"), { key: "Enter" });
    release();
    await waitFor(() => expect(request("Cup").value).toBe(REQUEST));
    expect(asked.map((a) => a.url)).toEqual([LOOKUP, REQUEST]);
    expect(field("Competition 1 name").value).toBe("Cup"); // a name already typed is kept
    hold = null;
    fireEvent.keyDown(link("Cup"), { key: "Enter" });
    await waitFor(() => expect(asked).toHaveLength(4));
  });

  it("when the draw has more than one of the club's teams, it asks which is ours and offers the names as Dribl spells them", async () => {
    dribl.draw = { status: 200, json: { data: TWO_TEAMS } };
    await startCreate();
    addCompetition("Cup");
    paste("Cup", DR);
    await waitFor(() => expect(noteOf("Cup")).toEqual([WHICH_IS_OURS, "adm-msg warn", "status"]));
    expect(request("Cup").value).toBe(REQUEST);
    expect(offered("Cup")).toEqual(["Riverside FC U8 Golds", "Hilltop United U8", "Riverside FC U8 Blues", "Lakeside Rovers U8"]);
    fireEvent.change(teamBox("Cup"), { target: { value: "Riverside FC U8 Golds" } });
    expect(noteUnder("Cup")).toBeNull(); // answered
    expect(offered("Cup")).toHaveLength(4); // still offered, should it need changing
    expect((await create()).competitions).toEqual([{ name: "Cup", dribl: { url: REQUEST, team: "Riverside FC U8 Golds" }, link: DR }]);
  });

  it("reads the draw for the team name already in the row, and says so when that name is not in it", async () => {
    dribl.draw = { status: 200, json: { data: TWO_TEAMS } };
    await startCreate();
    addCompetition("Cup");
    fireEvent.change(request("Cup"), { target: { value: REQUEST } });
    fireEvent.change(teamBox("Cup"), { target: { value: "Golds" } });
    paste("Cup", DR);
    await waitFor(() => expect(noteOf("Cup")).toEqual(["Riverside FC U8 Golds · Winter League · Under 8. 3 games found. They sync whenever a coach opens the team.", "adm-msg ok", "status"]));
    expect(teamBox("Cup").value).toBe("Golds"); // what was typed is kept
    fireEvent.change(teamBox("Cup"), { target: { value: "Seaside FC" } });
    fireEvent.click(readButton("Cup"));
    await waitFor(() => expect(noteOf("Cup")).toEqual(['No team called "Seaside FC" is in this Dribl draw.', "adm-msg err", "alert"]));
    expect(request("Cup").value).toBe(REQUEST);
  });

  it("takes the place of Squadi ids on the row: a competition has one source", async () => {
    await startCreate();
    addCompetition("Cup");
    fireEvent.change(field("Cup competition ID"), { target: { value: "55" } }); // left over from an earlier try
    paste("Cup", DR);
    await waitFor(() => expect(request("Cup").value).toBe(REQUEST));
    expect(ids("Cup")).toEqual(["", "", ""]);
    expect((await create()).competitions).toEqual([{ name: "Cup", dribl: { url: REQUEST, team: "" }, link: DR }]);
  });

  it("when Dribl cannot be asked, says so, keeps the link, and leaves the row's source as it was", async () => {
    dribl.centre = new TypeError("Failed to fetch");
    await startCreate();
    addCompetition("Cup");
    paste("Cup", DR);
    await waitFor(() => expect(noteOf("Cup")).toEqual([`${UNREACHABLE} ${DRIBL_BY_HAND}`, "adm-msg err", "alert"]));
    expect(request("Cup").value).toBe("");
    expect(link("Cup").value).toBe(DR);
    expect(asked.map((a) => a.url)).toEqual([LOOKUP]);
    expect((await create()).competitions).toEqual([{ name: "Cup", link: DR }]);
  });

  it("when Dribl does not name the match centre, says what it answered and how to carry on by hand", async () => {
    dribl.centre = { status: 200, json: { data: [] } };
    await startCreate();
    addCompetition("Cup");
    fireEvent.change(field("Cup competition ID"), { target: { value: "55" } });
    paste("Cup", DR);
    await waitFor(() => expect(noteUnder("Cup")?.textContent).toBe(`${NO_MATCH_CENTRE} Its answer has: data. ${DRIBL_BY_HAND}`));
    expect(asked.map((a) => a.url)).toEqual([LOOKUP, "https://mc-api.dribl.com/api/tenants?slug=winterleague"]);
    expect(ids("Cup")).toEqual(["55", "", ""]); // nothing was found, so nothing was replaced
    expect(request("Cup").value).toBe("");
  });

  it("fills the request in even when its draw could not be read, and says why", async () => {
    dribl.draw = { status: 503, json: {} };
    await startCreate();
    addCompetition("Cup");
    paste("Cup", DR);
    await waitFor(() => expect(noteOf("Cup")).toEqual(["The fixtures request is filled in, but Dribl did not give its draw: Dribl responded 503", "adm-msg err", "alert"]));
    expect(request("Cup").value).toBe(REQUEST);
    expect(offered("Cup")).toBeNull();
  });

  it("says when the draw is not published yet", async () => {
    dribl.draw = { status: 200, json: { data: [] } };
    await startCreate();
    addCompetition("Cup");
    paste("Cup", DR);
    await waitFor(() => expect(noteOf("Cup")).toEqual(["The fixtures request is filled in. Dribl lists no games in this draw yet. Once it does, they sync whenever a coach opens the team.", "adm-msg warn", "status"]));
    expect(request("Cup").value).toBe(REQUEST);
    expect(field("Competition 1 name").value).toBe("Cup");
  });

  it("a Dribl page that names no competition is said so, and Dribl is asked nothing", async () => {
    await startCreate();
    addCompetition("Cup");
    paste("Cup", "https://winterleague.dribl.com/fixtures?date_range=all");
    expect(noteOf("Cup")).toEqual([DRIBL_NEEDS_COMPETITION, "adm-msg warn", "status"]);
    expect(asked).toEqual([]);
  });

  it("the page link put in the request box by mistake is moved to the link box and read there, pasted or not", async () => {
    await startCreate();
    addCompetition("Cup");
    // Pasted over nothing.
    expect(fireEvent.paste(request("Cup"), { clipboardData: { getData: () => ` ${DR}\n` } })).toBe(false);
    await waitFor(() => expect(request("Cup").value).toBe(REQUEST));
    expect(link("Cup").value).toBe(DR);
    expect(noteUnder("Cup").textContent).toBe(FOUND_ON_DRIBL);
    expect(asked.map((a) => a.url)).toEqual([LOOKUP, REQUEST]);
    // Put in whole without a paste, over the request that is there: the request is replaced by the one the link gives.
    const DR2 = DR.replace("league=ZyXwVu5678", "league=OtHeR12345");
    fireEvent.change(request("Cup"), { target: { value: DR2 } });
    await waitFor(() => expect(request("Cup").value).toBe(REQUEST.replace("league=ZyXwVu5678", "league=OtHeR12345")));
    expect(link("Cup").value).toBe(DR2);
    // A request pasted there is left exactly where it is, and so is anything that is not a whole page link.
    expect(fireEvent.paste(request("Cup"), { clipboardData: { getData: () => REQUEST } })).toBe(true);
    fireEvent.change(request("Cup"), { target: { value: "https://winterleague.dribl.com/fixtures?date_range=all" } });
    expect(request("Cup").value).toBe("https://winterleague.dribl.com/fixtures?date_range=all");
    expect(link("Cup").value).toBe(DR2);
    expect(asked).toHaveLength(4);
  });

  it("typing the request in by hand puts away what the link was read as, the offered names with it", async () => {
    dribl.draw = { status: 200, json: { data: TWO_TEAMS } };
    await startCreate();
    addCompetition("Cup");
    paste("Cup", DR);
    await waitFor(() => expect(offered("Cup")).toHaveLength(4));
    const byHand = REQUEST.replace("league=ZyXwVu5678", "league=OtHeR12345");
    fireEvent.change(request("Cup"), { target: { value: byHand } });
    expect(noteUnder("Cup")).toBeNull();
    expect(offered("Cup")).toBeNull();
    expect((await create()).competitions).toEqual([{ name: "Cup", dribl: { url: byHand, team: "" }, link: DR }]);
  });

  it("an answer that comes back after the link was changed is not written over the row", async () => {
    await startCreate();
    addCompetition("Cup");
    let release;
    hold = new Promise((r) => { release = r; });
    paste("Cup", DR);
    await waitFor(() => expect(asked).toHaveLength(1));
    const another = DR.replace("Brisbane", "Sydney"); // a small edit, as if typed
    type("Cup", another);
    expect(readButton("Cup").textContent).toBe("Read link"); // not left reading for ever
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(request("Cup").value).toBe("");
    expect(link("Cup").value).toBe(another);
    expect(noteUnder("Cup")).toBeNull();
    expect(readButton("Cup").disabled).toBe(false);
  });

  it("a save pressed while Dribl is still answering waits for it", async () => {
    await startCreate();
    addCompetition("Cup");
    let release;
    hold = new Promise((r) => { release = r; });
    paste("Cup", DR);
    await waitFor(() => expect(readButton("Cup").textContent).toBe("Reading…"));
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText(LINK_BEING_READ)).toBeTruthy();
    expect(saves).toEqual([]);
    release();
    await waitFor(() => expect(request("Cup").value).toBe(REQUEST));
    expect((await create()).competitions).toEqual([{ name: "Cup", dribl: { url: REQUEST, team: "" }, link: DR }]);
  });
});

describe("a team that was set up from links", () => {
  it("shows them again on Edit, and opening the form asks nobody anything", async () => {
    await startEdit();
    expect(link("Squadi").value).toBe(SQ);
    expect(ids("Squadi")).toEqual(["777", "20001", "300001"]);
    expect(link("Winter League").value).toBe(DR);
    expect(request("Winter League").value).toBe(REQUEST);
    expect(teamBox("Winter League").value).toBe(US);
    expect(offered("Winter League")).toBeNull(); // names are only offered once a draw has been read
    expect([noteUnder("Squadi"), noteUnder("Winter League")]).toEqual([null, null]);
    expect(readButton("Squadi").textContent).toBe("Read link");
    expect(readButton("Winter League").textContent).toBe("Read link");
    expect([lookups, asked]).toEqual([[], []]);
  });

  it("saving without touching them sends them back as they were, and nothing of what a read showed", async () => {
    await startEdit();
    fireEvent.click(readButton("Winter League"));
    await waitFor(() => expect(noteUnder("Winter League")?.textContent).toBe(FOUND_ON_DRIBL));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].method).toBe("PATCH");
    expect(saves[0].body.squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: 300001, link: SQ });
    expect(saves[0].body.competitions).toEqual([{ id: "cdribl001", name: "Winter League", dribl: { url: REQUEST, team: US }, link: DR }]);
    expect(JSON.stringify(saves[0].body)).not.toMatch(/"note"|"teams"|games found/);
  });
});

describe("arrived — how much text one change to a box brought", () => {
  it("is a character for a letter typed, and the whole of a link pasted into an empty box", () => {
    expect(arrived("", "h")).toBe(1);
    expect(arrived("https://a.dribl.co", "https://a.dribl.com")).toBe(1);
    expect(arrived("", SQ)).toBe(SQ.length);
  });

  it("is only what is new when text is put into the middle, or replaces part of what was there", () => {
    expect(arrived("abcdef", "abcXYZdef")).toBe(3);
    expect(arrived("abc123def", "abcXYZ98def")).toBe(5);
    expect(arrived("teamId=300001", "teamId=300009")).toBe(1);
  });

  it("is nothing when text is taken away or nothing changed, and the new link when one replaces another", () => {
    expect(arrived("abcdef", "abc")).toBe(0);
    expect(arrived("abcdef", "abef")).toBe(0);
    expect(arrived(SQ, SQ)).toBe(0);
    expect(arrived("", "")).toBe(0);
    expect(arrived(DR, SQ)).toBeGreaterThan(40);
  });
});
