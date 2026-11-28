// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

// The super admin's Logos section (components/ClubLogos.jsx): the counts, the
// teams still without a logo, the logos found (with Hide), the built-in crests
// by club, and Find missing logos, which asks the server to read Squadi again
// and reads Dribl in this browser; and the club editor, which links any club
// to its website, picks or changes its logo and sizes it in its circle.
// /api/club-logos and Dribl are stand-ins. Every name, number and address
// here is made up.
const { fetchDribl, fetchDriblClubs } = vi.hoisted(() => ({ fetchDribl: vi.fn(), fetchDriblClubs: vi.fn() }));
vi.mock("@/lib/dribl", async (actual) => ({ ...(await actual()), fetchDribl, fetchDriblClubs }));
import ClubLogos from "@/components/ClubLogos";

const FOUND = "https://cdn.dribl.com/clubs/zebras.png";
const REQUEST = "https://mc-api.dribl.com/api/fixtures?date_range=all&league=L1&tenant=T1&timezone=Australia%2FBrisbane";
const report = (over = {}) => ({
  counts: { opponents: 4, builtIn: 1, found: 2, missing: 1, hidden: 0, newClubs: 1, newLogos: 1, duplicatesAvoided: 1 },
  opponents: [
    { ref: "squadi:team:500005", name: "Lions FC U10 Blue", provider: "squadi", shown: "built-in" },
    { ref: "dribl:team:T1", name: "Zebras FC", provider: "dribl", shown: "found", club: "dribl:club:C1", kind: "club", from: "Dribl", logo: FOUND },
    { ref: "dribl:team:T2", name: "Zebras Academy", provider: "dribl", shown: "found", club: "dribl:club:C1", kind: "team", from: "Dribl", logo: "https://cdn.dribl.com/teams/academy.png" },
    { ref: "squadi:team:500009", name: "Seaside FC U10", provider: "squadi", shown: "missing" }
  ],
  dribl: [{ team: "u10", teamName: "Under 10s", comp: "cinv", name: "Invitational", url: REQUEST, ourTeam: "Us FC" }, { team: "u9", teamName: "Under 9s", comp: "cinv9", name: "Invitational", url: REQUEST.replace("L1", "L2"), ourTeam: "Us FC U9" }],
  hosts: [],
  ...over
});

let posts, answer;
beforeEach(() => {
  posts = [];
  answer = (body) => report();
  fetchDribl.mockResolvedValue([{ squadiId: "dribl:g1", opponent: "Zebras FC" }]);
  fetchDriblClubs.mockResolvedValue({ clubs: [{ id: "C1", name: "Zebras FC", logo: FOUND }], fields: ["name", "logo"] });
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    if (!String(url).startsWith("/api/club-logos")) throw new Error("unexpected " + url);
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push(body);
      const j = body.action === "refresh" ? { ...report(), read: 3, failed: 1, saved: true } : answer(body);
      return { ok: true, status: 200, json: async () => j };
    }
    return { ok: true, status: 200, json: async () => report() };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete Element.prototype.scrollIntoView; });

const card = (title) => screen.getByRole("heading", { name: title }).closest(".adm-card");

