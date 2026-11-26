// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import TeamWizard, { DRIBL_IN_SEASON, LINK_NOT_READ } from "@/components/TeamWizard";
import { NOT_A_FEED_LINK, SQUADI_NEEDS_TEAM, DRIBL_NOT_SYNCED } from "@/lib/feedLinks";

// The Competitions step of the team wizard: a draw is set up by pasting the
// address of the team's fixtures page. A Squadi link is looked up through
// /api/feed-link and fills in the three ids, with what it found read back; a
// Dribl link is kept with its competition and said not to sync. The link
// reader is real; /api/teams and /api/feed-link are stood in for. Every key,
// id and name is made up.

const KEY = "11111111-2222-4333-8444-555555555555";
const SQ = `https://registration.squadi.com/liveScoreSeasonFixture?organisationKey=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&yearId=8&competitionUniqueKey=${KEY}&divisionId=20001&teamId=300001`;
const DR = "https://winterleague.dribl.com/fixtures?date_range=all&season=AbCdEf1234&competition=1pQrStUv90&league=ZyXwVu5678&club=MnOpQr2468&timezone=Australia%2FBrisbane";
const FOUND = {
  ok: true, provider: "squadi", link: SQ, squadi: { competitionId: "777", divisionId: "20001", teamId: 300001 },
  found: { competition: "Metro | Winter League", division: "Under 8 Blues K1", team: "Riverside FC U8 Blues", games: 14 }
};
const READ_BACK = "Riverside FC U8 Blues · Under 8 Blues K1 · Metro | Winter League. 14 games found. They sync by themselves.";
const SAVED = {
  slug: "u8-blues", name: "Riverside FC U8 Blues", ageGroup: "U8", password: "blue-kanga-42", calendarKey: "abc123", coachEmails: [], source: "stored",
  squadi: { competitionId: "777", divisionId: "20001", teamId: 300001, link: SQ },
  competitions: [{ id: "cdribl001", name: "Winter League", dribl: { link: DR, site: "winterleague", season: "AbCdEf1234", competition: "1pQrStUv90", league: "ZyXwVu5678", club: "MnOpQr2468" } }]
};

