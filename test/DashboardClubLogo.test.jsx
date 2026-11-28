// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";
import { OUR_CREST } from "@/lib/clubs";

// Team settings' Club logo card: the team's own logo, uploaded or picked from
// the club's website, sized to fill its circle, and saved on its own through
// /api/team-settings. The browser's fitting of a picture (lib/logoFit.js)
// is a stand-in; every site and name is made up.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
const { fitLogo, fileToDataUrl } = vi.hoisted(() => ({ fitLogo: vi.fn(), fileToDataUrl: vi.fn() }));
vi.mock("@/lib/logoFit", () => ({ fitLogo, fileToDataUrl }));

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };
const OLD = "data:image/png;base64,T0xE";
const FITTED = "data:image/png;base64,RklUVEVE";
const SITE = "https://valleywanderers.example/";
const CREST = "https://valleywanderers.example/img/crest.png";
const game = { id: "f7", round: 7, status: "upcoming", dateISO: daysFromNow(6), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {} };
const makeData = (team = {}) => ({
  team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", ...team },
  players: [{ id: "p1", name: "Sam Smith", number: 7 }], fixtures: [game], sessions: [], isSample: false
});

// /api/team-settings echoes back what it kept (the logo's size rounded, as the route does).
let settings;
function stubFetch() {
  fetch.mockImplementation((url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes("/api/team-settings")) return settings(body);
    if (u.includes("/api/logo-site")) {
      return Promise.resolve(body.action === "site"
        ? { ok: true, status: 200, json: async () => ({ ok: true, site: SITE, candidates: [{ url: CREST, kind: "logo" }] }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, type: "image/png", picture: "data:image/png;base64,UElD" }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  vi.stubGlobal("fetch", vi.fn());
  settings = (body) => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, team: { ...body, logoSite: body.logoSite ? SITE : "" } }) });
  stubFetch();
  fitLogo.mockReset().mockResolvedValue(FITTED);
  fileToDataUrl.mockReset().mockResolvedValue("data:image/jpeg;base64,RklMRQ==");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const openChip = async () => { fireEvent.click(await waitForLoaded()); return screen.findByText("Viewing as", { selector: ".hs-title" }); };
const load = async (data) => {
  storage.get.mockResolvedValue({ value: JSON.stringify(data) });
  render(<App />);
  await openChip();
  fireEvent.click(await screen.findByText("Coach mode"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Viewing as" }).textContent).toBe("Coach"));
  await openChip();
  fireEvent.click(await screen.findByText("Team settings"));
  await screen.findByText("Team details");
  return screen.getByText("Club logo", { selector: ".label" }).closest(".card");
};
const saveButton = (card) => within(card).getByRole("button", { name: "Save logo" });
const settingsSent = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/team-settings")).map((c) => JSON.parse(c[1].body));
const homeCrest = () => document.querySelector(".nextgame .mu-crest.ours");

describe("Team settings: the Club logo card", () => {
  it("has its own card, out of Team details, showing the club's crest until the team has a logo", async () => {
    const card = await load(makeData());
    const details = screen.getByText("Team details", { selector: ".label" }).closest(".card");
    expect(details.textContent).not.toMatch(/logo/i);
    expect(card.querySelector(".lp-crest.lp-lg").getAttribute("src")).toBe(OUR_CREST);
    expect(saveButton(card).disabled).toBe(true);
  });

  it("in team-code mode, where nobody is signed in to read a site, offers only an upload", async () => {
    const card = await load(makeData());
    expect(within(card).queryByRole("button", { name: "Find logos" })).toBeNull();
    expect(within(card).getByText("Upload a picture")).toBeTruthy();
  });

  it("an uploaded picture is saved with its size, on its own, and every circle shows it enlarged with the ring kept", async () => {
    const card = await load(makeData());
    fireEvent.change(card.querySelector("input[type=file]"), { target: { files: [new File(["x"], "crest.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(card.querySelector(".lp-crest.lp-lg").getAttribute("src")).toBe(FITTED));
    fireEvent.change(within(card).getByLabelText("Size in the circle"), { target: { value: "1.4" } });
    fireEvent.click(saveButton(card));
    await waitFor(() => expect(within(card).getByText("Saved. Everyone sees the new logo next time they open the team.").getAttribute("role")).toBe("status"));
    expect(settingsSent()).toEqual([{ logo: FITTED, logoFill: 1.4, logoSite: "" }]);
    expect(storage.set).not.toHaveBeenCalled(); // no whole-document write for this
    expect(saveButton(card).disabled).toBe(true);
    // Back on Home, the next game's crest is the new logo, enlarged inside its ringed frame.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(homeCrest()).toBeTruthy());
    expect(homeCrest().className).toBe("mu-crest ours framed");
    expect(homeCrest().querySelector("img").getAttribute("src")).toBe(FITTED);
    expect(homeCrest().querySelector("img").style.width).toBe("140%");
  });

  it("a failed save says why and keeps the change to try again, and Undo changes goes back to what is saved", async () => {
    settings = () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "That picture can't be used as the logo. Try a smaller one." }) });
    const card = await load(makeData({ logo: OLD, logoFill: 1.2 }));
    expect(within(card).getByLabelText("Size in the circle").value).toBe("1.2");
    fireEvent.change(within(card).getByLabelText("Size in the circle"), { target: { value: "1.5" } });
    fireEvent.click(saveButton(card));
    await waitFor(() => expect(within(card).getAllByRole("alert").map((a) => a.textContent)).toContain("That picture can't be used as the logo. Try a smaller one."));
    expect(saveButton(card).disabled).toBe(false);
    fireEvent.click(within(card).getByRole("button", { name: "Undo changes" }));
    expect(within(card).getByLabelText("Size in the circle").value).toBe("1.2");
    expect(saveButton(card).disabled).toBe(true);
  });

  it("Remove goes back to the club's crest once saved", async () => {
    const card = await load(makeData({ logo: OLD, logoFill: 1.2, logoSite: SITE }));
    fireEvent.click(within(card).getByRole("button", { name: "Remove" }));
    fireEvent.click(saveButton(card));
    await waitFor(() => expect(within(card).getByText("Saved. The team shows the club's crest again.")).toBeTruthy());
    expect(settingsSent()).toEqual([{ logo: "", logoFill: 1, logoSite: SITE }]);
  });
});