describe("ClubLogos", () => {
  it("counts what is shown for the opposition, and lists the teams still without a logo and the logos found", async () => {
    render(<ClubLogos />);
    await screen.findByRole("heading", { name: "Opposition logos" });
    expect(card("Opposition logos").textContent).toContain("4 opposition teams: 1 with a built-in crest, 2 with a logo found on Squadi or Dribl, 1 still without one.");
    expect(card("Opposition logos").textContent).toContain("1 club found that the built-in crests do not cover, with 1 logo between them. 1 team name matched to a club already known instead of becoming a new club.");
    expect(within(card("Still without a logo")).getByText("Seaside FC U10")).toBeTruthy();
    expect(card("Still without a logo").querySelector(".adm-crest.ph").textContent).toBe("SF");
    const found = card("Logos found");
    const img = found.querySelector("img.adm-crest.drawn");
    expect([img.getAttribute("src"), img.getAttribute("referrerpolicy")]).toEqual([FOUND, "no-referrer"]);
    expect(found.textContent).toContain("Club logo from Dribl");
    expect(found.textContent).toContain("The team's own logo from Dribl");
  });

  it("Find missing logos asks the server to read Squadi again, then reads each Dribl draw here, and each match centre's club list once", async () => {
    render(<ClubLogos />);
    fireEvent.click(await screen.findByRole("button", { name: "Find missing logos" }));
    await screen.findByText("Squadi: 3 draws read, 1 could not be. Dribl: 2 draws read, and a club list of 1 club.");
    expect(posts[0]).toEqual({ action: "refresh" });
    expect(fetchDribl.mock.calls.map((c) => c[0])).toEqual([{ url: REQUEST, team: "Us FC" }, { url: REQUEST.replace("L1", "L2"), team: "Us FC U9" }]);
    expect(fetchDriblClubs).toHaveBeenCalledTimes(1);
    expect(posts[1]).toEqual({ action: "dribl", draws: [{ records: [{ squadiId: "dribl:g1", opponent: "Zebras FC" }] }, { records: [{ squadiId: "dribl:g1", opponent: "Zebras FC" }] }], clubs: [{ id: "C1", name: "Zebras FC", logo: FOUND }] });
  });

  it("says how many Dribl draws could not be read, and posts nothing when none could", async () => {
    fetchDribl.mockRejectedValue(new Error("Dribl could not be reached from this browser."));
    fetchDriblClubs.mockRejectedValue(new Error("Dribl could not be reached from this browser."));
    render(<ClubLogos />);
    fireEvent.click(await screen.findByRole("button", { name: "Find missing logos" }));
    await screen.findByText("Squadi: 3 draws read, 1 could not be. Dribl: 0 draws read, 2 could not be.");
    expect(posts.map((p) => p.action)).toEqual(["refresh"]);
  });

  it("hides a club's logo on the club, and a team's own on the team", async () => {
    render(<ClubLogos />);
    await screen.findByRole("heading", { name: "Logos found" });
    const [clubHide, teamHide] = within(card("Logos found")).getAllByRole("button", { name: "Hide" });
    fireEvent.click(clubHide);
    await waitFor(() => expect(posts).toHaveLength(1));
    fireEvent.click(teamHide);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts).toEqual([
      { action: "hide", ref: "dribl:team:T1", club: "dribl:club:C1", kind: "club" },
      { action: "hide", ref: "dribl:team:T2", club: "dribl:club:C1", kind: "team" }
    ]);
  });

  it("lists what is hidden, with Show, and the built-in crests folded away", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      if (init.method === "POST") { posts.push(JSON.parse(init.body)); return { ok: true, json: async () => report() }; }
      return { ok: true, json: async () => report({ opponents: [...report().opponents.slice(0, 1), { ref: "squadi:team:500009", name: "Seaside FC U10", provider: "squadi", shown: "hidden", club: "squadi:org:41" }] }) };
    }));
    render(<ClubLogos />);
    const hidden = (await screen.findByRole("heading", { name: "Hidden" })).closest(".adm-card");
    expect(hidden.textContent).toContain("Hidden: the initials are shown");
    fireEvent.click(within(hidden).getByRole("button", { name: "Show" }));
    await waitFor(() => expect(posts).toEqual([{ action: "show", ref: "squadi:team:500009", club: "squadi:org:41" }]));
    const fold = screen.getByText("Built-in crests").closest("details");
    expect(fold.querySelector("img.adm-crest").getAttribute("src")).toBe("/crests/lions-fc.png");
  });

  it("lists the built-in crests one row per club, with its teams", async () => {
    const oxley = (ref, name) => ({ ref, name, provider: "squadi", shown: "built-in", club: "built-in:/crests/oxley-united.png" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => report({ opponents: [
      oxley("squadi:team:1", "Oxley United U10 Blue"), oxley("squadi:team:2", "Oxley United U9 Gold"), oxley("squadi:team:3", "Oxley United U11"), oxley("squadi:team:4", "Oxley United U12 Navy"),
      { ref: "squadi:team:5", name: "Springfield United U10", provider: "squadi", shown: "built-in", club: "built-in:/crests/springfield-united.png" }
    ] }) })));
    render(<ClubLogos />);
    const fold = (await screen.findByText("Built-in crests")).closest("details");
    expect(fold.querySelector("summary .hint").textContent).toBe("2 clubs");
    const rows = [...fold.querySelectorAll(".adm-row")];
    expect(rows.map((r) => r.querySelector("img").getAttribute("src"))).toEqual(["/crests/oxley-united.png", "/crests/springfield-united.png"]);
    expect(rows.map((r) => r.querySelector(".adm-row-main").firstChild.textContent)).toEqual(["Oxley United FC", "Springfield United FC"]);
    expect(rows.map((r) => r.querySelector(".adm-row-sub").textContent)).toEqual([
      "4 teams: Oxley United U10 Blue, Oxley United U9 Gold and Oxley United U11 and 1 more",
      "1 team: Springfield United U10"
    ]);
    expect(rows.map((r) => within(r).getAllByRole("button").map((b) => b.textContent))).toEqual([["Change logo"], ["Change logo"]]);
  });

  it("says what went wrong when the library cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) })));
    render(<ClubLogos />);
    expect((await screen.findByRole("alert")).textContent).toBe("forbidden");
  });
});