let teams;
let saves;      // bodies sent to /api/teams (POST or PATCH)
let lookups;    // links sent to /api/feed-link
let lookup;     // what /api/feed-link answers: { ok, status, json } or a function of the link
let hold;       // a promise /api/feed-link waits on before answering
beforeEach(() => {
  teams = [SAVED];
  saves = []; lookups = []; hold = null;
  lookup = { ok: true, status: 200, json: FOUND };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
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
const paste = (label, text) => fireEvent.paste(field(label), { clipboardData: { getData: () => text } });
const ids = (who) => ["competition ID", "division ID", "team ID"].map((k) => field(`${who} ${k}`).value);
const readButton = (label) => field(label).closest(".adm-line").querySelector("button");
const noteUnder = (label) => field(label).closest(".adm-line").nextElementSibling;
const addCompetition = () => fireEvent.click(step().getByRole("button", { name: "Add a competition" }));
const create = async () => { fireEvent.click(screen.getByRole("button", { name: "Create team" })); await waitFor(() => expect(saves).toHaveLength(1)); return saves[0].body; };

describe("the season's fixtures link", () => {
  it("pasting a Squadi link looks it up, fills in the three ids and reads back what it found; saving keeps the link with them", async () => {
    await startCreate();
    expect(field("Squadi fixtures link").getAttribute("placeholder")).toBe("Paste your team's Squadi fixtures link");
    paste("Squadi fixtures link", `  ${SQ}\n`);
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect(lookups).toEqual([SQ]); // the link as read, without the stray space
    expect(field("Squadi fixtures link").value).toBe(SQ);
    const note = noteUnder("Squadi fixtures link");
    expect(note.textContent).toBe(READ_BACK);
    expect([note.className, note.getAttribute("role")]).toEqual(["adm-msg ok", "status"]);
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ });
  });

  it("typing the link and pressing Read link, or Enter, does the same; the button waits for a link and says when it is reading", async () => {
    await startCreate();
    expect(readButton("Squadi fixtures link").disabled).toBe(true);
    fireEvent.change(field("Squadi fixtures link"), { target: { value: SQ } });
    expect(lookups).toEqual([]); // typing alone asks nothing
    let release;
    hold = new Promise((r) => { release = r; });
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(readButton("Squadi fixtures link").textContent).toBe("Reading…"));
    expect(readButton("Squadi fixtures link").disabled).toBe(true);
    fireEvent.keyDown(field("Squadi fixtures link"), { key: "Enter" }); // not asked twice while one is on its way
    release();
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect(readButton("Squadi fixtures link").textContent).toBe("Read link");
    expect(lookups).toEqual([SQ]);
    hold = null;
    fireEvent.keyDown(field("Squadi fixtures link"), { key: "Enter" });
    await waitFor(() => expect(lookups).toEqual([SQ, SQ]));
  });

  it("something that is not a team's link is said so under the field, and Squadi is not asked", async () => {
    await startCreate();
    for (const [text, sentence] of [["https://example.com/fixtures", NOT_A_FEED_LINK], ["just some words", NOT_A_FEED_LINK], [SQ.replace("&teamId=300001", ""), SQUADI_NEEDS_TEAM], [DR, DRIBL_IN_SEASON]]) {
      paste("Squadi fixtures link", text);
      const note = noteUnder("Squadi fixtures link");
      expect(note.textContent).toBe(sentence);
      expect([note.className, note.getAttribute("role")]).toEqual(["adm-msg err", "alert"]);
    }
    expect(lookups).toEqual([]);
    expect(ids("Squadi")).toEqual(["", "", ""]);
    // Nothing from a refused link is saved.
    expect("squadi" in (await create())).toBe(false);
  });

  it("what Squadi could not tell us is shown as it was said, and the ids are left alone", async () => {
    await startCreate();
    fireEvent.change(field("Squadi competition ID"), { target: { value: "55" } });
    lookup = { ok: false, status: 400, json: { error: "Squadi did not recognise the competition in that link." } };
    paste("Squadi fixtures link", SQ);
    await waitFor(() => expect(noteUnder("Squadi fixtures link")?.textContent).toBe("Squadi did not recognise the competition in that link."));
    expect(noteUnder("Squadi fixtures link").getAttribute("role")).toBe("alert");
    expect(ids("Squadi")).toEqual(["55", "", ""]);
    lookup = new Error("network down");
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(noteUnder("Squadi fixtures link").textContent).toBe("network down"));
    lookup = { ok: true, status: 200, json: { ok: true } }; // an answer with no ids in it is not trusted
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(noteUnder("Squadi fixtures link").textContent).toBe("Couldn't read that link. Try again."));
    expect(ids("Squadi")).toEqual(["55", "", ""]);
  });

  it("says so when no games are out yet, or when the draw could not be read", async () => {
    await startCreate();
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, team: "", games: 0 } } };
    paste("Squadi fixtures link", SQ);
    await waitFor(() => expect(noteUnder("Squadi fixtures link")?.textContent).toBe(
      "Under 8 Blues K1 · Metro | Winter League. No games are published for this team yet. They sync by themselves once they are. If that is not right, check the link is your team's."));
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, team: "", games: null } } };
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(noteUnder("Squadi fixtures link").textContent).toBe(
      "Under 8 Blues K1 · Metro | Winter League. The draw could not be read just now, but the link is good. Its games sync by themselves."));
    lookup = { ok: true, status: 200, json: { ...FOUND, found: { ...FOUND.found, games: 1 } } };
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(noteUnder("Squadi fixtures link").textContent).toMatch(/\. 1 game found\. They sync by themselves\.$/));
  });

  it("an id changed by hand is no longer what the link said: the read-back goes, and the link is not saved beside ids it does not match", async () => {
    await startCreate();
    paste("Squadi fixtures link", SQ);
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    fireEvent.change(field("Squadi team ID"), { target: { value: "300002" } });
    expect(field("Squadi fixtures link").closest(".adm-line").nextElementSibling.className).not.toContain("adm-msg");
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300002" });
  });

  it("a link typed in and never read is not quietly dropped: saving waits until it has been read", async () => {
    await startCreate();
    fireEvent.change(field("Squadi fixtures link"), { target: { value: SQ } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText(LINK_NOT_READ)).toBeTruthy();
    expect(saves).toEqual([]);
    fireEvent.click(readButton("Squadi fixtures link"));
    await waitFor(() => expect(ids("Squadi")).toEqual(["777", "20001", "300001"]));
    expect((await create()).squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ });
    // The same goes for a competition's; a Dribl link needs no reading, and neither do ids typed by hand.
    cleanup(); saves = [];
    await startCreate();
    addCompetition();
    fireEvent.change(field("Competition 1 fixtures link"), { target: { value: SQ } });
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText(LINK_NOT_READ)).toBeTruthy();
    expect(saves).toEqual([]);
    fireEvent.change(field("Competition 1 fixtures link"), { target: { value: DR } });
    fireEvent.change(field("Squadi competition ID"), { target: { value: "55" } });
    const body = await create();
    expect(body.competitions).toEqual([{ name: "", dribl: { link: DR } }]);
    expect(body.squadi).toEqual({ competitionId: "55", divisionId: "", teamId: "" });
  });

  it("each of two teams has its own link", async () => {
    await startCreate();
    fireEvent.click(step().getByRole("button", { name: "Add a second team" }));
    const SQ2 = SQ.replace("divisionId=20001", "divisionId=20002").replace("teamId=300001", "teamId=300002");
    lookup = (link) => ({ ok: true, status: 200, json: link === SQ ? FOUND : { ...FOUND, link: SQ2, squadi: { competitionId: "777", divisionId: "20002", teamId: 300002 } } });
    paste("Squadi fixtures link", SQ);
    paste("Second Squadi fixtures link", SQ2);
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
    paste("Squadi fixtures link", SQ);
    await waitFor(() => expect(lookups).toEqual([SQ]));
    fireEvent.change(field("Squadi fixtures link"), { target: { value: "" } }); // cleared while Squadi was answering
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(ids("Squadi")).toEqual(["", "", ""]);
    expect(field("Squadi fixtures link").value).toBe("");
  });
});

