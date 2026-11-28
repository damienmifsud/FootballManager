// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

// The super admin's Logos section (components/ClubLogos.jsx): the counts, the
// teams still without a logo, the logos found (with Hide), and Find missing
// logos, which asks the server to read Squadi again and reads Dribl in this
// browser. /api/club-logos and Dribl are stand-ins. Every name, number and
// address here is made up.
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
  // A team the built-in crests cover is never counted, whatever its name.
  const builtIn = { ref: "squadi:team:500012", name: "Seaside FC Oxley United Juniors", provider: "squadi", shown: "built-in" };
  const withMissing = (over = {}) => report({ opponents: [...report().opponents.filter((o) => o.shown !== "missing"), builtIn, ...missing], ...over });
  const added = withMissing({
    counts: { ...report().counts, added: 2, missing: 1 },
    opponents: [...report().opponents.filter((o) => o.shown !== "missing"), { ...missing[0], shown: "added", named: "seaside-fc", logo: SITE_LOGO }, { ...missing[1], shown: "added", named: "seaside-fc", logo: SITE_LOGO }, missing[2]],
    named: [{ key: "seaside-fc", name: "Seaside FC", logo: SITE_LOGO, site: "https://seaside.example/", teams: 2 }]
  });

  beforeEach(() => {
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
    expect(within(row).getByRole("status").textContent).toBe('Covers 2 teams: Seaside FC U10 and Seaside FC Academy U11. Every team whose name has the words "seaside" and "fc" gets this logo, the ones still to come too.');
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
    await waitFor(() => expect(posts.at(-1)).toEqual({ action: "club", name: "Seaside FC", logo: SITE_LOGO, site: "https://seaside.example/" }));
    // The club is listed as added, its teams have left the missing list, and the editor has closed.
    const addedCard = await waitFor(() => card("Club logos you added"));
    expect(within(addedCard).getByText("Seaside FC")).toBeTruthy();
    expect(addedCard.querySelector(".adm-row-sub").textContent).toBe("From seaside.example, shown for 2 teams");
    expect(within(card("Still without a logo")).queryByText("Seaside FC U10")).toBeNull();
    expect(screen.getByText("Seaside FC added: its logo now shows for 2 teams.")).toBeTruthy();
    expect(card("Opposition logos").textContent).toContain("2 with a club logo you added");
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
    const addedCard = await waitFor(() => card("Club logos you added"));
    fireEvent.click(within(addedCard).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(posts).toEqual([{ action: "unclub", key: "seaside-fc" }]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Club logos you added" })).toBeNull());
    expect(screen.getByText("Seaside FC taken out: its teams are back to what the draws show.")).toBeTruthy();
  });
});