describe("ClubLogos — adding a club's logo from its own website", () => {
  const SITE_LOGO = "https://seaside.example/img/crest.png";
  const ICON = "https://seaside.example/apple-180.png";
  // Two teams of the club still without a logo, and one of another club.
  const missing = [
    { ref: "squadi:team:500009", name: "Seaside FC U10", provider: "squadi", shown: "missing" },
    { ref: "squadi:team:500010", name: "Seaside FC Academy U11", provider: "squadi", shown: "missing" },
    { ref: "squadi:team:500011", name: "Seaside Rovers U10", provider: "squadi", shown: "missing" }
  ];
  // A team the built-in crests cover is counted too: a logo chosen for its
  // club comes before the built-in crest (a club can change its logo).
  const builtIn = { ref: "squadi:team:500012", name: "Seaside FC Oxley United Juniors", provider: "squadi", shown: "built-in" };
  const withMissing = (over = {}) => report({ opponents: [...report().opponents.filter((o) => o.shown !== "missing"), builtIn, ...missing], ...over });
  const added = withMissing({
    counts: { ...report().counts, added: 2, missing: 1 },
    opponents: [...report().opponents.filter((o) => o.shown !== "missing"), { ...missing[0], shown: "added", named: "seaside-fc", logo: SITE_LOGO }, { ...missing[1], shown: "added", named: "seaside-fc", logo: SITE_LOGO }, missing[2]],
    named: [{ key: "seaside-fc", name: "Seaside FC", logo: SITE_LOGO, site: "https://seaside.example/", teams: 2 }]
  });

  let scrolled;
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (o) { scrolled.push([this, o]); };
    fetch.mockImplementation(async (url, init = {}) => {
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        posts.push(body);
        if (body.action === "site") {
          return body.url === "nowhere.example"
            ? { ok: false, status: 422, json: async () => ({ error: "That site couldn't be found. Check the link." }) }
            : { ok: true, status: 200, json: async () => ({ ok: true, site: "https://seaside.example/", candidates: [{ url: SITE_LOGO, kind: "logo" }, { url: ICON, kind: "site icon" }] }) };
        }
        if (body.action === "club") return { ok: true, status: 200, json: async () => ({ ok: true, key: "seaside-fc", ...added }) };
        if (body.action === "unclub") return { ok: true, status: 200, json: async () => ({ ok: true, ...withMissing({ named: [] }) }) };
      }
      return { ok: true, status: 200, json: async () => withMissing() };
    });
  });

  const openAdd = async (teamName) => {
    render(<ClubLogos />);
    const missingCard = await waitFor(() => card("Still without a logo"));
    const row = within(missingCard).getByText(teamName).closest(".adm-row");
    fireEvent.click(within(row).getByRole("button", { name: "Add club logo" }));
    return row;
  };

  it("guesses the club from the team's name and says which teams it covers before anything is saved", async () => {
    const row = await openAdd("Seaside FC Academy U11");
    expect(within(row).getByLabelText("Club").value).toBe("Seaside FC");
    expect(within(row).getByRole("status").textContent).toBe('Covers 3 teams: Seaside FC Oxley United Juniors, Seaside FC U10 and Seaside FC Academy U11. Every team whose name has the words "seaside" and "fc" gets this logo, the ones still to come too.');
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "Seaside Rovers" } });
    expect(within(row).getByRole("status").textContent).toMatch(/^Covers 1 team: Seaside Rovers U10\./);
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "FC" } });
    expect(within(row).getByRole("status").textContent).toBe("No opposition team's name has all of these words. Shorten the club's name to the words its teams share.");
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "Coastal" } });
    expect(within(row).getByRole("status").textContent).toBe("No opposition team's name has all of these words. Shorten the club's name to the words its teams share.");
    expect(posts).toEqual([]);
  });

  it("reads the club's website, offers what it found, and saves the one picked for the club", async () => {
    const row = await openAdd("Seaside FC U10");
    const save = () => within(row).getByRole("button", { name: "Use this logo for Seaside FC" });
    expect(save().disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText("Club website or logo link"), { target: { value: "seaside.example" } });
    fireEvent.click(within(row).getByRole("button", { name: "Find logos" }));
    const picks = await within(row).findByRole("group", { name: "Logos found on the club's site" });
    const buttons = within(picks).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Logo 1 of 2: a logo", "Logo 2 of 2: the site's icon"]);
    expect([...picks.querySelectorAll("img")].map((i) => [i.getAttribute("src"), i.getAttribute("referrerpolicy")])).toEqual([[SITE_LOGO, "no-referrer"], [ICON, "no-referrer"]]);
    expect(posts).toEqual([{ action: "site", url: "seaside.example" }]);
    fireEvent.click(buttons[0]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(save().disabled).toBe(false);
    // A name no team has can't be saved, logo or not.
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "Coastal" } });
    expect(within(row).getByRole("button", { name: "Use this logo for Coastal" }).disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "Seaside FC" } });
    fireEvent.click(save());
    await waitFor(() => expect(posts.at(-1)).toEqual({ action: "club", name: "Seaside FC", logo: SITE_LOGO, site: "https://seaside.example/", fill: 1 }));
    // The club is listed as chosen, its teams have left the missing list, and the editor has closed.
    const addedCard = await waitFor(() => card("Logos you chose"));
    expect(within(addedCard).getByText("Seaside FC")).toBeTruthy();
    expect(addedCard.querySelector(".adm-row-sub").textContent).toBe("From seaside.example, shown for 2 teams");
    expect(within(card("Still without a logo")).queryByText("Seaside FC U10")).toBeNull();
    // The count is the server's, said where the club now is, and brought into view.
    expect(within(addedCard).getByRole("status").textContent).toBe("Seaside FC saved: its logo now shows for 2 teams.");
    expect(scrolled).toEqual([[addedCard, { block: "start" }]]);
    expect(card("Opposition logos").textContent).toContain("2 with a logo you chose");
  });

  it("drops an image that won't load, and says what went wrong with a link", async () => {
    const row = await openAdd("Seaside FC U10");
    fireEvent.change(within(row).getByLabelText("Club website or logo link"), { target: { value: "nowhere.example" } });
    fireEvent.click(within(row).getByRole("button", { name: "Find logos" }));
    expect((await within(row).findByRole("alert")).textContent).toBe("That site couldn't be found. Check the link.");
    fireEvent.change(within(row).getByLabelText("Club website or logo link"), { target: { value: "seaside.example" } });
    fireEvent.click(within(row).getByRole("button", { name: "Find logos" }));
    const picks = await within(row).findByRole("group", { name: "Logos found on the club's site" });
    fireEvent.error(picks.querySelectorAll("img")[1]);
    expect(within(picks).getAllByRole("button")).toHaveLength(1);
    fireEvent.error(picks.querySelector("img"));
    expect(await within(row).findByText("None of the images on that page would load. Paste a link to the logo image itself.")).toBeTruthy();
  });

  it("takes an added club out again", async () => {
    fetch.mockImplementation(async (url, init = {}) => {
      if (init.method === "POST") { posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => withMissing({ named: [] }) }; }
      return { ok: true, status: 200, json: async () => added };
    });
    render(<ClubLogos />);
    const addedCard = await waitFor(() => card("Logos you chose"));
    fireEvent.click(within(addedCard).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(posts).toEqual([{ action: "unclub", key: "seaside-fc" }]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Logos you chose" })).toBeNull());
    expect(screen.getByText("Seaside FC taken out: its teams are back to the built-in crest or what the draws show.")).toBeTruthy();
  });
});