describe("a competition's fixtures link", () => {
  it("a Squadi link fills in its ids and, when it has no name yet, takes Squadi's name for the competition", async () => {
    await startCreate();
    addCompetition();
    expect(field("Competition 1 fixtures link").getAttribute("placeholder")).toBe("Paste the team's fixtures link (Squadi or Dribl)");
    paste("Competition 1 fixtures link", SQ);
    await waitFor(() => expect(field("Competition 1 name").value).toBe("Metro | Winter League"));
    expect(ids("Metro | Winter League")).toEqual(["777", "20001", "300001"]);
    expect(noteUnder("Metro | Winter League fixtures link").textContent).toBe(READ_BACK);
    expect((await create()).competitions).toEqual([{ name: "Metro | Winter League", squadi: { competitionId: "777", divisionId: "20001", teamId: "300001", link: SQ } }]);
  });

  it("a name already typed is kept", async () => {
    await startCreate();
    addCompetition();
    fireEvent.change(field("Competition 1 name"), { target: { value: "Winterfest" } });
    paste("Winterfest fixtures link", SQ);
    await waitFor(() => expect(ids("Winterfest")).toEqual(["777", "20001", "300001"]));
    expect(field("Competition 1 name").value).toBe("Winterfest");
  });

  it("a Dribl link is kept without asking anyone anything, says plainly that it is not synced, and puts the Squadi boxes away", async () => {
    await startCreate();
    addCompetition();
    fireEvent.change(field("Competition 1 name"), { target: { value: "Premier Invitational" } });
    fireEvent.change(field("Premier Invitational competition ID"), { target: { value: "55" } }); // left over from an earlier try
    paste("Premier Invitational fixtures link", DR);
    const note = noteUnder("Premier Invitational fixtures link");
    expect(note.textContent).toBe(DRIBL_NOT_SYNCED);
    expect([note.className, note.getAttribute("role")]).toEqual(["adm-msg warn", "status"]);
    expect(lookups).toEqual([]);
    expect(step().queryByLabelText("Premier Invitational competition ID")).toBeNull();
    expect(step().queryByLabelText("Premier Invitational team ID")).toBeNull();
    // Taking the link away brings the boxes back empty: the stray id went when the Dribl link came.
    fireEvent.change(field("Premier Invitational fixtures link"), { target: { value: "" } });
    expect(ids("Premier Invitational")).toEqual(["", "", ""]);
    paste("Premier Invitational fixtures link", DR);
    // Saved as the link alone: the server reads what it names.
    expect((await create()).competitions).toEqual([{ name: "Premier Invitational", dribl: { link: DR } }]);
  });

  it("a Dribl row with no name is still kept; swapping its link for a Squadi one brings the boxes back", async () => {
    await startCreate();
    addCompetition();
    paste("Competition 1 fixtures link", DR);
    expect(step().queryByLabelText("Competition 1 competition ID")).toBeNull();
    paste("Competition 1 fixtures link", SQ);
    await waitFor(() => expect(ids("Metro | Winter League")).toEqual(["777", "20001", "300001"]));
    fireEvent.change(field("Competition 1 name"), { target: { value: "" } });
    paste("Competition 1 fixtures link", DR);
    expect((await create()).competitions).toEqual([{ name: "", dribl: { link: DR } }]);
  });
});

describe("a team that was set up from links", () => {
  it("shows them again on Edit: the season's link in its field, the Dribl competition with its note and no Squadi boxes", async () => {
    await startEdit();
    expect(field("Squadi fixtures link").value).toBe(SQ);
    expect(ids("Squadi")).toEqual(["777", "20001", "300001"]);
    expect(field("Winter League fixtures link").value).toBe(DR);
    expect(noteUnder("Winter League fixtures link").textContent).toBe(DRIBL_NOT_SYNCED);
    expect(step().queryByLabelText("Winter League competition ID")).toBeNull();
    expect(lookups).toEqual([]); // opening a team asks Squadi nothing
  });

  it("saving without touching them sends them back as they were; clearing a link takes it away", async () => {
    await startEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].method).toBe("PATCH");
    expect(saves[0].body.squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: 300001, link: SQ });
    expect(saves[0].body.competitions).toEqual([{ id: "cdribl001", name: "Winter League", dribl: { link: DR } }]);
    cleanup();
    saves = [];
    await startEdit();
    fireEvent.change(field("Squadi fixtures link"), { target: { value: "" } });
    fireEvent.change(field("Winter League fixtures link"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body.squadi).toEqual({ competitionId: "777", divisionId: "20001", teamId: 300001 });
    expect(saves[0].body.competitions).toEqual([{ id: "cdribl001", name: "Winter League" }]); // the competition stays, without a draw
  });
});