describe("ClubLogos — changing any club's logo, and its size in the circle", () => {
  const CHOSEN = "https://seaside.example/img/crest.png";
  const NEW = "https://seaside.example/img/crest-2027.png";
  const named = (over = {}) => ({ key: "seaside-fc", name: "Seaside FC", logo: CHOSEN, site: "https://seaside.example/", fill: 1, teams: 2, ...over });
  const teams = [
    { ref: "squadi:team:1", name: "Seaside FC U10", provider: "squadi", shown: "added", named: "seaside-fc", logo: CHOSEN },
    { ref: "squadi:team:2", name: "Seaside FC U11", provider: "squadi", shown: "added", named: "seaside-fc", logo: CHOSEN },
    { ref: "squadi:team:3", name: "Seaside Rovers U10", provider: "squadi", shown: "added", named: "seaside-rovers", logo: "https://rovers.example/logo.png" },
    { ref: "squadi:team:4", name: "Seaside Juniors U9", provider: "squadi", shown: "missing" },
    { ref: "squadi:team:5", name: "Oxley United Eagles U10", provider: "squadi", shown: "built-in", club: "built-in:/crests/oxley-united.png" },
    { ref: "squadi:team:6", name: "Oxley United Falcons U9", provider: "squadi", shown: "built-in", club: "built-in:/crests/oxley-united.png" },
    { ref: "dribl:team:T1", name: "Zebras FC", provider: "dribl", shown: "found", club: "dribl:club:C1", kind: "club", from: "Dribl", logo: FOUND }
  ];
  const lib = (over = {}) => report({
    counts: { ...report().counts, added: 3 },
    opponents: teams,
    named: [named(), { key: "seaside-rovers", name: "Seaside Rovers", logo: "https://rovers.example/logo.png", site: "https://rovers.example/", fill: 1, teams: 1 }],
    ...over
  });
  let answer;
  beforeEach(() => {
    answer = (body) => ({ ok: true, key: body.name === "Seaside" ? "seaside" : "seaside-fc", ...lib({ named: [named({ name: body.name, fill: body.fill, teams: 7 })] }) });
    fetch.mockImplementation(async (url, init = {}) => {
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        posts.push(body);
        if (body.action === "site") return { ok: true, status: 200, json: async () => ({ ok: true, site: "https://seaside.example/", candidates: [{ url: CHOSEN, kind: "logo" }, { url: NEW, kind: "logo" }] }) };
        return { ok: true, status: 200, json: async () => answer(body) };
      }
      return { ok: true, status: 200, json: async () => lib() };
    });
  });
  const rowOf = (title, name) => within(card(title)).getByText(name).closest(".adm-row");
  const size = (row) => within(row).getByRole("slider", { name: "Size in the circle" });
  const previews = (row) => [...row.querySelectorAll(".adm-fillrow img.adm-crest.drawn")];

  it("a club you chose opens with its logo in use, picked, so it can just be enlarged; the preview shows it filling the circle", async () => {
    render(<ClubLogos />);
    const row = await waitFor(() => rowOf("Logos you chose", "Seaside FC"));
    fireEvent.click(within(row).getByRole("button", { name: "Change" }));
    expect(within(row).getByLabelText("Club").value).toBe("Seaside FC");
    expect(within(row).getByLabelText("Club website or logo link").value).toBe("https://seaside.example/");
    const picks = within(row).getByRole("group", { name: "Logos found on the club's site" });
    const current = within(picks).getByRole("button", { name: "Logo 1 of 1: the logo in use" });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    expect(within(row).getByText("The logo in use now. To change it, find logos on the club's website.")).toBeTruthy();
    expect(size(row).value).toBe("1");
    expect(previews(row).map((i) => [i.getAttribute("src"), i.style.transform])).toEqual([[CHOSEN, ""], [CHOSEN, ""]]);
    fireEvent.change(size(row), { target: { value: "1.3" } });
    expect(within(row).getByText("Size in the circle: 130%")).toBeTruthy();
    expect(size(row).getAttribute("aria-valuetext")).toBe("130%");
    expect(previews(row).map((i) => [i.getAttribute("src"), i.style.transform, i.style.clipPath])).toEqual([
      [CHOSEN + "#fill=1.3", "scale(1.3)", "circle(38.46% at 50% 50%)"],
      [CHOSEN + "#fill=1.3", "scale(1.3)", "circle(38.46% at 50% 50%)"]
    ]);
    // The rest of the page is the same club's: its other buttons wait until this is done.
    expect(within(row).queryByRole("button", { name: "Remove" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Use this logo for Seaside FC" }));
    await waitFor(() => expect(posts).toEqual([{ action: "club", name: "Seaside FC", logo: CHOSEN, site: "https://seaside.example/", fill: 1.3, replaces: "seaside-fc" }]));
    expect(await screen.findByText("Seaside FC saved: its logo now shows for 7 teams.")).toBeTruthy();
  });

  it("a size chosen before is where the control starts, and the list shows the logo at that size", async () => {
    fetch.mockImplementation(async () => ({ ok: true, status: 200, json: async () => lib({ named: [named({ fill: 1.25 })] }) }));
    render(<ClubLogos />);
    const row = await waitFor(() => rowOf("Logos you chose", "Seaside FC"));
    const listed = row.querySelector("img.adm-crest.drawn");
    expect([listed.getAttribute("src"), listed.style.transform]).toEqual([CHOSEN + "#fill=1.25", "scale(1.25)"]);
    fireEvent.click(within(row).getByRole("button", { name: "Change" }));
    expect(size(row).value).toBe("1.25");
    expect(within(row).getByText("Size in the circle: 125%")).toBeTruthy();
  });

  it("finding logos on the club's site keeps the one in use on offer beside the new ones", async () => {
    render(<ClubLogos />);
    const row = await waitFor(() => rowOf("Logos you chose", "Seaside FC"));
    fireEvent.click(within(row).getByRole("button", { name: "Change" }));
    fireEvent.click(within(row).getByRole("button", { name: "Find logos" }));
    await waitFor(() => expect(within(row).getAllByRole("button", { name: /^Logo \d of 2/ })).toHaveLength(2));
    expect(posts).toEqual([{ action: "site", url: "https://seaside.example/" }]);
    const [current, fresh] = within(row).getAllByRole("button", { name: /^Logo \d of 2/ });
    expect([current.getAttribute("aria-label"), fresh.getAttribute("aria-label")]).toEqual(["Logo 1 of 2: the logo in use", "Logo 2 of 2: a logo"]);
    // The one new logo is picked for you; the one in use is a tap away.
    expect([current.getAttribute("aria-pressed"), fresh.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    expect(within(row).getByText("Pick the club's logo from seaside.example:")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Use this logo for Seaside FC" }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ action: "club", name: "Seaside FC", logo: NEW, site: "https://seaside.example/", fill: 1, replaces: "seaside-fc" }));
  });

  it("a new name replaces the old one, and covers the teams it then covers, but not one a club with more of its words has", async () => {
    render(<ClubLogos />);
    const row = await waitFor(() => rowOf("Logos you chose", "Seaside FC"));
    fireEvent.click(within(row).getByRole("button", { name: "Change" }));
    fireEvent.change(within(row).getByLabelText("Club"), { target: { value: "Seaside" } });
    // Seaside Rovers U10 keeps the Seaside Rovers logo: that club has more of its words.
    expect(within(row).getByRole("status").textContent).toMatch(/^Covers 3 teams: Seaside FC U10, Seaside FC U11 and Seaside Juniors U9\./);
    fireEvent.click(within(row).getByRole("button", { name: "Use this logo for Seaside" }));
    await waitFor(() => expect(posts).toEqual([{ action: "club", name: "Seaside", logo: CHOSEN, site: "https://seaside.example/", fill: 1, replaces: "seaside-fc" }]));
  });

  it("a built-in club's logo can be changed: the club is guessed from the words its teams share, and its teams are covered", async () => {
    render(<ClubLogos />);
    const fold = (await screen.findByText("Built-in crests")).closest("details");
    const row = within(fold).getByText("Oxley United FC").closest(".adm-row");
    fireEvent.click(within(row).getByRole("button", { name: "Change logo" }));
    expect(within(row).getByLabelText("Club").value).toBe("Oxley United");
    // "Oxley United", the words both teams start with, not the first team's "Oxley United Eagles".
    expect(within(row).getByRole("status").textContent).toMatch(/^Covers 2 teams: Oxley United Eagles U10 and Oxley United Falcons U9\./);
    // The built-in crest is not a picture from the club's site, so it isn't offered: a new logo has to be found.
    expect(within(row).queryByRole("group", { name: "Logos found on the club's site" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Use this logo for Oxley United" }).disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText("Club website or logo link"), { target: { value: "oxley.example" } });
    fireEvent.click(within(row).getByRole("button", { name: "Find logos" }));
    fireEvent.click(await within(row).findByRole("button", { name: "Logo 2 of 2: a logo" }));
    fireEvent.click(within(row).getByRole("button", { name: "Use this logo for Oxley United" }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ action: "club", name: "Oxley United", logo: NEW, site: "https://seaside.example/", fill: 1 }));
  });

  it("a logo found on Squadi or Dribl can be kept and enlarged, with no website needed", async () => {
    render(<ClubLogos />);
    const row = await waitFor(() => rowOf("Logos found", "Zebras FC"));
    fireEvent.click(within(row).getByRole("button", { name: "Change logo" }));
    expect(within(row).getByLabelText("Club").value).toBe("Zebras FC");
    expect(within(row).getByRole("button", { name: "Logo 1 of 1: the logo in use" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(size(row), { target: { value: "1.25" } });
    fireEvent.click(within(row).getByRole("button", { name: "Use this logo for Zebras FC" }));
    await waitFor(() => expect(posts).toEqual([{ action: "club", name: "Zebras FC", logo: FOUND, site: "", fill: 1.25 }]));
  });

  it("one editor at a time: opening another club's closes the first, and Cancel puts the buttons back", async () => {
    render(<ClubLogos />);
    const chosen = await waitFor(() => rowOf("Logos you chose", "Seaside FC"));
    fireEvent.click(within(chosen).getByRole("button", { name: "Change" }));
    const found = rowOf("Logos found", "Zebras FC");
    fireEvent.click(within(found).getByRole("button", { name: "Change logo" }));
    expect(within(found).queryByRole("button", { name: "Hide" })).toBeNull();
    expect(within(chosen).queryByLabelText("Club")).toBeNull();
    expect(within(chosen).getByRole("button", { name: "Change" })).toBeTruthy();
    fireEvent.click(within(found).getByRole("button", { name: "Cancel" }));
    expect(within(found).queryByLabelText("Club")).toBeNull();
    expect(within(found).getAllByRole("button").map((b) => b.textContent)).toEqual(["Hide", "Change logo"]);
    expect(posts).toEqual([]);
  });
});
