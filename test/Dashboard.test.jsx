// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal, SEASON } from "@/lib/dashboardData";
import { signOut } from "next-auth/react";

// The Viewing-as sheet's Sign out calls Auth.js's signOut; under test it just records the call.
vi.mock("next-auth/react", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

// Component-level tests for the Dashboard App: data loading via window.storage,
// the sample-data fallback, tab navigation, and the coach-mode PIN gate. These
// render the real component in jsdom, so they exercise the wiring the pure-helper
// unit tests can't. We stay off the Stats tab (recharts needs a real layout).

// Dates relative to "today" so the next-fixture cards (Home, Duties) keep
// finding an upcoming game no matter when the suite runs.
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };

function makeData(over = {}) {
  return {
    team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", assistantCoach: "Dee" },
    players: [{ id: "p1", name: "Sam Smith", number: 7, position: "FWD" }],
    fixtures: [{ id: "f1", status: "upcoming", dateISO: daysFromNow(7), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {} }],
    sessions: [],
    isSample: false,
    ...over
  };
}

let storage;
beforeEach(() => {
  storage = { get: vi.fn(), set: vi.fn().mockResolvedValue({ ok: true }) };
  window.storage = storage;
  // AddToCalendarCard / AskTab fetch endpoints that don't exist under test.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

// The header hat chip (unique, only present once data has loaded) makes a
// reliable "loaded" anchor — the team name itself appears in multiple cards.
const waitForLoaded = () => screen.findByRole("button", { name: "Viewing as" });
const chip = () => screen.getByRole("button", { name: "Viewing as" });
const expectChip = (label) => waitFor(() => expect(chip().textContent).toBe(label));
// Tap the chip; resolves once the Viewing-as sheet is up.
const openChip = async () => { fireEvent.click(await waitForLoaded()); return screen.findByText("Viewing as", { selector: ".hs-title" }); };
const closeSheet = () => fireEvent.click(document.querySelector(".ov"));
// Legacy (team-code) mode: coach mode is entered from the Viewing-as sheet.
const enterCoachMode = async () => {
  await openChip();
  fireEvent.click(await screen.findByText("Coach mode"));
  await expectChip("Coach");
};
// Settings is a pushed sub-screen, reached only from the sheet (coach only).
const openSettings = async () => {
  await openChip();
  fireEvent.click(await screen.findByText("Team settings"));
  await screen.findByText("Team details");
};
const headerTitle = () => document.querySelector(".head .hname")?.textContent;
const headerKicker = () => document.querySelector(".head .hkick")?.textContent;

describe("App — loading and data", () => {
  it("shows a loading state, then renders the team header from stored data", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    expect(screen.getByText("Loading…")).toBeTruthy(); // initial synchronous render
    await waitForLoaded();
    expect(headerTitle()).toBe("Test FC");
    expect(headerKicker()).toBe("Div 1 · U8");
    expect(screen.getAllByText("Test FC").length).toBeGreaterThan(0);
  });

  it("falls back to sample data (with banner) and persists it when storage is empty", async () => {
    storage.get.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText(/example data/i)).toBeTruthy();
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
  });

  it("falls back to sample data when storage throws", async () => {
    storage.get.mockRejectedValue(new Error("offline"));
    render(<App />);
    await waitForLoaded();
    expect(document.body.textContent).toMatch(/Olympic FC/); // sampleData team name
  });
});

describe("App — tab navigation", () => {
  it("switches to the Squad tab and lists players", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    // The player isn't on the Home tab; it appears after navigating to Squad.
    fireEvent.click(screen.getByText("Squad"));
    expect(await screen.findByText("Sam Smith")).toBeTruthy();
  });
});

describe("App — coach-mode PIN gate", () => {
  it("enters coach mode from the sheet when no PIN is set; the sheet then offers Team settings and Leave coach mode", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "" } })) });
    render(<App />);
    await expectChip("Parent");
    await openChip();
    expect(screen.getByText("Switch team, open settings or sign out.")).toBeTruthy();
    expect(screen.queryByText("Team settings")).toBeNull(); // coach-only row hidden in the parent view
    expect(screen.getByText("Sign in to respond")).toBeTruthy();
    fireEvent.click(screen.getByText("Coach mode"));
    // Now in coach mode: the chip reads Coach and the sheet has closed.
    await expectChip("Coach");
    expect(document.querySelector(".ov")).toBeNull();
    await openChip();
    expect(screen.getByText("Team settings")).toBeTruthy();
    expect(screen.getByText("Leave coach mode")).toBeTruthy();
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    fireEvent.click(screen.getByText("Leave coach mode"));
    await expectChip("Parent");
  });

  it("does NOT enter coach mode when a PIN is set: Coach mode opens the PIN sheet and a wrong PIN is refused", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    await openChip();
    fireEvent.click(screen.getByText("Coach mode"));
    expect(await screen.findByText("Coach PIN")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Incorrect PIN.")).toBeTruthy();
    expect(chip().textContent).toBe("Parent");
  });
});

describe("App — account-mode roles (/api/me)", () => {
  const meFetch = (me) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  // /api/me payload builders in the hat-picker shape.
  const coachHat = { role: "coach", playerIds: [], playerNames: [] };
  const parentHat = (ids, names) => ({ role: "parent", playerIds: ids, playerNames: names });
  const viewerHat = { role: "viewer", playerIds: [], playerNames: [], clubAdmin: true };
  const account = (over = {}) => {
    const hats = over.hats || [coachHat];
    const worn = hats.find((h) => h.role === (over.role || "coach")) || hats[0];
    return {
      mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role: "coach",
      playerIds: worn.playerIds, playerNames: worn.playerNames, hats,
      teams: [{ teamSlug: "a", teamName: "Test FC", hats }], canSwitch: false, memberships: [], ...over
    };
  };
  const threeKids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  // Home "Details" pushes Match detail; "See everyone's replies" pushes Who's in.
  const openMatch = async () => {
    fireEvent.click(await screen.findByText("Details"));
    fireEvent.click(await screen.findByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
  };
  const clearCookies = () => document.cookie.split(";").forEach((c) => {
    const k = c.split("=")[0].trim();
    if (k) document.cookie = `${k}=; path=/; max-age=0`;
  });
  const hatRow = (label) => screen.getByText(label, { selector: ".hs-row b" }).closest(".hs-row");

  it("a parent gets the parent chip and a sheet with no coach mode, no settings and no legacy sign-in", async () => {
    meFetch(account({ email: "mum@a.com", role: "parent", hats: [parentHat(["p1"], ["Sam Smith"])] }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    await expectChip("Parent of Sam");
    await openChip();
    expect(screen.getByText("Switch team, open settings or sign out.")).toBeTruthy();
    expect(hatRow("Parent of Sam").querySelector(".disc.on").textContent).toBe("SS");
    expect(screen.getByText("Reply for Sam and see the team")).toBeTruthy();
    expect(screen.queryByText("Coach mode")).toBeNull();
    expect(screen.queryByText("Team settings")).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });

  it("a view-only club admin gets the read-only hat, a Club admin link and no coach or respond rows", async () => {
    meFetch(account({ email: "td@club.com", role: "viewer", hats: [viewerHat], clubAdmin: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    await expectChip("Club admin (view only)");
    await openChip();
    expect(screen.getByText("Read everything, change nothing")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Club admin/ }).getAttribute("href")).toBe("/admin");
    expect(screen.queryByText("Coach mode")).toBeNull();
    expect(screen.queryByText("Team settings")).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
  });

  it("a server-verified coach is in coach mode automatically (no PIN, no toggle) and reaches Team settings from the sheet", async () => {
    meFetch(account({ email: "coach@a.com" }));
    // A coachPin is set, but the server-verified role never sees the PIN sheet.
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    expect(screen.queryByText("Coach mode")).toBeNull();
    expect(screen.queryByText("Leave coach mode")).toBeNull();
    fireEvent.click(screen.getByText("Team settings"));
    expect(await screen.findByText("Team details")).toBeTruthy();
    expect(screen.queryByText("Coach PIN")).toBeNull();
    expect(headerTitle()).toBe("Team settings");
    expect(headerKicker()).toBe("Test FC");
  });

  it("one hat, one team: the sheet shows the worn coach hat with a check and no Other teams section", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    expect(screen.getByText("Switch team, open settings or sign out.")).toBeTruthy();
    const row = hatRow("Coach");
    expect(row.querySelector(".disc.on").textContent).toBe("C");
    expect(row.querySelector('[aria-label="Current hat"]')).toBeTruthy();
    expect(screen.getByText("Edit fixtures, scores and duties")).toBeTruthy();
    expect(screen.queryByText("Other teams")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelector(".whoami")).toBeNull();
  });

  it("two hats: the sheet lists both; tapping the parent hat sets the team_slug and act_as cookies", async () => {
    clearCookies();
    const hats = [coachHat, parentHat(["p1"], ["Sam Smith"])];
    meFetch(account({
      email: "both@a.com", hats, canSwitch: true,
      teams: [{ teamSlug: "a", teamName: "Test FC", hats }, { teamSlug: "bees", teamName: "Bees FC", hats: [coachHat] }]
    }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    expect(screen.getByText("You're both a coach and a parent here. Pick a hat.")).toBeTruthy();
    const labels = [...document.querySelectorAll(".hs-list .hs-row b")].map((b) => b.textContent);
    expect(labels).toEqual(["Coach", "Parent of Sam", "Bees FC", "Team settings"]);
    expect(hatRow("Coach").querySelector(".disc.on")).toBeTruthy();
    expect(hatRow("Parent of Sam").querySelector(".disc.on")).toBeNull();
    expect(screen.getByText("Other teams")).toBeTruthy();

    fireEvent.click(hatRow("Parent of Sam"));
    expect(document.cookie).toContain("team_slug=a");
    expect(document.cookie).toContain("act_as=parent");
    clearCookies();
  });

  it("Other teams: switching lands in that team's strongest hat and drops its legacy identity cookie", async () => {
    clearCookies();
    document.cookie = "whoami_b=parent-device; path=/";
    const hats = [coachHat, parentHat(["p1"], ["Sam Smith"])];
    meFetch(account({
      email: "both@a.com", hats, canSwitch: true,
      teams: [{ teamSlug: "a", teamName: "Test FC", hats }, { teamSlug: "b", teamName: "Bees FC", hats: [parentHat(["p9"], ["Kai Lee"]), { role: "viewer", playerIds: [], playerNames: [] }] }]
    }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    const bees = hatRow("Bees FC");
    expect(bees.querySelector(".txt span").textContent).toBe("Parent of Kai"); // strongest hat there
    expect(screen.queryByText("Test FC", { selector: ".hs-row b" })).toBeNull(); // the current team isn't an "other"
    expect(document.cookie).toContain("whoami_b=parent-device");

    fireEvent.click(bees);
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).toContain("act_as=parent"); // strongest hat on Bees FC is parent, not viewer
    expect(document.cookie).not.toContain("whoami_b=");
    clearCookies();
  });

  it("admins see Create a team and a Club admin link in the sheet, plus Sign out", async () => {
    meFetch(account({ email: "admin@club.com", admin: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    const create = screen.getByRole("link", { name: /Create a team/ });
    expect(create.getAttribute("href")).toBe("/admin");
    expect(create.closest(".hs-list")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Club admin/ });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(screen.getByRole("button", { name: /Sign out/ }).closest(".sheet")).toBeTruthy();
    // The header carries nothing but crest, team and chip.
    expect(document.querySelector(".head").textContent).not.toContain("Club admin");
  });

  it("a club admin (not super admin) also gets Create a team and the Club admin link", async () => {
    meFetch(account({ email: "club@club.com", clubAdmin: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await openChip();
    expect(screen.getByRole("link", { name: /Create a team/ }).getAttribute("href")).toBe("/admin");
    expect(screen.getByRole("link", { name: /Club admin/ }).getAttribute("href")).toBe("/admin");
  });

  it("a plain coach sees neither Create a team nor the Club admin link", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    expect(screen.queryByText(/Create a team/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Club admin/ })).toBeNull();
    expect(screen.getByText("Team settings")).toBeTruthy();
  });

  it("Sign out in the sheet clears the hat cookies, POSTs /api/logout and calls next-auth signOut", async () => {
    clearCookies();
    document.cookie = "team_slug=a; path=/";
    document.cookie = "act_as=coach; path=/";
    document.cookie = "whoami_a=device; path=/";
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    signOut.mockClear();
    await openChip();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" }));
    expect(fetch).toHaveBeenCalledWith("/api/logout", { method: "POST" });
    expect(document.cookie).not.toContain("team_slug=");
    expect(document.cookie).not.toContain("act_as=");
    expect(document.cookie).not.toContain("whoami_a=");
    clearCookies();
  });

  it("legacy mode (no account): the sheet offers Coach mode, 'Sign in to respond' and Sign out; no hats, no selects", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Parent");
    await openChip();
    const signin = await screen.findByText("Sign in to respond");
    expect(signin.closest(".hs-row")).toBeTruthy();
    expect(screen.getByText("Coach mode")).toBeTruthy();
    expect(document.querySelector(".disc")).toBeNull(); // no hat rows without an account
    expect(document.querySelector(".whoami")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/logout", { method: "POST" }));
    expect(document.querySelector(".head").textContent).not.toContain("Club admin");
  });

  it("legacy mode: 'Sign in to respond' opens the who's-responding sheet, and the row then names the child", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await openChip();
    fireEvent.click(screen.getByText("Sign in to respond"));
    expect(await screen.findByText("Who's responding?")).toBeTruthy();
    fireEvent.click(screen.getByText("Sam Smith"));
    await waitFor(() => expect(document.querySelector(".ov")).toBeNull());
    await openChip();
    expect(screen.getByText("Responding as Sam Smith")).toBeTruthy();
  });

  it("a coach-parent wearing the parent hat gets the parent experience: no coach mode, In/Out for both of their kids only", async () => {
    meFetch(account({ email: "both@a.com", role: "parent", hats: [coachHat, parentHat(["p1", "p2"], ["Sam Smith", "Alex Smith"])], canSwitch: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players: threeKids })) });
    render(<App />);
    await expectChip("Parent of Sam & Alex");
    await openChip();
    expect(hatRow("Parent of Sam & Alex").querySelector(".disc.on").textContent).toBe("SA");
    expect(hatRow("Coach").querySelector(".disc.on")).toBeNull();
    expect(screen.queryByText("Team settings")).toBeNull(); // parent hat: not coach mode
    closeSheet();
    await openMatch();
    // Their two children get the tinted row and a Reply pill (the sheet, D1 1a); no inline In / Out.
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(2);
    expect(document.querySelectorAll(".av-row.mine")).toHaveLength(2);
    expect(document.querySelector(".av-seg")).toBeNull();
    // Milo's row is read-only (a status pill, not a button) and no legacy sign-in button appears.
    const milo = screen.getByText("Milo Park").closest(".av-row");
    expect(milo.querySelector("button")).toBeNull();
    expect(milo.querySelector(".st-pill").textContent).toBe("No reply");
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    expect(screen.getByText("You can reply for Sam & Alex. Coaches can reply for anyone.")).toBeTruthy();
  });

  it("a view-only club admin gets no In/Out buttons and no sign-in button in the match sheet", async () => {
    meFetch(account({ email: "td@club.com", role: "viewer", hats: [viewerHat] }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players: threeKids })) });
    render(<App />);
    await expectChip("Club admin (view only)");
    await openMatch();
    expect(screen.queryByRole("button", { name: "In" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Out" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    expect(document.querySelectorAll(".st-pill")).toHaveLength(3);
    expect(screen.getByText("Only coaches and families can reply.")).toBeTruthy();
  });

  it("until /api/me has answered the chip reads Parent and the sheet offers neither coach mode nor sign-in", async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return new Promise(() => {}); // never answers
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    expect(chip().textContent).toBe("Parent");
    await openChip();
    expect(screen.queryByText("Coach mode")).toBeNull();
    expect(screen.queryByText("Team settings")).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });

  it("viewingAs: a coach edit writes nothing and shows the read-only notice as a toast", async () => {
    meFetch(account({ email: "admin@club.com", admin: true, realAdmin: true, viewingAs: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openChip();
    expect(screen.getByRole("link", { name: /Club admin/ }).getAttribute("href")).toBe("/admin");
    fireEvent.click(screen.getByText("Team settings")); // proves coach mode
    await screen.findByText("Team details");
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(await screen.findByText("Add fixture"));
    fireEvent.click(await screen.findByRole("button", { name: "Save fixture" }));
    const toast = await screen.findByRole("status");
    expect(toast.className).toBe("toast");
    expect(toast.textContent).toBe("Read only while viewing as coach@a.com.");
    expect(document.querySelector(".banner")).toBeNull(); // the yellow banner is for sample data only
    expect(storage.set).not.toHaveBeenCalled();
    fireEvent.click(toast); // tap dismisses early
    expect(screen.queryByText(/Read only while viewing as/)).toBeNull();
  });

  it("hides the Coach PIN field and the PIN advice in Settings in account mode", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Coach");
    await openSettings();
    expect(screen.queryByText("Coach PIN (guards editing)")).toBeNull();
    expect(screen.getByText(/Sign-in decides who can edit/)).toBeTruthy();
    expect(screen.queryByText(/set a PIN above/)).toBeNull();
  });
});

describe("App — failed saves are undone", () => {
  it("reverts the data and shows the notice when window.storage.set rejects", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    storage.set.mockRejectedValue(new Error("quota"));
    const { container } = render(<App />);
    await enterCoachMode();
    fireEvent.click(screen.getByText("Results"));
    await screen.findByText("Add fixture");
    expect(container.querySelectorAll(".mrow")).toHaveLength(1);
    fireEvent.click(screen.getByText("Add fixture"));
    fireEvent.click(await screen.findByRole("button", { name: "Save fixture" }));
    const toast = await screen.findByRole("status");
    expect(toast.className).toBe("toast");
    expect(toast.textContent).toMatch(/Couldn't save — your change was undone\. quota/);
    await waitFor(() => expect(container.querySelectorAll(".mrow")).toHaveLength(1));
  });
});

describe("App — RSVP toggle (Who's in screen)", () => {
  // The three count tiles' numbers: [in, out, no reply].
  const tiles = () => [...document.querySelectorAll(".wi-tile .v")].map((e) => e.textContent);

  it("marks a player 'in' from the coach's inline control, updating the tiles and POSTing to /api/rsvp; Match detail shows the new count", async () => {
    // RSVP succeeds so the optimistic update sticks (a failed POST reverts it).
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode(); // coach can mark anyone

    // Home "Details" -> Match detail -> "See everyone's replies" -> Who's in.
    fireEvent.click(screen.getByText("Details"));
    expect(await screen.findByText("0 in · 0 out · 1 no reply")).toBeTruthy();
    fireEvent.click(screen.getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(tiles()).toEqual(["0", "0", "1"]);
    const inBtn = await screen.findByRole("button", { name: "In" });
    expect(inBtn.className).toBe("in");
    fireEvent.click(inBtn);

    // Optimistic update on the screen (selected class, tiles), and the RSVP POST.
    expect(screen.getByRole("button", { name: "In" }).className).toBe("in on");
    expect(tiles()).toEqual(["1", "0", "0"]);
    await waitFor(() => {
      const call = fetch.mock.calls.find(c => String(c[0]).includes("/api/rsvp"));
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toMatchObject({ kind: "game", id: "f1", playerId: "p1", status: "in" });
    });
    // The state lives on the fixture in data, so Match detail reads the same count.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("1 in · 0 out · 0 no reply")).toBeTruthy();
  });

  it("a refused RSVP reverts the row and the tiles, with a toast", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    fireEvent.click(screen.getByText("Details"));
    fireEvent.click(await screen.findByText("See everyone's replies"));
    fireEvent.click(await screen.findByRole("button", { name: "Out" }));
    expect(tiles()).toEqual(["0", "1", "0"]); // optimistic
    expect(screen.getByRole("button", { name: "Out" }).className).toBe("out on");
    await waitFor(() => expect(tiles()).toEqual(["0", "0", "1"])); // the default fetch stub answers ok:false
    expect(screen.getByRole("button", { name: "Out" }).className).toBe("out");
    expect(document.querySelector(".toast").textContent).toBe("Couldn't save Sam's reply — try again.");
  });
});

describe("App — per-team feature flags (duties)", () => {
  it("shows fruit + goalkeeper tiles by default, with jersey duty off", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    expect(screen.getByText("Fruit duty")).toBeTruthy();
    expect(screen.getByText("In goal")).toBeTruthy();
    expect(screen.queryByText("Jerseys")).toBeNull();
  });

  it("honours the flags: jersey on, fruit and goalkeeper off", async () => {
    const data = makeData();
    data.team.features = { fruitDuty: false, gkDuty: false, jerseyDuty: true };
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await waitForLoaded();
    expect(screen.getByText("Jerseys")).toBeTruthy();
    expect(screen.queryByText("Fruit duty")).toBeNull();
    expect(screen.queryByText("In goal")).toBeNull();
    // The Duties screen (pushed from the Home strip) shows only the jersey slot.
    fireEvent.click(screen.getByRole("button", { name: "Duties" }));
    expect(await screen.findByText("One job each week: a family washes the jerseys.")).toBeTruthy();
    expect(screen.getByText("Jerseys")).toBeTruthy();
    expect(screen.queryByText("Fruit duty")).toBeNull();
    expect(screen.queryByText("In goal")).toBeNull();
    expect(headerKicker()).toBe("Jersey rota");
  });
});

describe("App — Squadi-style results rows", () => {
  const withFixtures = (fixtures) => makeData({ fixtures });

  it("renders crests from the local registry (never Squadi's hotlink) and an initials disc for unknown clubs", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "f1", round: 1, status: "played", dateISO: daysFromNow(-14), time: "09:00", opponent: "Oxley United FC U8 Eagles", opponentLogo: "https://squadi.example/oxley.png", homeAway: "H", venue: "X", us: 2, them: 1, availability: {} },
      { id: "f2", round: 2, status: "played", dateISO: daysFromNow(-7), time: "09:00", opponent: "Wests", opponentLogo: "https://squadi.example/wests.png", homeAway: "A", venue: "X", us: 1, them: 1, availability: {} }
    ])) });
    const { container } = render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("Results"));
    const srcs = [...container.querySelectorAll(".mrow img.mcrest")].map((i) => i.getAttribute("src"));
    expect(srcs).toContain("/crests/oxley-united.png");
    expect(srcs.filter((s) => s === "/crests/olympic-fc.png")).toHaveLength(2); // our side on both rows
    expect(srcs.some((s) => /^https?:/.test(s))).toBe(false);
    // Unknown club: initials disc, no image.
    const rows = container.querySelectorAll(".mrow");
    expect(rows[1].querySelector(".mcrest.ph").textContent).toBe("W");
    expect(container.querySelector('img[src^="http"]')).toBeNull();
  });

  it("flips an away game (home team left) but colours the score by our result", async () => {
    // Olympic away win 3–1 → rendered home-perspective as 1–3 in the win colour.
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "f1", round: 4, status: "played", dateISO: daysFromNow(-7), time: "09:00", opponent: "Wests", homeAway: "A", venue: "X", us: 3, them: 1, availability: {} }
    ])) });
    const { container } = render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("Results"));
    const row = container.querySelector(".mrow");
    expect(row.querySelector(".mscore").className).toContain("win");
    expect(row.querySelector(".mscore").textContent).toBe("1–3");
    // Away flip: opponent (home side) renders first, Olympic ringed on the right.
    const names = [...row.querySelectorAll(".mr-name")].map((n) => n.textContent);
    expect(names).toEqual(["Wests", "Test FC"]);
    expect(row.querySelector(".mr-side.away").className).toContain("ours");
    expect(row.querySelector(".mr-side:not(.away)").className).not.toContain("ours");
  });

  it("renders the non-score states (cancelled dims the row; upcoming shows the kick-off)", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "c1", round: 1, status: "cancelled", dateISO: daysFromNow(-21), opponent: "A", homeAway: "H", us: null, them: null, availability: {} },
      { id: "u1", round: 2, status: "upcoming", dateISO: daysFromNow(10), time: "09:00", opponent: "B", homeAway: "H", us: null, them: null, availability: {} },
      { id: "n1", round: 3, status: "played", dateISO: daysFromNow(-60), opponent: "C", homeAway: "H", us: null, them: null, availability: {} }
    ])) });
    const { container } = render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("Results"));
    expect(screen.getByText("Canc").className).toBe("mstate");
    expect(screen.getByText("09:00").className).toBe("mtime");
    expect(screen.getByText("No score").className).toBe("mstate none");
    expect(container.querySelector(".mrow.canc")).toBeTruthy();
  });
});

describe("App — coach edit-save (fixture)", () => {
  it("persists a new fixture via window.storage and clears the sample flag", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();

    fireEvent.click(screen.getByText("Results"));          // Results tab
    fireEvent.click(await screen.findByText("Add fixture")); // open the editor
    // Drive the segmented controls (robustly addressable by button text).
    fireEvent.click(await screen.findByRole("button", { name: "Away" }));
    fireEvent.click(screen.getByRole("button", { name: "Played" }));
    fireEvent.click(screen.getByRole("button", { name: "Save fixture" }));

    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    const saved = JSON.parse(storage.set.mock.calls.at(-1)[1]);
    expect(saved.isSample).toBe(false);
    const added = saved.fixtures.find(x => x.status === "played");
    expect(added).toBeTruthy();
    expect(added.homeAway).toBe("A");
  });
});

/* ---------------- Match-day slice ---------------- */

// Echo-style stub for the narrow settings routes: /api/team-settings and
// /api/player-coach answer like the real handlers (sanitised body echoed
// back); everything else stays "not found" as in the default harness.
const stubNarrowRoutes = () => {
  fetch.mockImplementation((url, init) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes("/api/team-settings")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, team: body }) });
    if (u.includes("/api/player-coach")) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, playerId: body.playerId, coach: { ratings: body.ratings || { GK: null, DEF: null, MID: null, FWD: null }, note: body.note || "" } }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
};
const callTo = (path) => fetch.mock.calls.find((c) => String(c[0]).includes(path));
const bodyOf = (path) => JSON.parse(callTo(path)[1].body);

describe("Match day card (D2)", () => {
  const players = [
    { id: "p1", name: "Seyjan Lee", number: 7, position: "FWD" },
    { id: "p2", name: "Milo Park", number: 8, position: "MID" }
  ];
  const u7 = { gameLength: 40, periods: 2, playersOnField: 4, hasGK: false, formation: "2-2", subInterval: 10 };
  const four = [
    { id: "p1", name: "Seyjan Lee", number: 1, position: "DEF" },
    { id: "p2", name: "Milo Park", number: 2, position: "DEF" },
    { id: "p3", name: "Ada Chen", number: 3, position: "MID" },
    { id: "p4", name: "Remy Hall", number: 4, position: "FWD" }
  ];
  const fullBlock = { r0c0: "p1", r0c1: "p2", r1c0: "p3", r1c1: "p4" };
  const fixture = (over = {}) => ({ id: "f1", round: 3, status: "upcoming", dateISO: daysFromNow(5), time: "09:00", opponent: "Wests", homeAway: "H", venue: "X", availability: {}, ...over });

  // Coach mode -> Results tab -> tap the fixture row -> Match day card on Match detail.
  const openCard = async (container) => {
    await enterCoachMode();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".mrow"));
    return screen.findByRole("button", { name: "Match day" });
  };
  const val = (card) => card.querySelector(".dc-val").textContent;
  const meta = (card) => card.querySelector(".dc-meta").textContent;

  it("nobody replied: 'Plan not started' and the no-reply line names both kids; no stage strip, no coach-only pill", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture()] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(card.className).toBe("card dutycard");
    expect(card.querySelector(".dc-ic.gk")).toBeTruthy();
    expect(card.querySelector(".dc-label").textContent).toBe("Match day");
    expect(val(card)).toBe("Plan not started");
    expect(meta(card)).toBe("Seyjan and Milo haven't replied. They're counted in until you mark them out.");
    expect(screen.queryByText("Coach only")).toBeNull();
    expect(screen.queryByText("Kick-off 09:00")).toBeNull();
    expect(document.querySelector(".stages")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open the plan|Kick off/ })).toBeNull();
  });

  it("tapping the card opens the planner takeover", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture()] })) });
    const { container } = render(<App />);
    fireEvent.click(await openCard(container));
    expect(await screen.findByRole("button", { name: "Close" })).toBeTruthy();
    expect(document.querySelector(".mdp")).toBeTruthy();
  });

  it("one reply outstanding: a singular no-reply line", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ availability: { p1: { status: "in", by: "Coach", at: 1 } } })] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(meta(card)).toBe("Milo hasn't replied. They're counted in until you mark them out.");
  });

  it("everyone replied: the meta line is the in/out tally", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ availability: { p1: { status: "in", by: "Coach", at: 1 }, p2: { status: "out", reason: "Sick", by: "Coach", at: 1 } } })] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(meta(card)).toBe("1 in · 1 out");
    expect(screen.queryByText(/replied\. They're counted in/)).toBeNull();
  });

  it("a no-reply player the coach marked OUT in the planner is counted out", async () => {
    const f = fixture({
      availability: { p1: { status: "in", by: "Coach", at: 1 } }, // Milo: no reply
      plan: { subTimes: [], assignments: [], overrides: { p2: "out" }, updatedAt: 1 }
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(meta(card)).toBe("1 in · 1 out");
  });

  it("a no-reply player the coach marked IN in the planner is counted in", async () => {
    const f = fixture({
      availability: { p1: { status: "in", by: "Coach", at: 1 } }, // Milo: no reply
      plan: { subTimes: [], assignments: [], overrides: { p2: "in" }, updatedAt: 1 }
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(meta(card)).toBe("2 in · 0 out");
  });

  it("an override on one player leaves the other no-reply player named", async () => {
    const f = fixture({ plan: { subTimes: [], assignments: [], overrides: { p1: "in" }, updatedAt: 1 } }); // nobody RSVP'd
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    const card = await openCard(container);
    expect(meta(card)).toBe("Milo hasn't replied. They're counted in until you mark them out.");
  });

  it("half-filled plan: 'Gaps to fill'", async () => {
    const data = makeData({ players: four, fixtures: [fixture({ plan: { subTimes: [], assignments: [{ r0c0: "p1" }, {}], updatedAt: 1 } })] });
    data.team.matchFormat = u7;
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    const { container } = render(<App />);
    expect(val(await openCard(container))).toBe("Gaps to fill");
  });

  it("complete plan: 'Lineup set' with the block count", async () => {
    // 4v4, no keeper, 2 halves and no extra subs -> 2 blocks, 4 spots each.
    const data = makeData({ players: four, fixtures: [fixture({ plan: { subTimes: [], assignments: [fullBlock, fullBlock], updatedAt: 1 } })] });
    data.team.matchFormat = u7;
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    const { container } = render(<App />);
    expect(val(await openCard(container))).toBe("Lineup set · 2 blocks");
  });

  it("game day with a saved record: 'Record saved'", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ dateISO: isoLocal(new Date()), record: { savedAt: 1, savedBy: "Coach", minutes: [{ pid: "p1", min: 30 }] } })] })) });
    const { container } = render(<App />);
    expect(val(await openCard(container))).toBe("Record saved");
  });

  it("a played game has no Match day card, even for the coach", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ status: "played", dateISO: daysFromNow(-7), us: 2, them: 1 })] })) });
    const { container } = render(<App />);
    await enterCoachMode();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".mrow"));
    await waitFor(() => expect(headerTitle()).toBe("Round 3"));
    expect(screen.queryByRole("button", { name: "Match day" })).toBeNull();
  });

  it("parents never see the Match day card, but get the Live lineup link once a plan exists", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ plan: { subTimes: [], assignments: [{ r0c0: "p1" }, {}], updatedAt: 1 } })] })) });
    const { container } = render(<App />);
    await waitForLoaded(); // stay in view mode
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".mrow"));
    const link = await screen.findByText("Live lineup");
    expect(link.closest(".linkcard")).toBeTruthy();
    expect(screen.getByText("See who's on and when")).toBeTruthy();
    expect(screen.queryByText("Match day")).toBeNull();
    expect(screen.queryByText("Coach only")).toBeNull();
    fireEvent.click(link);
    expect(await screen.findByRole("button", { name: "Close" })).toBeTruthy(); // the read-only planner view
  });

  it("parents get no link at all when there is no plan yet", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture()] })) });
    const { container } = render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".mrow"));
    await waitFor(() => expect(headerTitle()).toBe("Round 3"));
    expect(screen.queryByText("Live lineup")).toBeNull();
    expect(screen.queryByText("Match day")).toBeNull();
  });
});

describe("Settings — parents can see", () => {
  it("toggles a switch, POSTs only parentsSee to /api/team-settings and flips aria-checked", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    expect(await screen.findByText("Parents can see")).toBeTruthy();
    // Three groups, five switches, defaults applied.
    expect(screen.getByText("Before kick-off")).toBeTruthy();
    expect(screen.getByText("During the game")).toBeTruthy();
    expect(screen.getByText("After the game")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Lineup and sub plan before kick-off" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Live score and clock" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sw);
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy());
    const body = bodyOf("/api/team-settings");
    expect(body.parentsSee.planBeforeKickoff).toBe(true);
    expect(body.parentsSee.liveScore).toBe(true);
    expect(body.matchFormat).toBeUndefined();
    expect(body.rules).toBeUndefined();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Lineup and sub plan before kick-off" }).getAttribute("aria-checked")).toBe("true"));
    // No whole-document write for this.
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("reverts the switch and shows an inline error when the save fails", async () => {
    // Default harness fetch: everything fails.
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    const sw = await screen.findByRole("switch", { name: "Lineup and sub plan before kick-off" });
    fireEvent.click(sw);
    expect(await screen.findByText("Couldn't save — try again.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Lineup and sub plan before kick-off" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("Settings — team details draft survives the settings cards", () => {
  const teamNameInput = () => screen.getByDisplayValue(/Test FC|Renamed FC/);

  it("an unsaved Team name edit is kept when a parents-see switch is flipped, and Save merges it over the live team", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Parents can see");
    fireEvent.change(teamNameInput(), { target: { value: "Renamed FC" } });
    expect(screen.getByDisplayValue("Renamed FC")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Lineup and sub plan before kick-off" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Lineup and sub plan before kick-off" }).getAttribute("aria-checked")).toBe("true"));
    // The draft edit is still there after the narrow-route patch landed.
    expect(screen.getByDisplayValue("Renamed FC")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save team details" }));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    const saved = JSON.parse(storage.set.mock.calls.at(-1)[1]);
    expect(saved.team.name).toBe("Renamed FC");
    // The narrow-route field keeps the value the card just saved, not a stale copy.
    expect(saved.team.parentsSee.planBeforeKickoff).toBe(true);
    expect(screen.getByDisplayValue("Renamed FC")).toBeTruthy();
  });

  it("an unsaved Team name edit is kept when a format chip or a rule switch is used", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Match format");
    fireEvent.change(teamNameInput(), { target: { value: "Renamed FC" } });

    fireEvent.click(screen.getByRole("button", { name: "9v9" }));
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy(), { timeout: 2500 });
    await screen.findByText("Saved");
    expect(screen.getByDisplayValue("Renamed FC")).toBeTruthy();

    const sw = screen.getByRole("switch", { name: "Keeper changes only at the break" });
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Keeper changes only at the break" }).getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByDisplayValue("Renamed FC")).toBeTruthy();
    expect(storage.set).not.toHaveBeenCalled();
  });
});

describe("Settings — match format number fields", () => {
  const fieldInput = (label) => screen.getByText(label).parentElement.querySelector("input");
  const settle = () => new Promise((r) => setTimeout(r, 800));

  it("typing a partial value sends nothing until the field is left, then clamps to the server's bounds", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) }); // U8 -> 40 minutes
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Match format");
    const inp = fieldInput("Game length (minutes)");
    expect(inp.value).toBe("40");
    fireEvent.focus(inp);
    fireEvent.change(inp, { target: { value: "5" } }); // on the way to "50"
    await settle();
    expect(callTo("/api/team-settings")).toBeUndefined();
    expect(inp.value).toBe("5"); // never rewritten under the cursor
    fireEvent.change(inp, { target: { value: "50" } });
    fireEvent.blur(inp);
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy(), { timeout: 2500 });
    expect(bodyOf("/api/team-settings").matchFormat.gameLength).toBe(50);
    await screen.findByText("Saved");
    expect(inp.value).toBe("50");
  });

  it("leaving the field on an out-of-range value clamps it client-side; Enter commits", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Match format");
    const inp = fieldInput("Sub interval (minutes)");
    expect(inp.value).toBe("10");
    fireEvent.focus(inp);
    fireEvent.change(inp, { target: { value: "1" } });
    fireEvent.keyDown(inp, { key: "Enter" });
    fireEvent.blur(inp); // jsdom's blur() doesn't dispatch the event
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy(), { timeout: 2500 });
    expect(bodyOf("/api/team-settings").matchFormat.subInterval).toBe(2);
    await waitFor(() => expect(inp.value).toBe("2"));
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("clearing the field and leaving it keeps the previous value and saves nothing", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Match format");
    const inp = fieldInput("Game length (minutes)");
    fireEvent.focus(inp);
    fireEvent.change(inp, { target: { value: "" } });
    await settle();
    expect(inp.value).toBe("");
    fireEvent.blur(inp);
    await settle();
    expect(callTo("/api/team-settings")).toBeUndefined();
    expect(inp.value).toBe("40");
  });
});

describe("Settings — match format autosave", () => {
  it("tapping 9v9 autosaves the team format with a keeper and a fitting home shape", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) }); // U8 -> 7v7 default
    render(<App />);
    await enterCoachMode();
    await openSettings();
    expect(await screen.findByText("Match format")).toBeTruthy();
    expect(screen.getByRole("button", { name: "7v7" }).className).toContain("act");
    fireEvent.click(screen.getByRole("button", { name: "9v9" }));
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy(), { timeout: 2500 });
    const body = bodyOf("/api/team-settings");
    expect(body.matchFormat.playersOnField).toBe(9);
    expect(body.matchFormat.hasGK).toBe(true);
    expect(body.matchFormat.formation).toBe("3-3-2");
    expect(body.parentsSee).toBeUndefined();
    expect(await screen.findByText("Saved")).toBeTruthy();
    // Home shape chips follow the new outfield count, current shape active, others carry a call when there is one.
    expect(screen.getByRole("button", { name: "3-3-2" }).className).toContain("act");
    expect(screen.getByRole("button", { name: "2-4-2 · Step up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3-2-3 · Push up" })).toBeTruthy();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("tapping a home-shape chip saves the new formation", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) }); // 7v7, 2-3-1 default
    render(<App />);
    await enterCoachMode();
    await openSettings();
    await screen.findByText("Home shape");
    fireEvent.click(screen.getByRole("button", { name: "3-2-1 · Drop in" }));
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy(), { timeout: 2500 });
    expect(bodyOf("/api/team-settings").matchFormat.formation).toBe("3-2-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "3-2-1" }).className).toContain("act"));
  });
});

describe("Settings — lineup rules", () => {
  it("lists the three seeded built-ins with 'Built in' tags and no delete buttons", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    expect(await screen.findByText("Lineup rules")).toBeTruthy();
    expect(screen.getAllByText("Built in")).toHaveLength(3);
    expect(screen.getByText("Everyone available plays in both halves")).toBeTruthy();
    expect(screen.getByText("Keeper changes only at the break")).toBeTruthy();
    expect(screen.getByText("Nobody plays a spot they're rated 0 in")).toBeTruthy();
    expect(screen.getByText("In priority order: an earlier rule beats a later one.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete rule/ })).toBeNull();
  });

  it("adds a custom rule with Enter and POSTs the full ordered list", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
    const inp = screen.getByPlaceholderText("e.g. Twins never on together");
    fireEvent.change(inp, { target: { value: "No twins on together" } });
    fireEvent.keyDown(inp, { key: "Enter" });
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy());
    const { rules } = bodyOf("/api/team-settings");
    expect(rules.map((r) => r.id).slice(0, 3)).toEqual(["bi-period", "bi-gk-break", "bi-rating-zero"]);
    expect(rules[3]).toMatchObject({ text: "No twins on together", builtin: false });
    // Rendered as rule 4 with a delete button; the input has closed.
    expect(await screen.findByText("No twins on together")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete rule: No twins on together" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("e.g. Twins never on together")).toBeNull();
  });

  it("switching a built-in off saves it with off:true", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    const sw = await screen.findByRole("switch", { name: "Keeper changes only at the break" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(callTo("/api/team-settings")).toBeTruthy());
    const { rules } = bodyOf("/api/team-settings");
    expect(rules.find((r) => r.id === "bi-gk-break").off).toBe(true);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Keeper changes only at the break" }).getAttribute("aria-checked")).toBe("false"));
  });
});

describe("Settings — lineup rules (cap and refusals)", () => {
  const twentyRules = () => [
    { id: "bi-period", text: "Everyone available plays in both halves", builtin: true },
    { id: "bi-gk-break", text: "Keeper changes only at the break", builtin: true },
    { id: "bi-rating-zero", text: "Nobody plays a spot they're rated 0 in", builtin: true },
    ...Array.from({ length: 17 }, (_, i) => ({ id: "r_" + i, text: "Custom rule " + (i + 1), builtin: false }))
  ];

  it("at 20 rules, 'Add a rule' is replaced by a note instead of silently dropping the 21st", async () => {
    stubNarrowRoutes();
    const data = makeData();
    data.team.rules = twentyRules();
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    expect(await screen.findByText("Custom rule 17")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a rule" })).toBeNull();
    expect(screen.getByText("Up to 20 rules. Remove one to add another.")).toBeTruthy();
    expect(callTo("/api/team-settings")).toBeUndefined();
  });

  it("shows the server's read-only message when a save is refused with 403", async () => {
    fetch.mockImplementation((url) => String(url).includes("/api/team-settings")
      ? Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "You're viewing as another user — read only. Exit view-as to make changes." }) })
      : Promise.resolve({ ok: false, json: async () => ({}) }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    const sw = await screen.findByRole("switch", { name: "Keeper changes only at the break" });
    fireEvent.click(sw);
    expect(await screen.findByText(/read only\. Exit view-as/)).toBeTruthy();
    // The optimistic change was rolled back.
    await waitFor(() => expect(screen.getByRole("switch", { name: "Keeper changes only at the break" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("shows the generic retry message for any other failure", async () => {
    fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "boom" }) }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    fireEvent.click(await screen.findByRole("switch", { name: "Keeper changes only at the break" }));
    expect(await screen.findByText("Couldn't save — try again.")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
  });
});

describe("Player screen — ratings", () => {
  // Squad row → the pushed Player screen (S5).
  const openPlayer = async () => {
    fireEvent.click(screen.getByText("Squad"));
    fireEvent.click(await screen.findByText("Sam Smith"));
    await waitFor(() => expect(headerTitle()).toBe("Sam Smith"));
  };

  it("coach taps the 4th MID pip: POSTs ratings to /api/player-coach and shows the number", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openPlayer();
    expect(await screen.findByText("Ratings")).toBeTruthy();
    expect(screen.getAllByText("Not rated")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "MID 4" }));
    await waitFor(() => expect(callTo("/api/player-coach")).toBeTruthy());
    const body = bodyOf("/api/player-coach");
    expect(body.playerId).toBe("p1");
    expect(body.ratings.MID).toBe(4);
    expect(body.note).toBeUndefined();
    expect(await screen.findByText("4")).toBeTruthy();
    expect(screen.getAllByText("Not rated")).toHaveLength(3);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("tapping the pip equal to the current rating sets it to 0", async () => {
    stubNarrowRoutes();
    const data = makeData();
    data.players[0].coach = { ratings: { GK: null, DEF: 2, MID: 3, FWD: 5 }, note: "" };
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await enterCoachMode();
    await openPlayer();
    await screen.findByText("Ratings");
    fireEvent.click(screen.getByRole("button", { name: "FWD 5" }));
    await waitFor(() => expect(callTo("/api/player-coach")).toBeTruthy());
    expect(bodyOf("/api/player-coach").ratings).toEqual({ GK: null, DEF: 2, MID: 3, FWD: 0 });
  });

  it("the coach note saves on blur", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openPlayer();
    const ta = await screen.findByLabelText("Coach note");
    fireEvent.change(ta, { target: { value: "Loves a long throw" } });
    fireEvent.blur(ta);
    await waitFor(() => expect(callTo("/api/player-coach")).toBeTruthy());
    expect(bodyOf("/api/player-coach")).toMatchObject({ playerId: "p1", note: "Loves a long throw" });
  });

  it("shows the Goals / Games / In goal tiles and the assists · minutes line from match records, and no Ratings card for a parent", async () => {
    const data = makeData();
    data.fixtures = [
      { id: "f1", status: "played", dateISO: "2026-05-02", opponent: "A", homeAway: "H", us: 1, them: 0, goals: [{ pid: "p1", n: 1 }], availability: {}, record: { savedAt: 1, minutes: [{ pid: "p1", min: 30 }] } },
      { id: "f2", status: "played", dateISO: "2026-05-09", opponent: "B", homeAway: "H", us: 0, them: 0, availability: {}, record: { savedAt: 1, minutes: [{ pid: "p1", min: 0 }] } },
      { id: "f3", status: "played", dateISO: "2026-05-16", opponent: "C", homeAway: "H", us: 0, them: 0, availability: {}, record: { savedAt: 1, minutes: [{ pid: "p1", min: 25.5 }] } }
    ];
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await waitForLoaded(); // view mode = parent
    await openPlayer();
    expect(await screen.findByText("Games")).toBeTruthy();
    const tiles = [...document.querySelectorAll(".ptiles .ptile")].map((t) => t.querySelector(".k").textContent + "=" + t.querySelector(".v").textContent);
    expect(tiles).toEqual(["Goals=1", "Games=2", "In goal=0"]);
    expect(document.querySelector(".pt-line").textContent).toBe("0 assists · 56 minutes");
    expect(screen.queryByText("Ratings")).toBeNull();
    expect(screen.queryByText("Coaches only")).toBeNull();
  });
});

/* ---------------- S1 shell: Direction C chrome ---------------- */

describe("S1 shell — header, nav, back stack, toast", () => {
  const navLabels = () => within(screen.getByRole("navigation")).getAllByRole("button").map((b) => b.textContent);
  const activeNav = () => document.querySelector(".nav button.active")?.textContent;
  const scrollTo = (y) => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
    fireEvent.scroll(window);
  };

  it("the nav has exactly Home, Calendar, Results, Squad and Ask — Duties, Stats and Settings are gone", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode(); // even a coach gets no Settings tab
    expect(navLabels()).toEqual(["Home", "Calendar", "Results", "Squad", "Ask"]);
    expect(activeNav()).toBe("Home");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("the root header shows crest, team name and kicker; the kicker hides after 24px of scroll and returns at the top", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    expect(document.querySelector(".head img.hcrest")).toBeTruthy();
    expect(headerTitle()).toBe("Test FC");
    expect(headerKicker()).toBe("Div 1 · U8");
    scrollTo(40);
    await waitFor(() => expect(headerKicker()).toBeUndefined());
    expect(headerTitle()).toBe("Test FC"); // the name stays
    scrollTo(0);
    await waitFor(() => expect(headerKicker()).toBe("Div 1 · U8"));
  });

  it("the Home duties strip pushes Duties (sub header + back button); Back pops it", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Duties" }));
    expect(await screen.findByText(/Two jobs each week/)).toBeTruthy(); // DutiesTab
    expect(headerTitle()).toBe("Duties");
    expect(headerKicker()).toBe("Fruit and goalkeeper rota");
    expect(document.querySelector(".head img.hcrest")).toBeNull();
    expect(activeNav()).toBe("Home"); // the root stays lit under a pushed screen
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Details")).toBeTruthy(); // the Next game card is back
    expect(headerTitle()).toBe("Test FC");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("'All stats' pushes Stats; tapping a nav tab clears the stack", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("All stats ›"));
    expect(await screen.findByText("Top scorers")).toBeTruthy();
    expect(headerTitle()).toBe("Stats");
    expect(headerKicker()).toBe("Season 2026");
    fireEvent.click(screen.getByText("Squad"));
    expect(await screen.findByText("Sam Smith")).toBeTruthy();
    expect(headerTitle()).toBe("Test FC");
    expect(activeNav()).toBe("Squad");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Team settings from the sheet pushes Settings titled with the team name; leaving coach mode drops it", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    await openSettings();
    expect(headerTitle()).toBe("Team settings");
    expect(headerKicker()).toBe("Test FC");
    await openChip();
    fireEvent.click(screen.getByText("Leave coach mode"));
    await expectChip("Parent");
    expect(headerTitle()).toBe("Test FC");
    expect(screen.queryByText("Team details")).toBeNull();
  });

  it("the nav slides away while the Ask input has focus and returns on blur", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode(); // legacy guests can't use Ask
    fireEvent.click(screen.getByText("Ask"));
    const input = await screen.findByPlaceholderText("Ask a question…");
    const nav = screen.getByRole("navigation");
    expect(nav.className).toBe("nav");
    fireEvent.focus(input);
    expect(nav.className).toBe("nav hide");
    fireEvent.blur(input);
    expect(nav.className).toBe("nav");
  });

  it("the chip reads Parent in the legacy view and Coach in coach mode", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await expectChip("Parent");
    await enterCoachMode();
    expect(chip().textContent).toBe("Coach");
  });

  it("every sheet gets the grabber; the old X close still works", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(await screen.findByText("Add fixture"));
    await screen.findByRole("button", { name: "Save fixture" });
    expect(document.querySelector(".sheet > .grab")).toBeTruthy();
    fireEvent.click(document.querySelector(".sheet .xbtn"));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
  });
});

describe("S2 Home — Direction C cards", () => {
  // Account mode with a working /api/rsvp (rsvpOk=false makes the route refuse).
  const meFetch = (me, rsvpOk = true) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (String(url).includes("/api/rsvp")) return Promise.resolve({ ok: rsvpOk, json: async () => ({ ok: rsvpOk }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const account = (role, playerIds = [], playerNames = [], extra = {}) => {
    const hat = { role, playerIds, playerNames, ...extra };
    return {
      mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role, playerIds, playerNames,
      hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: [], ...extra
    };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  const game = (over = {}) => ({ id: "f1", round: 7, status: "upcoming", dateISO: daysFromNow(7), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  const sheet = () => within(document.querySelector(".sheet"));
  const weekday = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long" });
  const rsvpBodies = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/rsvp")).map((c) => JSON.parse(c[1].body));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  it("next game: label, countdown, our ringed crest and an initials disc for an opponent without artwork", async () => {
    await load(makeData({ fixtures: [game()] }));
    expect(screen.getByText("Next game · Round 7 · Home")).toBeTruthy();
    expect(document.querySelector(".ng-cd").textContent).toMatch(/^\d+d \d+h$/);
    expect(document.querySelector(".mu-crest.ours").getAttribute("src")).toBe("/crests/olympic-fc.png");
    expect(document.querySelector(".mu-disc").textContent).toBe("W");
    expect(document.querySelector(".mu-time").textContent).toBe("09:00");
    const d = new Date(daysFromNow(7) + "T00:00:00");
    expect(document.querySelector(".mu-date").textContent).toBe(`${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "long" })}`);
    expect(screen.getByText("Perry Park")).toBeTruthy();
    fireEvent.click(screen.getByText("Details"));
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
  });

  it("an opponent in the crest registry gets its crest on the right, without the ring", async () => {
    await load(makeData({ fixtures: [game({ opponent: "Oxley United U8 Eagles", homeAway: "A" })] }));
    expect(screen.getByText("Next game · Round 7 · Away")).toBeTruthy();
    const imgs = document.querySelectorAll(".mu-crest");
    expect(imgs.length).toBe(2);
    expect(imgs[0].classList.contains("ours")).toBe(true);
    expect(imgs[1].getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(imgs[1].classList.contains("ours")).toBe(false);
    expect(document.querySelector(".mu-disc")).toBeNull();
  });

  it("a parent gets one reply row per own child; In posts /api/rsvp, toasts, flips the row to the In pill; In again clears", async () => {
    meFetch(account("parent", ["p1", "p2"], ["Sam Smith", "Alex Smith"]));
    await load(makeData({ players: kids, fixtures: [game()] }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Reply" }).length).toBe(2));
    expect(screen.getByText("Reply for Sam", { selector: ".rr-hint" })).toBeTruthy();
    expect(screen.getByText("Alex S.")).toBeTruthy();
    expect(screen.queryByText("Milo P.")).toBeNull(); // not this parent's child
    expect(screen.queryByText("Who's in ›")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Reply" })[0]);
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    expect(sheet().getByText(/vs Wests · .* · 09:00/)).toBeTruthy();
    expect(sheet().getByText(/Coach Byron sees replies straight away/)).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));

    expect(await screen.findByText(`Sam's in for ${weekday(daysFromNow(7))}`)).toBeTruthy();
    await waitFor(() => expect(rsvpBodies()[0]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: "in" }));
    expect(document.querySelector(".sheet")).toBeNull(); // the sheet closes on reply
    const row = screen.getByText("Sam S.").closest(".replyrow");
    expect(within(row).getByRole("button", { name: "In" }).classList.contains("in")).toBe(true);
    expect(within(row).getByText("Tap to change")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Reply" }).length).toBe(1); // Alex still to reply

    // Reopen from the pill: In is selected; tapping it again clears the reply.
    fireEvent.click(within(row).getByRole("button", { name: "In" }));
    const inBtn = await sheet().findByRole("button", { name: "In" });
    expect(inBtn.classList.contains("sel")).toBe(true);
    fireEvent.click(inBtn);
    expect(await screen.findByText("Sam's reply cleared")).toBeTruthy();
    await waitFor(() => expect(rsvpBodies()[1]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: null }));
    expect(screen.getAllByRole("button", { name: "Reply" }).length).toBe(2);
  });

  it("Out sends the note as the reason and shows the Out pill; a refused write reverts the row", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [game()] }));
    fireEvent.click(await screen.findByRole("button", { name: "Reply" }));
    fireEvent.change(await sheet().findByPlaceholderText("Add a note for coach (optional)"), { target: { value: "Grandma's 80th" } });
    fireEvent.click(sheet().getByRole("button", { name: "Out" }));
    expect(await screen.findByText(`Sam's out for ${weekday(daysFromNow(7))}`)).toBeTruthy();
    await waitFor(() => expect(rsvpBodies()[0]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: "out", reason: "Grandma's 80th" }));
    expect(screen.getByRole("button", { name: "Out" }).classList.contains("out")).toBe(true);

    // Now the route refuses: the optimistic Out is undone and the row goes back to Reply.
    meFetch(account("parent", ["p1"], ["Sam Smith"]), false);
    fireEvent.click(screen.getByRole("button", { name: "Out" }));
    fireEvent.click(await sheet().findByRole("button", { name: "In" }));
    expect(await screen.findByText("Couldn't save Sam's reply — try again.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Out" })).toBeTruthy()); // back to the last saved reply
    expect(rsvpBodies()[1]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: "in" });
  });

  it("a coach sees the counts pills and Who's in ›; the week row carries the tally", async () => {
    await load(makeData({ players: kids, fixtures: [game({ dateISO: daysFromNow(5), availability: { p1: { status: "in" }, p2: { status: "out" } } })] }));
    await enterCoachMode();
    expect(screen.getByText("1 in")).toBeTruthy();
    expect(screen.getByText("1 out")).toBeTruthy();
    expect(screen.getByText("1 no reply")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.getByText("1 in · 1 to reply", { selector: ".wk-pill" })).toBeTruthy();
    fireEvent.click(screen.getByText("Who's in ›"));
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
  });

  it("a view-only account gets the counts only — no Reply, no Who's in", async () => {
    meFetch(account("viewer", [], [], { clubAdmin: true }));
    await load(makeData({ fixtures: [game()] }));
    await expectChip("Club admin (view only)");
    expect(screen.getByText("0 in")).toBeTruthy();
    expect(screen.getByText("1 no reply")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByText("Who's in ›")).toBeNull();
  });

  it("duties card: the family for fruit, the player in goal, 'Not assigned yet' otherwise; tapping pushes Duties", async () => {
    await load(makeData({ players: kids, fixtures: [game({ fruit: "p1", gk: "p3" })] }));
    const card = screen.getByRole("button", { name: "Duties" });
    expect(within(card).getByText("Fruit duty")).toBeTruthy();
    expect(within(card).getByText("Sam S.'s family")).toBeTruthy();
    expect(within(card).getByText("In goal")).toBeTruthy();
    expect(within(card).getByText("Milo P.")).toBeTruthy();
    expect(within(card).queryByText("Sam Smith")).toBeNull();
    expect(within(card).queryByText("—")).toBeNull();
    fireEvent.click(card);
    expect(await screen.findByText(/Two jobs each week/)).toBeTruthy();
    expect(headerTitle()).toBe("Duties");
    cleanup();
    await load(makeData({ players: kids, fixtures: [game()] }));
    const empty = screen.getByRole("button", { name: "Duties" });
    expect(within(empty).getAllByText("Not assigned yet")).toHaveLength(2);
  });

  it("next 7 days lists training and the game with the parent's pills; the training row opens the session sheet", async () => {
    const trainISO = daysFromNow(2);
    const session = {
      id: "s1", title: "Training", kind: "training", recur: "weekly", weekday: new Date(trainISO + "T00:00:00").getDay(),
      startISO: daysFromNow(-30), untilISO: daysFromNow(60), time: "16:30", location: "JF O'Grady",
      availability: { [trainISO]: { p1: { status: "out", reason: "Sick" } } }
    };
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ players: kids, fixtures: [game({ dateISO: daysFromNow(5), availability: { p1: { status: "in" } } })], sessions: [session] }));
    await screen.findByText("Sam's in", { selector: ".wk-pill" });
    const rows = document.querySelectorAll(".wk-row");
    expect(rows.length).toBe(2);
    const td = new Date(trainISO + "T00:00:00");
    expect(rows[0].querySelector(".wk-dow").textContent).toBe(DOW[td.getDay()]);
    expect(rows[0].querySelector(".wk-num").textContent).toBe(String(td.getDate()));
    expect(rows[0].querySelector(".wk-ic").classList.contains("training")).toBe(true);
    expect(within(rows[0]).getByText("Training")).toBeTruthy();
    expect(within(rows[0]).getByText("16:30 · JF O'Grady")).toBeTruthy();
    expect(within(rows[0]).getByText("Sam's out").classList.contains("out")).toBe(true);
    expect(rows[1].querySelector(".wk-ic").classList.contains("game")).toBe(true);
    expect(within(rows[1]).getByText("vs Wests")).toBeTruthy();
    expect(within(rows[1]).getByText("09:00 · Perry Park")).toBeTruthy();
    expect(within(rows[1]).getByText("Sam's in").classList.contains("in")).toBe(true);
    fireEvent.click(rows[0]);
    expect(await screen.findByText("Training", { selector: ".sheet h2" })).toBeTruthy();
  });

  it("a parent who hasn't replied sees 'No reply' on the game row; Calendar › switches tab", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ fixtures: [game({ dateISO: daysFromNow(3) })] }));
    expect(await screen.findByText("No reply", { selector: ".wk-pill" })).toBeTruthy();
    fireEvent.click(screen.getByText("Calendar ›"));
    expect(document.querySelector(".nav button.active").textContent).toBe("Calendar");
  });

  it("season so far: tiles, form pips and for/against from played fixtures, with the MiniRoos footnote at U8", async () => {
    await load(makeData({ fixtures: [
      game(),
      { id: "f5", round: 5, status: "played", dateISO: daysFromNow(-14), time: "09:00", opponent: "Rovers", homeAway: "A", venue: "X", us: 1, them: 1 },
      { id: "f6", round: 6, status: "played", dateISO: daysFromNow(-7), time: "09:00", opponent: "United", homeAway: "H", venue: "X", us: 3, them: 1 }
    ] }));
    expect([...document.querySelectorAll(".tile")].map((t) => t.textContent)).toEqual(["2Played", "1Won", "1Drawn", "4Pts"]);
    expect(document.querySelector(".tile.pts .v").textContent).toBe("4");
    expect([...document.querySelectorAll(".pip")].map((p) => p.textContent + ":" + p.className)).toEqual(["D:pip D", "W:pip W"]);
    expect(screen.getByText("4 for · 2 against")).toBeTruthy();
    expect(screen.getByText("MiniRoos doesn't publish ladders at U8 — these are just our own numbers.")).toBeTruthy();
    expect(screen.getByText("All stats ›")).toBeTruthy(); // the push itself is covered by the S1 shell tests
  });

  it("no ladder footnote outside MiniRoos ages", async () => {
    const data = makeData({ fixtures: [game()] });
    data.team.ageGroup = "U12";
    await load(data);
    expect(screen.queryByText(/MiniRoos doesn't publish ladders/)).toBeNull();
    expect(screen.getByText("0 for · 0 against")).toBeTruthy();
  });

  it("birthdays coming up from a dob within the week, and the same birthday on the Next 7 days list", async () => {
    const iso = daysFromNow(3);
    const y = +iso.slice(0, 4);
    await load(makeData({ players: [{ id: "p1", name: "Sam Smith", number: 7, position: "FWD", dob: `${y - 8}${iso.slice(4)}` }], fixtures: [] }));
    expect(screen.getByText("Birthdays coming up")).toBeTruthy();
    expect(screen.getAllByText("Sam S. turns 8").length).toBe(2); // card row + week row
    const d = new Date(iso + "T00:00:00");
    expect(screen.getByText(`${DOW[d.getDay()]}, ${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "long" })}`)).toBeTruthy();
    expect(screen.getByText("Birthday", { selector: ".wk-meta" })).toBeTruthy();
    expect(document.querySelector(".wk-row .wk-ic").classList.contains("birthday")).toBe(true);
    expect(document.querySelector(".wk-pill")).toBeNull(); // birthdays carry no status pill
    expect(document.body.textContent).not.toMatch(/🎂/);
  });

  it("an empty club shows the empty next-game card and nothing else it can't back up", async () => {
    await load(makeData({ fixtures: [] }));
    expect(screen.getByText("No upcoming match")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duties" })).toBeNull();
    expect(screen.queryByText("Birthdays coming up")).toBeNull();
    expect(screen.getByText("Nothing in the next 7 days. Enjoy the rest.")).toBeTruthy();
    expect(screen.getByText("Season so far")).toBeTruthy();
    fireEvent.click(screen.getByText("Duties ›"));
    expect(await screen.findByText(/Two jobs each week/)).toBeTruthy();
    expect(screen.getByText("No games on the calendar yet.")).toBeTruthy();
  });
});

describe("S3 Results + Match detail", () => {
  const meFetch = (me, rsvpOk = true) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (String(url).includes("/api/rsvp")) return Promise.resolve({ ok: rsvpOk, json: async () => ({ ok: rsvpOk }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const parentOf = (playerIds, playerNames) => {
    const hat = { role: "parent", playerIds, playerNames };
    return { mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role: "parent", playerIds, playerNames, hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: [] };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  const played = (over = {}) => ({ id: "r5", round: 5, status: "played", dateISO: daysFromNow(-14), time: "09:00", opponent: "Rovers", homeAway: "H", venue: "Perry Park", us: 3, them: 1, availability: {}, ...over });
  const game = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: daysFromNow(6), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  const toResults = () => fireEvent.click(within(screen.getByRole("navigation")).getByText("Results"));
  const rows = () => [...document.querySelectorAll(".mrow")];
  const card = (label) => screen.getByText(label, { selector: ".label" }).closest(".card");
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  it("season so far: last-5 form pips and the W–D–L line, with the All stats link", async () => {
    await load(makeData({ fixtures: [game(), played(), played({ id: "r6", round: 6, dateISO: daysFromNow(-7), us: 1, them: 1 }), played({ id: "r4", round: 4, dateISO: daysFromNow(-21), us: 0, them: 2 })] }));
    toResults();
    const season = card("Season so far");
    expect(season.className).toBe("card season-mini");
    expect([...season.querySelectorAll(".pip")].map((p) => p.textContent + ":" + p.className)).toEqual(["L:pip lg L", "W:pip lg W", "D:pip lg D"]);
    expect(season.querySelector(".wdl .v").textContent).toBe("1–1–1");
    expect(season.querySelector(".wdl .k").textContent).toBe("W · D · L");
    expect(within(season).getByText("All stats ›").className).toBe("ghostlink"); // the push itself is covered by the S1 shell tests
  });

  it("no played games: no pips and 0–0–0; empty Results and Fixtures cards say so", async () => {
    await load(makeData({ fixtures: [] }));
    toResults();
    expect(document.querySelector(".pip")).toBeNull();
    expect(document.querySelector(".wdl .v").textContent).toBe("0–0–0");
    expect(within(card("Results")).getByText("No results yet.")).toBeTruthy();
    expect(within(card("Fixtures")).getByText("No fixtures yet.")).toBeTruthy();
  });

  it("splits past games into Results and upcoming into Fixtures, each ascending by round; a cancelled game follows its date", async () => {
    await load(makeData({ fixtures: [
      game({ id: "f9", round: 9, dateISO: daysFromNow(20) }),
      played({ id: "r6", round: 6, dateISO: daysFromNow(-7), us: 1, them: 2 }),
      game(),
      played(),
      { id: "c8", round: 8, status: "cancelled", dateISO: daysFromNow(13), opponent: "Lions", homeAway: "A", availability: {} },
      { id: "c3", round: 3, status: "cancelled", dateISO: daysFromNow(-28), opponent: "United", homeAway: "H", availability: {} }
    ] }));
    toResults();
    const roundsIn = (label) => [...card(label).querySelectorAll(".mr-round .r")].map((r) => r.textContent);
    expect(roundsIn("Results")).toEqual(["3", "5", "6"]);
    expect(roundsIn("Fixtures")).toEqual(["7", "8", "9"]);
    // Score colouring by our result, the date in the round column, and cancelled rows dimmed.
    const results = card("Results");
    expect(within(results).getByText("3–1").className).toBe("mscore win");
    expect(within(results).getByText("1–2").className).toBe("mscore loss");
    expect(results.querySelectorAll(".mrow.canc")).toHaveLength(1);
    expect(card("Fixtures").querySelectorAll(".mrow.canc")).toHaveLength(1);
    const d = new Date(daysFromNow(-14) + "T00:00:00");
    expect(within(results).getByText(`${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "short" })}`)).toBeTruthy();
  });

  it("a draw is grey; the away side flips with the ring on our side", async () => {
    await load(makeData({ fixtures: [played({ homeAway: "A", us: 2, them: 2 })] }));
    toResults();
    const row = rows()[0];
    expect(row.querySelector(".mscore").className).toBe("mscore draw");
    expect([...row.querySelectorAll(".mr-name")].map((n) => n.textContent)).toEqual(["Rovers", "Test FC"]);
    expect(row.querySelector(".mr-side.away.ours img.mcrest.ours").getAttribute("src")).toBe("/crests/olympic-fc.png");
  });

  it("the MiniRoos footnote shows at U6–U9 only", async () => {
    const data = makeData({ fixtures: [game()] });
    await load(data);
    toResults();
    expect(screen.getByText("MiniRoos doesn't publish ladders at U8 — results only help grade the leagues. These are just our own numbers.").className).toBe("footnote res-foot");
    cleanup();
    const older = makeData({ fixtures: [game()] });
    older.team.ageGroup = "U12";
    await load(older);
    toResults();
    expect(screen.queryByText(/MiniRoos doesn't publish ladders/)).toBeNull();
  });

  it("tapping a row pushes Match detail (Round title, opponent + date kicker); Back returns to Results", async () => {
    await load(makeData({ fixtures: [game()] }));
    toResults();
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
    expect(headerKicker()).toBe(`vs Wests · ${fmt(daysFromNow(6))}`);
    expect(document.querySelector(".nav button.active").textContent).toBe("Results");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    expect(rows()).toHaveLength(1);
  });

  it("hero, played: red label, score in the win colour with 'Win', Directions link, no kit or arrive pills, focus reads 'Focus that week'", async () => {
    await load(makeData({ fixtures: [played({ strip: "Red", focusTitle: "Passing", focusQuestion: "Can you pass safely", focusPoints: "Look before you pass\nPlay to a teammate" })] }));
    toResults();
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 5"));
    expect(document.querySelector(".mh-label").textContent).toBe(`Round 5 · Home · ${fmt(daysFromNow(-14))}`);
    expect(document.querySelector(".mu-big").textContent).toBe("3–1");
    expect(document.querySelector(".mu-big").className).toBe("mu-big win");
    expect(document.querySelector(".mu-sub").textContent).toBe("Win");
    expect(document.querySelector(".mu-crest.ours")).toBeTruthy();
    expect(document.querySelector(".mu-disc").textContent).toBe("R");
    const dir = screen.getByRole("link", { name: "Directions" });
    expect(dir.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=Perry%20Park");
    expect(dir.getAttribute("target")).toBe("_blank");
    expect(document.querySelector(".mpills")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull(); // parent view
    expect(screen.queryByText("Who's in")).toBeNull(); // played
    expect(screen.getByText("Focus that week")).toBeTruthy();
    expect(screen.getByText("Passing").className).toBe("fc-title");
    expect(screen.getByText("Can you pass safely").className).toBe("fc-q");
    expect(document.querySelectorAll(".fc-pt")).toHaveLength(2);
    expect(screen.getByText(/One thing for the kids to think about on .* — Coach Byron/)).toBeTruthy();
  });

  it("hero, upcoming: kick-off in red with the date under it, kit and Arrive pills, the duties card and 'This week's focus'", async () => {
    await load(makeData({ players: kids, fixtures: [game({ strip: "Blue", fruit: "p2", focusTitle: "Dribbling" })] }));
    toResults();
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
    expect(document.querySelector(".mu-big").textContent).toBe("09:00");
    expect(document.querySelector(".mu-big").className).toBe("mu-big");
    const d = new Date(daysFromNow(6) + "T00:00:00");
    expect(document.querySelector(".mu-sub").textContent).toBe(`${DOW[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "long" })}`);
    expect(document.querySelector(".mu-sub").className).toBe("mu-sub up");
    expect(screen.getByText("Blue kit").className).toBe("mpill kit");
    expect(screen.getByText("Arrive 08:30").className).toBe("mpill");
    const duties = screen.getByRole("button", { name: "Duties" });
    expect(within(duties).getByText("Alex S.'s family")).toBeTruthy();
    expect(within(duties).getByText("Not assigned yet")).toBeTruthy();
    expect(screen.getByText("This week's focus")).toBeTruthy();
    fireEvent.click(duties);
    expect(await screen.findByText(/Two jobs each week/)).toBeTruthy();
  });

  it("cancelled hero reads 'Cancelled' / 'Called off' in red, with no Who's in, duties or Match day card", async () => {
    await load(makeData({ players: kids, fixtures: [
      { id: "c1", round: 1, status: "cancelled", dateISO: daysFromNow(6), time: "09:00", opponent: "A", homeAway: "H", fruit: "p1", availability: {} }
    ] }));
    await enterCoachMode();
    toResults();
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 1"));
    expect(document.querySelector(".mu-big").textContent).toBe("Cancelled");
    expect(document.querySelector(".mu-big").className).toBe("mu-big loss");
    expect(document.querySelector(".mu-sub").textContent).toBe("Called off");
    expect(screen.queryByText("Who's in")).toBeNull();
    expect(screen.queryByRole("button", { name: "Duties" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Match day" })).toBeNull();
    expect(document.querySelector(".mpills")).toBeNull();
  });

  it("no-score hero reads '–' / 'No score'", async () => {
    await load(makeData({ fixtures: [{ id: "n2", round: 2, status: "played", dateISO: daysFromNow(-20), time: "09:00", opponent: "B", homeAway: "H", us: null, them: null, availability: {} }] }));
    toResults();
    fireEvent.click(rows()[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 2"));
    expect(document.querySelector(".mu-big").textContent).toBe("–");
    expect(document.querySelector(".mu-big").className).toBe("mu-big none");
    expect(document.querySelector(".mu-sub").textContent).toBe("No score");
  });

  it("goals: one row per scorer with the goal count; tapping pushes the Player screen; no scorers gets the quiet card", async () => {
    await load(makeData({ players: kids, fixtures: [played({ goals: [{ pid: "p1", n: 2 }, { pid: "p3", n: 1 }] })] }));
    toResults();
    fireEvent.click(rows()[0]);
    const goals = (await screen.findByText("Goals", { selector: ".label" })).closest(".card");
    const gr = goals.querySelectorAll(".goalrow");
    expect(gr).toHaveLength(2);
    expect(gr[0].querySelector(".gr-disc").textContent).toBe("SS");
    expect(gr[0].querySelector(".gr-name").textContent).toBe("Sam Smith");
    expect(gr[0].querySelector(".gr-n").textContent).toBe("2 goals");
    expect(gr[1].querySelector(".gr-n").textContent).toBe("1 goal");
    expect(screen.queryByText("No scorers recorded for this one.")).toBeNull();
    fireEvent.click(gr[0]);
    await waitFor(() => expect(headerTitle()).toBe("Sam Smith"));
    expect(headerKicker()).toBe("#7 · FWD");
    expect(document.querySelector(".sheet")).toBeNull();
    cleanup();
    await load(makeData({ players: kids, fixtures: [played({ goals: [] })] }));
    toResults();
    fireEvent.click(rows()[0]);
    expect((await screen.findByText("No scorers recorded for this one.")).className).toBe("card quiet");
  });

  it("who's in: counts line, a parent's reply row opens the reply sheet and the In lands on the row; See everyone's replies pushes Who's in", async () => {
    meFetch(parentOf(["p1"], ["Sam Smith"]));
    await load(makeData({ players: kids, fixtures: [game({ availability: { p2: { status: "in" }, p3: { status: "out", reason: "Sick" } } })] }));
    toResults();
    fireEvent.click(rows()[0]);
    const who = (await screen.findByText("Who's in", { selector: ".label" })).closest(".card");
    expect(who.querySelector(".wi-count").textContent).toBe("1 in · 1 out · 1 no reply");
    expect(within(who).getByText("Sam S.")).toBeTruthy();
    expect(within(who).queryByText("Alex S.")).toBeNull();
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    fireEvent.click(within(who).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    fireEvent.click(within(document.querySelector(".sheet")).getByRole("button", { name: "In" }));
    await waitFor(() => expect(within(who).getByRole("button", { name: "In" }).className).toBe("rr-btn in"));
    expect(who.querySelector(".wi-count").textContent).toBe("2 in · 1 out · 0 no reply");
    fireEvent.click(within(who).getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(headerKicker()).toBe(`Round 7 vs Wests · ${fmt(daysFromNow(6))} 09:00`);
    // Only Sam's row is editable here; the others are pills.
    expect(screen.getAllByRole("button", { name: "In" })).toHaveLength(1);
    expect(screen.getByText("Milo Park").closest(".av-row").querySelector(".st-pill").textContent).toBe("Sick");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
  });

  it("a legacy guest gets 'Sign in to respond' on Match detail, which opens the who's-responding sheet", async () => {
    await load(makeData({ players: kids, fixtures: [game()] }));
    toResults();
    fireEvent.click(rows()[0]);
    fireEvent.click(await screen.findByText("Sign in to respond"));
    expect(await screen.findByText("Who's responding?")).toBeTruthy();
  });

  it("coach: Edit opens the fixture editor; Delete fixture removes it and pops back to Results", async () => {
    await load(makeData({ fixtures: [game(), played()] }));
    await enterCoachMode();
    toResults();
    expect(rows()).toHaveLength(2);
    fireEvent.click(rows()[1]); // the upcoming game, in the Fixtures card
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
    expect(document.querySelector(".mh-edit").textContent).toBe("Edit");
    expect(screen.getByText("No match video linked yet. Add one with Edit.").className).toBe("card quiet");
    fireEvent.click(screen.getByText("Edit"));
    expect(await screen.findByText("Edit fixture")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete fixture" }));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    const saved = JSON.parse(storage.set.mock.calls.at(-1)[1]);
    expect(saved.fixtures.map((f) => f.id)).toEqual(["r5"]);
    expect(saved.isSample).toBe(false);
    await waitFor(() => expect(headerTitle()).toBe("Test FC")); // the match screen popped itself
    expect(document.querySelector(".sheet")).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(within(card("Fixtures")).getByText("No fixtures yet.")).toBeTruthy();
  });

  it("a Veo link is a link card that opens in a new tab; YouTube embeds inside a Match video card with chapter chips", async () => {
    await load(makeData({ fixtures: [played({ video: "https://app.veo.co/matches/abc" })] }));
    toResults();
    fireEvent.click(rows()[0]);
    const link = (await screen.findByText("Match video")).closest("a");
    expect(link.className).toBe("card linkcard");
    expect(link.getAttribute("href")).toBe("https://app.veo.co/matches/abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(link).getByText("Watch on Veo")).toBeTruthy();
    expect(document.querySelector(".vidwrap")).toBeNull();
    cleanup();
    await load(makeData({ fixtures: [played({ video: "https://youtu.be/dQw4w9WgXcQ", chapters: [{ label: "Kick-off", t: 0 }, { label: "2nd half", t: 1500 }] })] }));
    toResults();
    fireEvent.click(rows()[0]);
    const vid = (await screen.findByText("Match video", { selector: ".label" })).closest(".card");
    expect(vid.querySelector(".vidwrap iframe").getAttribute("src")).toContain("youtube.com/embed/dQw4w9WgXcQ");
    fireEvent.click(within(vid).getByText("2nd half"));
    await waitFor(() => expect(vid.querySelector("iframe").getAttribute("src")).toContain("start=1500"));
    expect(screen.queryByText(/No match video linked yet/)).toBeNull(); // parent, and there is a video
  });

  it("parents see nothing for a missing video; the schedule-changed card is a plain card with a coach Dismiss", async () => {
    const f = game({ schedChanges: [{ field: "Time", oldText: "09:00", newText: "10:30", at: Date.now() }] });
    await load(makeData({ fixtures: [f] }));
    toResults();
    fireEvent.click(rows()[0]);
    const chg = (await screen.findByText("Schedule changed")).closest(".card");
    expect(within(chg).getByText("10:30").className).toBe("chg-new");
    expect(screen.queryByText(/No match video linked yet/)).toBeNull();
    expect(screen.queryByText("Dismiss")).toBeNull();
    expect(document.body.textContent).not.toMatch(/⚠/);
  });

  it("the Match detail header falls back to 'Match' without a round, and Calendar day rows push the same screen", async () => {
    await load(makeData({ fixtures: [game({ round: undefined })] }));
    fireEvent.click(screen.getByText("Details"));
    await waitFor(() => expect(headerTitle()).toBe("Match"));
    expect(document.querySelector(".mh-label").textContent).toBe(`Home · ${fmt(daysFromNow(6))}`);
  });
});

describe("S4 Calendar — Direction C", () => {
  // Everything is relative to the month the suite runs in: the grid shows the
  // current month first, and "the other month" is the next one (previous in December).
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  const todayISO = isoLocal(today);
  const other = m === 11 ? 10 : m + 1;
  const mm = (mo) => String(mo + 1).padStart(2, "0");
  const monthName = (mo) => new Date(y, mo, 1).toLocaleDateString("en-AU", { month: "long" });
  const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // First day of this month falling on `weekday`.
  const firstOn = (weekday) => 1 + ((weekday - new Date(y, m, 1).getDay() + 7) % 7);

  const meFetch = (me, feedUrl) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (feedUrl && String(url).includes("/api/feedinfo")) return Promise.resolve({ ok: true, json: async () => ({ feedUrl }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const parentOf = (playerIds, playerNames) => {
    const hat = { role: "parent", playerIds, playerNames };
    return { mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role: "parent", playerIds, playerNames, hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: [] };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  const game = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: todayISO, time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const training = (over = {}) => ({ id: "s1", title: "Training", kind: "training", recur: "weekly", weekday: today.getDay(), startISO: daysFromNow(-60), untilISO: daysFromNow(60), time: "16:30", location: "JF O'Grady", availability: {}, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  const toCalendar = () => fireEvent.click(within(screen.getByRole("navigation")).getByText("Calendar"));
  const toOther = () => fireEvent.click(screen.getByRole("button", { name: m === 11 ? "Previous month" : "Next month" }));
  const cells = () => [...document.querySelectorAll(".cal-cell")];
  const cellFor = (day) => cells()[day - 1];
  const listCard = () => within(document.querySelector(".callist"));
  const sheet = () => document.querySelector(".sheet");

  it("the header kicker reads the shown month on Calendar and returns to division · age group on Home", async () => {
    await load(makeData());
    toCalendar();
    expect(headerKicker()).toBe(`${monthName(m)} ${SEASON}`);
    expect(screen.getByText(`${monthName(m)} ${SEASON}`, { selector: ".cg-month" })).toBeTruthy();
    toOther();
    expect(headerKicker()).toBe(`${monthName(other)} ${SEASON}`);
    fireEvent.click(within(screen.getByRole("navigation")).getByText("Home"));
    expect(headerKicker()).toBe("Div 1 · U8");
  });

  it("the grid is Monday-first with the right leading blanks; today is red-tinted once another day is selected; the old grid is gone", async () => {
    await load(makeData({ fixtures: [] }));
    toCalendar();
    expect([...document.querySelectorAll(".cg-dow span")].map((s) => s.textContent)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(document.querySelectorAll(".cal-blank").length).toBe((new Date(y, m, 1).getDay() + 6) % 7);
    expect(cells().length).toBe(daysInMonth);
    expect(cells()[0].querySelector(".n").textContent).toBe("1");
    expect(cells().every((c) => c.tagName === "BUTTON")).toBe(true);
    // Today starts selected (selected wins over today).
    const todayCell = cellFor(today.getDate());
    expect(todayCell.classList.contains("sel")).toBe(true);
    expect(todayCell.classList.contains("today")).toBe(false);
    // Tapping an empty day just selects it — no sheet.
    const otherDay = today.getDate() === 1 ? 2 : 1;
    fireEvent.click(cellFor(otherDay));
    expect(cellFor(otherDay).classList.contains("sel")).toBe(true);
    expect(todayCell.classList.contains("today")).toBe(true);
    expect(todayCell.classList.contains("sel")).toBe(false);
    expect(sheet()).toBeNull();
    expect(document.querySelector(".daycell, .grid7, .agitem, .addfab")).toBeNull();
    expect(screen.queryByText("Nothing scheduled this day.")).toBeNull();
  });

  it("a game day shows the opponent's 22px registry crest; an unknown club gets an initials disc", async () => {
    await load(makeData({ fixtures: [game({ opponent: "Oxley United U8 Eagles" }), game({ id: "f8", round: 8, opponent: "Wests", dateISO: `${y}-${mm(m)}-${String(today.getDate() === 1 ? 2 : 1).padStart(2, "0")}` })] }));
    toCalendar();
    const img = cellFor(today.getDate()).querySelector("img.cal-crest");
    expect(img.getAttribute("src")).toBe("/crests/oxley-united.png");
    expect(cellFor(today.getDate()).querySelector(".cal-dot")).toBeNull();
    const disc = cellFor(today.getDate() === 1 ? 2 : 1).querySelector(".cal-crest.ph");
    expect(disc.textContent).toBe("W");
    expect([...document.querySelectorAll("img.cal-crest")].every((i) => i.getAttribute("src").startsWith("/crests/"))).toBe(true); // registry files, never a hotlink
  });

  it("training and birthday dots, one per cell (birthday beats training); the legend shows Event only when an event exists", async () => {
    const trWeekday = (today.getDay() + 1) % 7;
    const bdayDay = firstOn(trWeekday); // a training day, so the birthday dot wins there
    const data = makeData({
      players: [{ ...kids[0], dob: `${y - 8}-${mm(m)}-${String(bdayDay).padStart(2, "0")}` }],
      fixtures: [],
      sessions: [training({ weekday: trWeekday })]
    });
    await load(data);
    toCalendar();
    expect(cellFor(bdayDay).querySelectorAll(".cal-dot").length).toBe(1);
    expect(cellFor(bdayDay).querySelector(".cal-dot").classList.contains("birthday")).toBe(true);
    const nextTraining = bdayDay + 7 <= daysInMonth ? bdayDay + 7 : bdayDay - 7;
    expect(cellFor(nextTraining).querySelector(".cal-dot.training")).toBeTruthy();
    expect([...document.querySelectorAll(".cg-legend span > span, .cg-legend span > img")].length).toBe(3);
    expect(document.querySelector(".cg-legend").textContent).toBe("GameTrainingBirthday");
    expect(document.querySelector(".cg-legend img").getAttribute("src")).toBe("/crests/olympic-fc.png");
    cleanup();
    const eventDay = firstOn((trWeekday + 1) % 7); // neither a training day nor the birthday
    await load({ ...data, sessions: [...data.sessions, { id: "e1", title: "Team photo", kind: "event", dateISO: `${y}-${mm(m)}-${String(eventDay).padStart(2, "0")}`, time: "10:00", location: "Clubhouse" }] });
    toCalendar();
    expect(document.querySelector(".cg-legend").textContent).toBe("GameTrainingBirthdayEvent");
    expect(cellFor(eventDay).querySelector(".cal-dot.event")).toBeTruthy();
  });

  it("tapping a day with items opens the day sheet (title, rows without the day column); a game row there pushes Match detail", async () => {
    await load(makeData({ players: kids, fixtures: [game({ opponent: "Oxley United U8 Eagles" })], sessions: [training()] }));
    toCalendar();
    fireEvent.click(cellFor(today.getDate()));
    expect(await screen.findByText(`${FULL[today.getDay()]} ${today.getDate()} ${monthName(m)}`, { selector: ".day-title" })).toBeTruthy();
    const rows = sheet().querySelectorAll(".wk-row");
    expect(rows.length).toBe(2);
    expect(sheet().querySelector(".wk-day")).toBeNull();
    expect(within(rows[0]).getByText("vs Oxley United U8 Eagles")).toBeTruthy();
    expect(within(rows[0]).getByText("09:00 · Perry Park")).toBeTruthy();
    expect(within(rows[1]).getByText("Training")).toBeTruthy();
    expect(within(rows[1]).getByText("0 in · 3 to reply").classList.contains("wk-pill")).toBe(true);
    fireEvent.click(rows[0]);
    await waitFor(() => expect(headerTitle()).toBe("Round 7"));
    expect(sheet()).toBeNull();
  });

  it("a training row in the day sheet opens the session sheet", async () => {
    await load(makeData({ players: kids, fixtures: [], sessions: [training()] }));
    toCalendar();
    fireEvent.click(cellFor(today.getDate()));
    fireEvent.click(await screen.findByText("Training", { selector: ".sheet .wk-title" }));
    expect(await screen.findByText("Training", { selector: ".sheet h2" })).toBeTruthy();
  });

  it("list card: 'Coming up in {Month}' for this month (from today), '{Month}' after navigating, calm empty copy; a birthday row has no emoji and opens the player", async () => {
    const data = makeData({
      players: [{ ...kids[0], dob: `${y - 8}-${mm(other)}-15` }],
      fixtures: [game(), game({ id: "old", round: 6, dateISO: `${y}-${mm(m)}-${String(today.getDate() === 1 ? 2 : 1).padStart(2, "0")}`, opponent: "Rovers" })]
    });
    await load(data);
    toCalendar();
    expect(listCard().getByText(`Coming up in ${monthName(m)}`).className).toBe("label");
    const past = today.getDate() > 1;
    expect(listCard().queryByText("vs Rovers")).toBe(past ? null : listCard().getByText("vs Rovers"));
    expect(listCard().getByText("vs Wests")).toBeTruthy();
    toOther();
    expect(listCard().getByText(monthName(other)).className).toBe("label");
    expect(listCard().getByText("Sam S. turns 8").className).toBe("wk-title");
    expect(listCard().getByText("Birthday").className).toBe("wk-meta");
    expect(document.body.textContent).not.toMatch(/🎂/);
    fireEvent.click(listCard().getByText("Sam S. turns 8"));
    await waitFor(() => expect(headerTitle()).toBe("Sam Smith"));
    expect(document.querySelector(".ph-name").textContent).toBe("Sam Smith");
    // A month with nothing in it.
    cleanup();
    await load(makeData({ fixtures: [] }));
    toCalendar();
    toOther();
    expect(listCard().getByText(`Nothing scheduled in ${monthName(other)}.`).className).toBe("wk-empty");
    expect(screen.queryByText("Nothing on this day. Enjoy the rest.")).toBeNull();
  });

  it("rows carry the parent's own-child pill for a game and a training occurrence", async () => {
    meFetch(parentOf(["p1"], ["Sam Smith"]));
    // The session ends today so the list has exactly one training occurrence.
    await load(makeData({ players: kids, fixtures: [game({ availability: { p1: { status: "in" } } })], sessions: [training({ untilISO: todayISO, availability: { [todayISO]: { p1: { status: "out", reason: "Sick" } } } })] }));
    toCalendar();
    const rows = await waitFor(() => { const r = document.querySelectorAll(".callist .wk-row"); expect(r.length).toBe(2); return r; });
    expect(within(rows[0]).getByText("vs Wests")).toBeTruthy();
    expect(within(rows[0]).getByText("Sam's in").classList.contains("in")).toBe(true);
    expect(within(rows[1]).getByText("Training")).toBeTruthy();
    expect(within(rows[1]).getByText("Sam's out").classList.contains("out")).toBe(true);
    expect(rows[0].querySelector(".wk-dow").textContent).toBe(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][today.getDay()]);
    expect(rows[0].querySelector(".wk-num").textContent).toBe(String(today.getDate()));
    expect(screen.queryByText("Add training / activity")).toBeNull(); // parents don't add sessions
  });

  it("the coach sees the counts pill on both rows and 'Add training / activity' opens the add sheet", async () => {
    await load(makeData({ players: kids, fixtures: [game({ availability: { p1: { status: "in" } } })], sessions: [training({ untilISO: todayISO, availability: { [todayISO]: { p1: { status: "out" } } } })] }));
    await enterCoachMode();
    toCalendar();
    const rows = document.querySelectorAll(".callist .wk-row");
    expect(rows.length).toBe(2);
    expect(within(rows[0]).getByText("1 in · 2 to reply").className).toBe("wk-pill nr");
    expect(within(rows[1]).getByText("0 in · 2 to reply").className).toBe("wk-pill nr");
    const add = listCard().getByText("Add training / activity");
    expect(add.className).toBe("ghostlink");
    fireEvent.click(add);
    expect(await screen.findByText("Add training / activity", { selector: ".sheet h2" })).toBeTruthy();
  });

  it("Add to your calendar: Google / Apple / Outlook links from the feed, Copy link flips to Copied, and the one-off download stays", async () => {
    const feed = "https://footballmgr.au/api/calendar?key=abc123";
    const webcal = "webcal://footballmgr.au/api/calendar?key=abc123";
    meFetch(parentOf(["p1"], ["Sam Smith"]), feed);
    await load(makeData());
    toCalendar();
    const google = await screen.findByText("Google");
    expect(google.tagName).toBe("A");
    expect(google.getAttribute("href")).toBe("https://calendar.google.com/calendar/render?cid=" + encodeURIComponent(webcal));
    expect(google.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Apple").getAttribute("href")).toBe(webcal);
    expect(screen.getByText("Outlook").getAttribute("href")).toBe("https://outlook.office.com/calendar/0/addfromweb?url=" + encodeURIComponent(feed) + "&name=Team%20Calendar");
    expect(screen.getByText("Add to your calendar").className).toBe("label");
    expect(screen.getByText("Subscribe once and it stays in sync when a game moves — better than importing.")).toBeTruthy();
    expect(screen.getByText("Calendars refresh on their own schedule. Treat the link as team-private.")).toBeTruthy();
    fireEvent.click(screen.getByText("Copy link"));
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(screen.getByText("Download a one-off .ics instead")).toBeTruthy();
    expect(screen.queryByText("Subscribe to the team calendar")).toBeNull();
  });

  it("without /api/feedinfo the card keeps only the one-off download", async () => {
    await load(makeData());
    toCalendar();
    expect(screen.getByText("Add to your calendar")).toBeTruthy();
    expect(screen.getByText("Download a one-off .ics instead")).toBeTruthy();
    expect(screen.queryByText("Google")).toBeNull();
    expect(screen.queryByText("Apple")).toBeNull();
    expect(screen.queryByText("Outlook")).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
  });
});

/* ---------------- S5 Squad + Player: Direction C ---------------- */

describe("S5 Squad + Player — Direction C", () => {
  const today = new Date();
  const todayISO = isoLocal(today);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // "Fri, 24 July" for an ISO date, the way the hero writes a birthday.
  const bdayText = (iso) => { const d = new Date(iso + "T00:00:00"); return `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const weekday = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long" });
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

  // Account mode with a working /api/rsvp.
  const meFetch = (me) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (String(url).includes("/api/rsvp")) return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const account = (role, playerIds = [], playerNames = []) => {
    const hat = { role, playerIds, playerNames };
    return {
      mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role, playerIds, playerNames,
      hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: []
    };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  const team = (over = {}) => ({ name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", ...over });
  const game = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: daysFromNow(7), time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const played = (over = {}) => ({ id: "f1", round: 1, status: "played", dateISO: daysFromNow(-14), opponent: "Rovers", homeAway: "H", us: 3, them: 1, availability: {}, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  const nav = (label) => fireEvent.click(within(screen.getByRole("navigation")).getByText(label));
  const rows = () => [...document.querySelectorAll(".prow")];
  const rowText = (r, sel) => r.querySelector(sel)?.textContent;
  const sheet = () => within(document.querySelector(".sheet"));
  const openPlayerRow = async (i = 0) => { fireEvent.click(rows()[i]); await waitFor(() => expect(headerTitle()).not.toBe("Test FC")); };

  it("the header kicker reads n players · m coaches on Squad (singular forms) and goes back to division · age group on Home", async () => {
    await load(makeData({ team: team(), players: kids }));
    nav("Squad");
    expect(await screen.findByText("Players", { selector: ".label" })).toBeTruthy();
    expect(headerKicker()).toBe("3 players · 1 coach");
    nav("Home");
    await waitFor(() => expect(headerKicker()).toBe("Div 1 · U8"));
    cleanup();
    await load(makeData({ team: team({ headCoach: "Byron", assistantCoach: "Dee" }), players: [kids[0]] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(headerKicker()).toBe("1 player · 2 coaches");
  });

  it("rows: shirt number, name, position tag by position, goals text with assists; guests come last with the blue number", async () => {
    const guest = { id: "p4", name: "Zac Guest", number: 2, position: "GK", guest: true, fromISO: daysFromNow(-10), untilISO: daysFromNow(10) };
    await load(makeData({
      team: team(), players: [...kids, guest],
      fixtures: [played({ goals: [{ pid: "p1", n: 2 }, { pid: "p3", n: 1 }], assists: [{ pid: "p2", n: 1 }, { pid: "p3", n: 2 }] })]
    }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    const r = rows();
    expect(r.map((x) => rowText(x, ".pr-num"))).toEqual(["7", "8", "9", "2"]);
    expect(r.map((x) => rowText(x, ".pr-name b"))).toEqual(["Sam Smith", "Alex Smith", "Milo Park", "Zac Guest"]);
    expect(r.map((x) => x.querySelector(".pos-pill").className)).toEqual(["pos-pill pos-FWD", "pos-pill pos-MID", "pos-pill pos-DEF", "pos-pill pos-GK"]);
    expect(r.map((x) => rowText(x, ".pr-goals"))).toEqual(["2 goals", "No goals yet · 1 assist", "1 goal · 2 assists", "No goals yet"]);
    expect(r[3].querySelector(".pr-num").className).toBe("pr-num guest");
    expect(rowText(r[3], ".guesttag")).toBe("Guest");
    expect(r[0].querySelector(".guesttag")).toBeNull();
    // Nothing from the old squad card survives: no photo square, no per-row pencil/trash, no fab.
    expect(document.querySelector(".pcard")).toBeNull();
    expect(document.querySelector(".addfab")).toBeNull();
    expect(document.querySelector(".prow .iconbtn")).toBeNull();
  });

  it("empty squad: 'No players yet.' and, for the coach, the Add player / Paste player list footer that opens the editor and the import sheet", async () => {
    await load(makeData({ team: team(), players: [] }));
    await enterCoachMode();
    nav("Squad");
    expect((await screen.findByText("No players yet.")).className).toBe("pl-empty");
    const foot = document.querySelector(".pr-foot");
    expect(within(foot).getByText("Add player").className).toBe("ghostlink");
    fireEvent.click(within(foot).getByText("Add player"));
    expect(await screen.findByText("Add player", { selector: ".sheet h2" })).toBeTruthy();
    closeSheet();
    fireEvent.click(within(foot).getByText("Paste player list"));
    expect(await screen.findByText(/paste/i, { selector: ".sheet h2" })).toBeTruthy();
    closeSheet();
    // Parents get no footer.
    cleanup();
    await load(makeData({ team: team(), players: kids }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(document.querySelector(".pr-foot")).toBeNull();
    expect(screen.queryByText("Add player")).toBeNull();
  });

  it("coach: a reply pill on every row and the '{Weekday} replies' meta; tapping the pill opens the reply sheet without leaving Squad, and In lands on the pill", async () => {
    meFetch(account("coach"));
    const g = game();
    await load(makeData({ team: team(), players: kids, fixtures: [g] }));
    await expectChip("Coach");
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(screen.getByText(`${weekday(g.dateISO)} replies`).className).toBe("pl-meta");
    const r = rows();
    expect(r.map((x) => rowText(x, ".rr-btn"))).toEqual(["Reply", "Reply", "Reply"]);
    fireEvent.click(r[1].querySelector(".rr-btn"));
    expect(await screen.findByText("Reply for Alex", { selector: ".rs-title" })).toBeTruthy();
    expect(headerTitle()).toBe("Test FC"); // still on the Squad root — the row tap didn't fire
    expect(document.querySelector(".nav button.active").textContent).toBe("Squad");
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(document.querySelector(".ov")).toBeNull());
    await waitFor(() => expect(rows()[1].querySelector(".rr-btn").className).toBe("rr-btn in"));
    expect(rows()[1].querySelector(".rr-btn").textContent).toBe("In");
    const body = JSON.parse(fetch.mock.calls.find((c) => String(c[0]).includes("/api/rsvp"))[1].body);
    expect(body).toMatchObject({ kind: "game", id: "f7", playerId: "p2", status: "in" });
  });

  it("parent: the pill sits on their own child's row only and there is no replies meta; a view-only account gets no pills; no upcoming game means no pills for anyone", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ team: team(), players: kids, fixtures: [game({ availability: { p1: { status: "out" } } })] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    let r = rows();
    expect(r[0].querySelector(".rr-btn").className).toBe("rr-btn out");
    expect(r[0].querySelector(".rr-btn").textContent).toBe("Out");
    expect(r[1].querySelector(".rr-btn")).toBeNull();
    expect(r[2].querySelector(".rr-btn")).toBeNull();
    expect(screen.queryByText(/replies$/)).toBeNull();
    cleanup();
    meFetch(account("viewer"));
    await load(makeData({ team: team(), players: kids, fixtures: [game()] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(document.querySelector(".prow .rr-btn")).toBeNull();
    cleanup();
    meFetch(account("coach"));
    await load(makeData({ team: team(), players: kids, fixtures: [played()] }));
    await expectChip("Coach");
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(document.querySelector(".prow .rr-btn")).toBeNull();
    expect(screen.queryByText(/replies$/)).toBeNull();
    // Every row still opens the player.
    r = rows();
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.querySelector("svg"))).toBe(true);
  });

  it("tapping a row pushes the Player screen (name title, '#number · position' kicker); Back returns to Squad; a player without a number gets the position alone", async () => {
    await load(makeData({ team: team(), players: [...kids, { id: "p5", name: "Nell New", position: "MID" }] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    fireEvent.click(screen.getByText("Milo Park"));
    await waitFor(() => expect(headerTitle()).toBe("Milo Park"));
    expect(headerKicker()).toBe("#9 · DEF");
    expect(document.querySelector(".sheet")).toBeNull();
    expect(document.querySelector(".ph-num").textContent).toBe("9");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    expect(screen.getByText("Players", { selector: ".label" })).toBeTruthy();
    fireEvent.click(screen.getByText("Nell New"));
    await waitFor(() => expect(headerTitle()).toBe("Nell New"));
    expect(headerKicker()).toBe("MID");
  });

  it("Coaches card: one row per named staff member, head coach in the red avatar, a WhatsApp button with the wa.me href, the mail fallback, no Call/Text chips; hidden without staff", async () => {
    await load(makeData({
      team: team({ headCoach: "", staff: [
        { role: "Head coach", name: "Damien Mifsud", mobile: "0400 111 222", email: "d@x.com" },
        { role: "Assistant coach", name: "Cameron Lee", mobile: "", email: "cam@x.com" },
        { role: "Manager", name: "", mobile: "0400 999 999" },
        { role: "Manager", name: "Pat Quiet" }
      ] }),
      players: kids
    }));
    nav("Squad");
    const card = (await screen.findByText("Coaches", { selector: ".label" })).closest(".card");
    const crows = card.querySelectorAll(".crow");
    expect(crows).toHaveLength(3);
    expect(crows[0].querySelector(".avatar").className).toBe("avatar head");
    expect(crows[0].querySelector(".avatar").textContent).toBe("D");
    expect(crows[1].querySelector(".avatar").className).toBe("avatar");
    expect(crows[0].querySelector(".cr-name").textContent).toBe("Damien Mifsud");
    expect(crows[0].querySelector(".cr-role").textContent).toBe("Head coach");
    const wa = within(card).getByRole("link", { name: "Message Damien Mifsud on WhatsApp" });
    expect(wa.getAttribute("href")).toBe("https://wa.me/61400111222");
    expect(wa.className).toBe("wa-sq");
    const mail = within(card).getByRole("link", { name: "Email Cameron Lee" });
    expect(mail.getAttribute("href")).toBe("mailto:cam@x.com");
    expect(mail.className).toBe("wa-sq mail");
    expect(crows[2].querySelector("a")).toBeNull();
    expect(within(card).queryByText("Call")).toBeNull();
    expect(within(card).queryByText("Text")).toBeNull();
    expect(screen.queryByText("Team staff")).toBeNull();
    cleanup();
    await load(makeData({ team: team({ headCoach: "" }), players: kids }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    expect(screen.queryByText("Coaches", { selector: ".label" })).toBeNull();
    expect(headerKicker()).toBe("3 players · 0 coaches");
  });

  it("Player hero: Anton number, name, position tag, and the birthday line — 'Turns N on …' with a real year, 'Birthday …' without, nothing without a dob; no cake emoji", async () => {
    const next = new Date(); next.setDate(next.getDate() + 10);
    const nextISO = isoLocal(next);
    const md = nextISO.slice(5);
    await load(makeData({
      team: team(),
      players: [
        { ...kids[0], dob: `${next.getFullYear() - 8}-${md}` },
        { ...kids[1], dob: `1900-${md}` },
        kids[2]
      ]
    }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    expect(document.querySelector(".ph-num").textContent).toBe("7");
    expect(document.querySelector(".ph-name").textContent).toBe("Sam Smith");
    expect(document.querySelector(".ph-row .pos-pill").className).toBe("pos-pill lg pos-FWD");
    expect(document.querySelector(".ph-bday").textContent).toBe(`Turns 8 on ${bdayText(nextISO)}`);
    expect(document.body.textContent).not.toMatch(/🎂/);
    expect(document.querySelector(".ph-edit")).toBeNull(); // parents don't edit
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(1);
    expect(document.querySelector(".ph-bday").textContent).toBe(`Birthday ${bdayText(nextISO)}`);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(2);
    expect(document.querySelector(".ph-bday")).toBeNull();
  });

  it("three tiles: Goals from played games, Games from match records, In goal from the gk field; the assists · minutes line only when there is something to say", async () => {
    await load(makeData({
      team: team(), players: kids,
      fixtures: [
        played({ id: "f1", goals: [{ pid: "p1", n: 1 }], assists: [{ pid: "p1", n: 2 }], gk: "p2", record: { savedAt: 1, minutes: [{ pid: "p1", min: 30 }, { pid: "p2", min: 30 }] } }),
        played({ id: "f2", round: 2, dateISO: daysFromNow(-7), gk: "p1", record: { savedAt: 1, minutes: [{ pid: "p1", min: 25.5 }] } }),
        game({ gk: "p1", goals: [{ pid: "p1", n: 9 }] })
      ]
    }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    const tiles = [...document.querySelectorAll(".ptiles .ptile")].map((t) => t.querySelector(".k").textContent + "=" + t.querySelector(".v").textContent);
    expect(tiles).toEqual(["Goals=1", "Games=2", "In goal=2"]);
    expect(document.querySelector(".pt-line").textContent).toBe("2 assists · 56 minutes");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(2);
    expect([...document.querySelectorAll(".ptiles .ptile .v")].map((v) => v.textContent)).toEqual(["0", "0", "0"]);
    expect(document.querySelector(".pt-line")).toBeNull();
  });

  it("reply card: label with round, date and time, 'Is Sam playing?' and the pill that opens the reply sheet — for the coach and the child's own parent; not for another parent or a viewer", async () => {
    meFetch(account("coach"));
    const g = game();
    await load(makeData({ team: team(), players: kids, fixtures: [g] }));
    await expectChip("Coach");
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    const card = document.querySelector(".card.preply");
    expect(card.querySelector(".label").textContent).toBe(`Round 7 · ${fmt(g.dateISO)} · 09:00`);
    expect(card.querySelector(".rr-name").textContent).toBe("Is Sam playing?");
    expect(card.querySelector(".rr-hint").textContent).toBe("Reply for Sam");
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "Out" }));
    await waitFor(() => expect(document.querySelector(".preply .rr-btn").className).toBe("rr-btn out"));
    expect(headerTitle()).toBe("Sam Smith");
    cleanup();
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ team: team(), players: kids, fixtures: [g] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    expect(document.querySelector(".card.preply .rr-name").textContent).toBe("Is Sam playing?");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(1); // someone else's child
    expect(document.querySelector(".card.preply")).toBeNull();
    cleanup();
    meFetch(account("viewer"));
    await load(makeData({ team: team(), players: kids, fixtures: [g] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    expect(document.querySelector(".card.preply")).toBeNull();
  });

  it("Family card: the coach sees each guardian (name, DM Mono phone, mailto, WhatsApp href); the child's own parent sees it too; another parent gets the privacy line; no guardians reads 'No family contacts yet.'", async () => {
    const withFamily = [
      { ...kids[0], guardians: [{ name: "Kate Smith", mobile: "0400 222 333", email: "kate@x.com" }, { name: "", mobile: "", email: "second@x.com" }] },
      { ...kids[1], parentName: "Jo Smith", parentContact: "0400 444 555" },
      kids[2]
    ];
    meFetch(account("coach"));
    await load(makeData({ team: team(), players: withFamily, fixtures: [] }));
    await expectChip("Coach");
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    let fam = (await screen.findByText("Family", { selector: ".label" })).closest(".card");
    const frows = fam.querySelectorAll(".fam-row");
    expect(frows).toHaveLength(2);
    expect(frows[0].querySelector(".fam-name").textContent).toBe("Kate Smith");
    expect(frows[0].querySelector(".fam-phone").textContent).toBe("0400 222 333");
    expect(frows[0].querySelector(".fam-mail").getAttribute("href")).toBe("mailto:kate@x.com");
    const wa = within(frows[0]).getByText("WhatsApp");
    expect(wa.getAttribute("href")).toBe("https://wa.me/61400222333");
    expect(wa.className).toBe("wa-btn");
    expect(frows[1].querySelector(".fam-name").textContent).toBe("Parent 2");
    expect(frows[1].querySelector(".fam-phone")).toBeNull();
    expect(within(frows[1]).queryByText("WhatsApp")).toBeNull();
    expect(within(fam).queryByText("Call")).toBeNull();
    expect(screen.queryByText("Contact details are only shown to the family and the coaches.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(1); // legacy single-parent fields
    fam = (await screen.findByText("Family", { selector: ".label" })).closest(".card");
    expect(fam.querySelector(".fam-name").textContent).toBe("Jo Smith");
    expect(fam.querySelector(".fam-phone").textContent).toBe("0400 444 555");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(2); // nobody recorded
    fam = (await screen.findByText("Family", { selector: ".label" })).closest(".card");
    expect(fam.querySelector(".fam-empty").textContent).toBe("No family contacts yet.");
    cleanup();
    // The child's own parent: the Family card; another family's child: the privacy line only.
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ team: team(), players: withFamily, fixtures: [] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    expect((await screen.findByText("Family", { selector: ".label" })).closest(".card").querySelector(".fam-name").textContent).toBe("Kate Smith");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    await openPlayerRow(1);
    expect(screen.getByText("Contact details are only shown to the family and the coaches.").className).toBe("privacy");
    expect(screen.queryByText("Family", { selector: ".label" })).toBeNull();
    expect(screen.queryByText("Jo Smith")).toBeNull();
  });

  it("the Ratings card carries the 'Coaches only' badge for the coach and is absent for a parent; a coach note still saves through /api/player-coach", async () => {
    stubNarrowRoutes();
    await load(makeData({ team: team(), players: kids }));
    await enterCoachMode();
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    const notes = (await screen.findByText("Ratings", { selector: ".label" })).closest(".card");
    expect(notes.className).toBe("card notes");
    expect(within(notes).getByText("Coaches only").className).toBe("softbadge");
    expect(screen.queryByText("Coach only")).toBeNull();
    const ta = within(notes).getByLabelText("Coach note");
    fireEvent.change(ta, { target: { value: "Quick feet" } });
    fireEvent.blur(ta);
    await waitFor(() => expect(callTo("/api/player-coach")).toBeTruthy());
    expect(bodyOf("/api/player-coach")).toMatchObject({ playerId: "p1", note: "Quick feet" });
    expect(storage.set).not.toHaveBeenCalled();
    cleanup();
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ team: team(), players: kids }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(0);
    expect(screen.queryByText("Ratings")).toBeNull();
    expect(screen.queryByText("Coaches only")).toBeNull();
  });

  it("coach: Edit opens the player editor; Remove player persists the squad without them (sample flag cleared) and the screen pops back to Squad", async () => {
    await load(makeData({ team: team(), players: kids, isSample: true }));
    await enterCoachMode();
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    await openPlayerRow(1);
    expect(headerTitle()).toBe("Alex Smith");
    fireEvent.click(screen.getByText("Edit", { selector: ".ph-edit" }));
    expect(await screen.findByText("Edit player", { selector: ".sheet h2" })).toBeTruthy();
    expect(screen.getByDisplayValue("Alex Smith")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove player" }));
    await waitFor(() => expect(storage.set).toHaveBeenCalled());
    const saved = JSON.parse(storage.set.mock.calls.at(-1)[1]);
    expect(saved.players.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(saved.isSample).toBe(false);
    await waitFor(() => expect(headerTitle()).toBe("Test FC"));
    expect(document.querySelector(".sheet")).toBeNull();
    expect(screen.queryByText("Alex Smith")).toBeNull();
    expect(rows()).toHaveLength(2);
    expect(headerKicker()).toBe("2 players · 1 coach");
    // A new player has no Remove button.
    fireEvent.click(screen.getByText("Add player"));
    await screen.findByText("Add player", { selector: ".sheet h2" });
    expect(screen.queryByRole("button", { name: "Remove player" })).toBeNull();
  });

  it("guests: the tag on the row and the hero, the coach-only date range, ended guests listed for the coach as 'Guest · ended' and hidden from parents", async () => {
    const active = { id: "g1", name: "Zac Guest", number: 2, position: "GK", guest: true, fromISO: daysFromNow(-10), untilISO: daysFromNow(20) };
    const ended = { id: "g2", name: "Old Guest", number: 3, position: "DEF", guest: true, fromISO: daysFromNow(-30), untilISO: daysFromNow(-1) };
    await load(makeData({ team: team(), players: [...kids, ended, active] }));
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    let r = rows();
    expect(r.map((x) => rowText(x, ".pr-name b"))).toEqual(["Sam Smith", "Alex Smith", "Milo Park", "Zac Guest"]);
    expect(rowText(r[3], ".guesttag")).toBe("Guest");
    expect(r[3].querySelector(".pr-dates")).toBeNull();
    expect(headerKicker()).toBe("4 players · 1 coach");
    fireEvent.click(r[3]);
    await waitFor(() => expect(headerTitle()).toBe("Zac Guest"));
    expect(document.querySelector(".ph-row .guesttag").textContent).toBe("Guest");
    cleanup();
    await load(makeData({ team: team(), players: [...kids, ended, active] }));
    await enterCoachMode();
    nav("Squad");
    await screen.findByText("Players", { selector: ".label" });
    r = rows();
    expect(r.map((x) => rowText(x, ".pr-name b"))).toEqual(["Sam Smith", "Alex Smith", "Milo Park", "Zac Guest", "Old Guest"]);
    expect(r[3].querySelector(".pr-dates").textContent).toBe(`${fmt(active.fromISO)} → ${fmt(active.untilISO)}`);
    expect(rowText(r[4], ".guesttag")).toBe("Guest · ended");
    expect(r[4].querySelector(".guesttag").className).toBe("guesttag ended");
    expect(headerKicker()).toBe("5 players · 1 coach");
  });
});

describe("S6 Availability — Direction C", () => {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const weekday = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "long" });
  const wd = (iso) => DOW[new Date(iso + "T00:00:00").getDay()];
  // "Sat 13 Jun" — the way the reminder text writes a date.
  const nd = (iso) => { const d = new Date(iso + "T00:00:00"); return `${wd(iso)} ${d.getDate()} ${d.toLocaleDateString("en-AU", { month: "short" })}`; };

  const meFetch = (me, rsvpOk = true) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (String(url).includes("/api/rsvp")) return Promise.resolve({ ok: rsvpOk, json: async () => ({ ok: rsvpOk }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const hatOf = (role, playerIds = [], playerNames = [], extra = {}) => {
    const hat = { role, playerIds, playerNames, ...extra };
    return {
      mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role, playerIds, playerNames,
      hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: [], ...extra
    };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD" },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF", guardians: [{ name: "Jo Park", mobile: "0400 000 000" }] }
  ];
  // The game is six days out; the weekly training lands two days before it
  // (and so pairs as the training closest before the game).
  const gameISO = daysFromNow(6), trainISO = daysFromNow(4);
  const game = (over = {}) => ({ id: "f7", round: 7, status: "upcoming", dateISO: gameISO, time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const training = (over = {}) => ({ id: "s1", title: "Training", kind: "training", recur: "weekly", weekday: new Date(trainISO + "T00:00:00").getDay(), startISO: daysFromNow(-30), untilISO: daysFromNow(60), time: "16:30", location: "JF O'Grady", availability: {}, ...over });
  const load = (data) => { storage.get.mockResolvedValue({ value: JSON.stringify(data) }); render(<App />); return waitForLoaded(); };
  // Home "Details" -> Match detail -> "See everyone's replies" -> Who's in.
  const openWhosIn = async () => {
    fireEvent.click(await screen.findByText("Details"));
    fireEvent.click(await screen.findByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
  };
  const tiles = () => [...document.querySelectorAll(".wi-tile .v")].map((e) => e.textContent);
  const rows = () => [...document.querySelectorAll(".av-row")];
  const names = () => rows().map((r) => r.querySelector(".av-name span").textContent);
  const rowOf = (name) => screen.getByText(name, { selector: ".av-name span" }).closest(".av-row");
  const segTabs = () => [...document.querySelectorAll(".wi-seg button")];
  const rsvpBodies = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/rsvp")).map((c) => JSON.parse(c[1].body));
  const lastRsvp = () => rsvpBodies().at(-1);
  const toast = () => document.querySelector(".toast")?.textContent;

  it("game: the header kicker, three count tiles and the list sorted in → out → no reply with who replied in the hint; no Game / Training control without a training", async () => {
    await load(makeData({ players: kids, fixtures: [game({ availability: { p2: { status: "in", by: "Coach" }, p3: { status: "out", reason: "Sick", by: "Milo Park" } } })] }));
    await enterCoachMode();
    await openWhosIn();
    expect(headerKicker()).toBe(`Round 7 vs Wests · ${fmt(gameISO)} 09:00`);
    expect(document.querySelector(".wi-seg")).toBeNull();
    expect(tiles()).toEqual(["1", "1", "1"]);
    expect([...document.querySelectorAll(".wi-tile .k")].map((e) => e.textContent)).toEqual(["In", "Out", "No reply"]);
    expect(document.querySelector(".wi-tile.in").querySelector(".v").textContent).toBe("1");
    expect(names()).toEqual(["Alex Smith", "Milo Park", "Sam Smith"]);
    expect(rows().map((r) => r.querySelector(".pos-pill").textContent)).toEqual(["MID", "DEF", "FWD"]);
    expect(rowOf("Alex Smith").querySelector(".av-hint").textContent).toBe("In · Coach");
    expect(rowOf("Sam Smith").querySelector(".av-hint").textContent).toBe("No reply yet");
    // The coach's Out row carries the reason select in the hint line, then who replied.
    const milo = rowOf("Milo Park");
    expect(milo.querySelector("select.av-reason").value).toBe("Sick");
    expect(within(milo).getByText("· Milo Park")).toBeTruthy();
    expect(within(milo).getByRole("button", { name: "Out" }).className).toBe("out on");
    expect(screen.getByText("As coach you can reply for anyone.").className).toBe("wi-foot");
    expect(screen.queryByText("Sign in to respond")).toBeNull();
  });

  it("coach: inline In / Out marks a player, tapping the chosen value clears it, Out shows the reason select and the POST carries the reason; Match detail reads the same count", async () => {
    meFetch(hatOf("coach"));
    await load(makeData({ players: kids, fixtures: [game()] }));
    await expectChip("Coach");
    await openWhosIn();
    const sam = () => rowOf("Sam Smith");
    expect(names()).toEqual(["Sam Smith", "Alex Smith", "Milo Park"]);
    fireEvent.click(within(sam()).getByRole("button", { name: "In" }));
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "game", id: "f7", playerId: "p1", status: "in" }));
    expect(within(sam()).getByRole("button", { name: "In" }).className).toBe("in on");
    expect(within(sam()).getByRole("button", { name: "Out" }).className).toBe("out");
    expect(sam().querySelector(".av-hint").textContent).toMatch(/^In · Coach · /);
    expect(tiles()).toEqual(["1", "0", "2"]);
    expect(toast()).toBe(`Sam's in for ${weekday(gameISO)}`);
    // Tapping the chosen value clears it.
    fireEvent.click(within(sam()).getByRole("button", { name: "In" }));
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "game", id: "f7", playerId: "p1", status: null }));
    expect(within(sam()).getByRole("button", { name: "In" }).className).toBe("in");
    expect(sam().querySelector(".av-hint").textContent).toBe("No reply yet");
    expect(tiles()).toEqual(["0", "0", "3"]);
    expect(toast()).toBe("Sam's reply cleared");
    // Out: the reason select appears in the hint line, defaulting to Away.
    fireEvent.click(within(sam()).getByRole("button", { name: "Out" }));
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "game", id: "f7", playerId: "p1", status: "out", reason: "Away" }));
    expect(within(sam()).getByRole("button", { name: "Out" }).className).toBe("out on");
    expect(sam().querySelector("select.av-reason").value).toBe("Away");
    expect(toast()).toBe(`Sam's out for ${weekday(gameISO)}`);
    fireEvent.change(sam().querySelector("select.av-reason"), { target: { value: "Sick" } });
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "game", id: "f7", playerId: "p1", status: "out", reason: "Sick" }));
    expect(sam().querySelector("select.av-reason").value).toBe("Sick");
    expect(tiles()).toEqual(["0", "1", "2"]);
    expect(names()).toEqual(["Sam Smith", "Alex Smith", "Milo Park"]); // out sorts above no reply
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("0 in · 1 out · 2 no reply")).toBeTruthy();
  });

  it("parent: own child rows are tinted with a Reply pill that opens the reply sheet; other rows are status pills; the footnote names the children; no nudge", async () => {
    meFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ players: kids, fixtures: [game({ availability: { p3: { status: "out", reason: "Sick", by: "Milo Park" } } })] }));
    await expectChip("Parent of Sam");
    await openWhosIn();
    const sam = () => rowOf("Sam Smith");
    expect(sam().className).toBe("av-row mine");
    expect(rowOf("Alex Smith").className).toBe("av-row");
    expect(rowOf("Alex Smith").querySelector(".st-pill").textContent).toBe("No reply");
    expect(rowOf("Milo Park").querySelector(".st-pill").className).toBe("st-pill out");
    expect(rowOf("Milo Park").querySelector(".st-pill").textContent).toBe("Sick");
    expect(document.querySelector(".av-seg")).toBeNull();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByText(/Nudge the/)).toBeNull();
    expect(screen.getByText("You can reply for Sam. Coaches can reply for anyone.").className).toBe("wi-foot");
    fireEvent.click(within(sam()).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    expect(document.querySelector(".rs-sub").textContent).toBe(`vs Wests · ${fmt(gameISO)} · 09:00`);
    fireEvent.click(within(document.querySelector(".sheet")).getByRole("button", { name: "In" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    expect(within(sam()).getByRole("button", { name: "In" }).className).toBe("rr-btn in");
    expect(sam().querySelector(".av-hint").textContent).toMatch(/^In · Sam Smith · /);
    expect(tiles()).toEqual(["1", "1", "1"]);
    expect(names()).toEqual(["Sam Smith", "Milo Park", "Alex Smith"]);
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "game", id: "f7", playerId: "p1", status: "in" }));
    expect(toast()).toBe(`Sam's in for ${weekday(gameISO)}`);
  });

  it("a view-only account sees status pills only and the viewer footnote", async () => {
    meFetch(hatOf("viewer", [], [], { clubAdmin: true }));
    await load(makeData({ players: kids, fixtures: [game({ availability: { p1: { status: "in", by: "Sam Smith" } } })] }));
    await expectChip("Club admin (view only)");
    await openWhosIn();
    expect(document.querySelectorAll(".st-pill")).toHaveLength(3);
    expect(rowOf("Sam Smith").querySelector(".st-pill").className).toBe("st-pill in");
    expect(document.querySelector(".av-row button")).toBeNull();
    expect(document.querySelector(".av-row.mine")).toBeNull();
    expect(screen.queryByText(/Nudge the/)).toBeNull();
    expect(screen.getByText("Only coaches and families can reply.").className).toBe("wi-foot");
    expect(screen.queryByText("Sign in to respond")).toBeNull();
  });

  it("a legacy guest gets 'Sign in to respond' instead of a footnote; once signed in as a family the child's row becomes theirs", async () => {
    await load(makeData({ players: kids, fixtures: [game()] }));
    await openWhosIn();
    expect(document.querySelector(".wi-foot")).toBeNull();
    expect(document.querySelectorAll(".st-pill")).toHaveLength(3);
    const signin = screen.getByText("Sign in to respond");
    expect(signin.className).toBe("btn");
    fireEvent.click(signin);
    expect(await screen.findByText("Who's responding?")).toBeTruthy();
    fireEvent.click(within(document.querySelector(".sheet")).getByText("Sam Smith"));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    expect(rowOf("Sam Smith").className).toBe("av-row mine");
    expect(within(rowOf("Sam Smith")).getByRole("button", { name: "Reply" })).toBeTruthy();
    expect(document.querySelectorAll(".st-pill")).toHaveLength(2);
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    expect(screen.getByText("You can reply for Sam. Coaches can reply for anyone.")).toBeTruthy();
  });

  it("the Game / Training control appears when a training occurrence pairs with the game; switching swaps the kicker, tiles and list, and a training reply POSTs kind session with the occurrence", async () => {
    meFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({
      players: kids,
      fixtures: [game({ availability: { p2: { status: "in" } } })],
      sessions: [training({ availability: { [trainISO]: { p2: { status: "in" }, p3: { status: "out", reason: "Sick" } } } })]
    }));
    await expectChip("Parent of Sam");
    await openWhosIn();
    expect(segTabs().map((b) => b.textContent)).toEqual([`${wd(gameISO)} · Game`, `${wd(trainISO)} · Training`]);
    expect(segTabs().map((b) => b.className)).toEqual(["on", ""]);
    expect(tiles()).toEqual(["1", "0", "2"]);
    fireEvent.click(segTabs()[1]);
    expect(headerTitle()).toBe("Who's in");
    expect(headerKicker()).toBe(`Training · ${fmt(trainISO)} 16:30`);
    expect(segTabs().map((b) => b.className)).toEqual(["", "on"]);
    expect(tiles()).toEqual(["1", "1", "1"]);
    expect(names()).toEqual(["Alex Smith", "Milo Park", "Sam Smith"]);
    expect(rowOf("Milo Park").querySelector(".st-pill").textContent).toBe("Sick");
    expect(screen.getByText("You can reply for Sam. Coaches can reply for anyone.")).toBeTruthy();
    fireEvent.click(within(rowOf("Sam Smith")).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    expect(document.querySelector(".rs-sub").textContent).toBe(`Training · ${fmt(trainISO)} · 16:30`);
    fireEvent.click(within(document.querySelector(".sheet")).getByRole("button", { name: "In" }));
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "session", id: "s1", occ: trainISO, playerId: "p1", status: "in" }));
    expect(toast()).toBe("Sam's in for training");
    expect(tiles()).toEqual(["2", "1", "0"]);
    expect(within(rowOf("Sam Smith")).getByRole("button", { name: "In" }).className).toBe("rr-btn in");
    // Back to the game: its own reply set, untouched.
    fireEvent.click(segTabs()[0]);
    expect(headerKicker()).toBe(`Round 7 vs Wests · ${fmt(gameISO)} 09:00`);
    expect(tiles()).toEqual(["1", "0", "2"]);
    expect(within(rowOf("Sam Smith")).getByRole("button", { name: "Reply" })).toBeTruthy();
    expect(rsvpBodies()).toHaveLength(1);
  });

  it("coach: Nudge copies the reminder, opens WhatsApp with it and says so honestly; Message a family directly lists each family with a Remind link when there is a mobile", async () => {
    meFetch(hatOf("coach"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await load(makeData({ players: kids, fixtures: [game({ availability: { p2: { status: "in", by: "Coach" } } })] }));
    await expectChip("Coach");
    await openWhosIn();
    const text = `Round 7 vs Wests, ${nd(gameISO)} 09:00. Still need In or Out from Sam and Milo. Reply on the team page please.`;
    const btn = screen.getByRole("button", { name: "Nudge the 2 who haven't replied" });
    expect(btn.className).toBe("nudge");
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(open).toHaveBeenCalledWith("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    expect(toast()).toBe("Reminder copied — paste it in the group");
    expect(document.body.textContent).not.toMatch(/Reminder sent/);
    // Per-family reminders under the button.
    const details = document.querySelector("details.fam-direct");
    expect(details.querySelector("summary").textContent).toBe("Message a family directly");
    const fam = [...details.querySelectorAll(".fd-row")];
    expect(fam.map((r) => r.querySelector(".fd-name").textContent)).toEqual(["Sam Smith", "Milo Park"]);
    expect(fam[0].querySelector(".fd-who")).toBeNull();
    expect(fam[0].querySelector(".fd-none").textContent).toBe("no contact");
    expect(fam[0].querySelector("a")).toBeNull();
    expect(fam[1].querySelector(".fd-who").textContent).toBe("Jo");
    const link = fam[1].querySelector("a.fd-link");
    expect(link.textContent).toBe("Remind");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toBe("https://wa.me/61400000000?text=" + encodeURIComponent(`Hi Jo, could you mark Milo In or Out for Round 7 vs Wests (${nd(gameISO)}) on the team page? Thanks.`));
    // One left: the singular label. None left: no nudge at all.
    fireEvent.click(within(rowOf("Milo Park")).getByRole("button", { name: "In" }));
    expect(screen.getByRole("button", { name: "Nudge the 1 who hasn't replied" })).toBeTruthy();
    expect(document.querySelectorAll(".fd-row")).toHaveLength(1);
    fireEvent.click(within(rowOf("Sam Smith")).getByRole("button", { name: "Out" }));
    expect(screen.queryByText(/Nudge the/)).toBeNull();
    expect(screen.queryByText("Message a family directly")).toBeNull();
    open.mockRestore();
  });

  it("session sheet: the parent's own-child row opens the training reply sheet and comes back with the reply on the row; See everyone's replies opens the session Who's in", async () => {
    meFetch(hatOf("parent", ["p1"], ["Sam Smith"]));
    await load(makeData({ players: kids, fixtures: [game()], sessions: [training()] }));
    await expectChip("Parent of Sam");
    fireEvent.click((await screen.findAllByText("Training", { selector: ".wk-title" }))[0].closest(".wk-row"));
    const card = (await screen.findByText("Who's training?", { selector: ".label" })).closest(".card");
    expect(card.querySelector(".wi-count").textContent).toBe("0 in · 0 out · 3 no reply");
    expect(within(card).getByText("Sam S.")).toBeTruthy();
    expect(within(card).queryByText("Alex S.")).toBeNull();
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    expect(screen.queryByText(/Tap your player/)).toBeNull();
    expect(screen.queryByText(/chase non-responders/)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    expect(await screen.findByText("Reply for Sam", { selector: ".rs-title" })).toBeTruthy();
    expect(document.querySelector(".rs-sub").textContent).toBe(`Training · ${fmt(trainISO)} · 16:30`);
    fireEvent.click(within(document.querySelector(".sheet")).getByRole("button", { name: "In" }));
    // Back on the session sheet, with the reply on the row and in the count.
    const card2 = (await screen.findByText("Who's training?", { selector: ".label" })).closest(".card");
    expect(within(card2).getByRole("button", { name: "In" }).className).toBe("rr-btn in");
    expect(card2.querySelector(".wi-count").textContent).toBe("1 in · 0 out · 2 no reply");
    await waitFor(() => expect(lastRsvp()).toEqual({ kind: "session", id: "s1", occ: trainISO, playerId: "p1", status: "in" }));
    expect(toast()).toBe("Sam's in for training");
    fireEvent.click(within(card2).getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(document.querySelector(".sheet")).toBeNull();
    expect(headerKicker()).toBe(`Training · ${fmt(trainISO)} 16:30`);
    expect(tiles()).toEqual(["1", "0", "2"]);
    expect(within(rowOf("Sam Smith")).getByRole("button", { name: "In" }).className).toBe("rr-btn in");
    // The training pairs with the next game, Game tab first.
    expect(segTabs().map((b) => b.textContent)).toEqual([`${wd(gameISO)} · Game`, `${wd(trainISO)} · Training`]);
    expect(segTabs().map((b) => b.className)).toEqual(["", "on"]);
  });

  it("a legacy guest gets 'Sign in to respond' on the session sheet", async () => {
    await load(makeData({ players: kids, fixtures: [game()], sessions: [training()] }));
    fireEvent.click((await screen.findAllByText("Training", { selector: ".wk-title" }))[0].closest(".wk-row"));
    const card = (await screen.findByText("Who's training?", { selector: ".label" })).closest(".card");
    expect(card.querySelector(".replyrows")).toBeNull();
    fireEvent.click(within(card).getByText("Sign in to respond"));
    expect(await screen.findByText("Who's responding?")).toBeTruthy();
  });

  it("a past training occurrence and its past game are read-only: pills only, no nudge, the 'has passed' footnote", async () => {
    const pastISO = daysFromNow(-2), pastGameISO = daysFromNow(-1);
    meFetch(hatOf("coach"));
    await load(makeData({
      players: kids,
      fixtures: [game({ dateISO: pastGameISO, availability: { p1: { status: "in", by: "Coach" } } })],
      sessions: [training({ weekday: new Date(pastISO + "T00:00:00").getDay(), availability: { [pastISO]: { p2: { status: "out", reason: "Sick", by: "Coach" } } } })]
    }));
    await expectChip("Coach");
    // Calendar -> that day -> the training row -> the session sheet.
    fireEvent.click(within(screen.getByRole("navigation")).getByText("Calendar"));
    const d = new Date(pastISO + "T00:00:00");
    if (d.getMonth() !== new Date().getMonth()) fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(document.querySelectorAll(".cal-cell")[d.getDate() - 1]);
    fireEvent.click(await screen.findByText("Training", { selector: ".sheet .wk-title" }));
    const card = (await screen.findByText("Attendance", { selector: ".label" })).closest(".card");
    expect(card.querySelector(".wi-count").textContent).toBe("0 in · 1 out · 2 no reply");
    expect(card.querySelector(".replyrows")).toBeNull();
    expect(screen.queryByText("Sign in to respond")).toBeNull();
    fireEvent.click(within(card).getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(headerKicker()).toBe(`Training · ${fmt(pastISO)} 16:30`);
    expect(tiles()).toEqual(["0", "1", "2"]);
    expect(document.querySelector(".av-seg")).toBeNull();
    expect(document.querySelector(".av-row button")).toBeNull();
    expect(rowOf("Alex Smith").querySelector(".st-pill").textContent).toBe("Sick");
    expect(rowOf("Alex Smith").querySelector(".av-hint").textContent).toBe("Sick · Coach");
    expect(screen.queryByText(/Nudge the/)).toBeNull();
    expect(screen.getByText("This session has passed.").className).toBe("wi-foot");
    // The game the day after pairs with it and is read-only too.
    expect(segTabs().map((b) => b.textContent)).toEqual([`${wd(pastGameISO)} · Game`, `${wd(pastISO)} · Training`]);
    fireEvent.click(segTabs()[0]);
    expect(headerKicker()).toBe(`Round 7 vs Wests · ${fmt(pastGameISO)} 09:00`);
    expect(tiles()).toEqual(["1", "0", "2"]);
    expect(rowOf("Sam Smith").querySelector(".st-pill").className).toBe("st-pill in");
    expect(document.querySelector(".av-seg")).toBeNull();
    expect(screen.queryByText(/Nudge the/)).toBeNull();
    expect(screen.getByText("This game has passed.")).toBeTruthy();
  });

  it("a training with no game to pair shows no Game / Training control; the coach nudge counts everyone", async () => {
    await load(makeData({ players: kids, fixtures: [], sessions: [training()] }));
    await enterCoachMode();
    fireEvent.click((await screen.findAllByText("Training", { selector: ".wk-title" }))[0].closest(".wk-row"));
    const card = (await screen.findByText("Who's training?", { selector: ".label" })).closest(".card");
    fireEvent.click(within(card).getByText("See everyone's replies"));
    await waitFor(() => expect(headerTitle()).toBe("Who's in"));
    expect(headerKicker()).toBe(`Training · ${fmt(trainISO)} 16:30`);
    expect(document.querySelector(".wi-seg")).toBeNull();
    expect(tiles()).toEqual(["0", "0", "3"]);
    expect(document.querySelectorAll(".av-seg")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Nudge the 3 who haven't replied" })).toBeTruthy();
    expect(screen.getByText("As coach you can reply for anyone.")).toBeTruthy();
  });
});

describe("S7 Duties — Direction C", () => {
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

  // Account mode with a working /api/duty; `duty` overrides what the route answers.
  const meFetch = (me, duty = { ok: true, json: { ok: true } }) => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return Promise.resolve({ ok: true, json: async () => me });
      if (String(url).includes("/api/duty")) return Promise.resolve({ ok: duty.ok, status: duty.status, json: async () => duty.json });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
  };
  const account = (role, playerIds = [], playerNames = []) => {
    const hat = { role, playerIds, playerNames };
    return {
      mode: "account", email: "x@a.com", admin: false, clubAdmin: false, teamSlug: "a", teamName: "Test FC", role, playerIds, playerNames,
      hats: [hat], teams: [{ teamSlug: "a", teamName: "Test FC", hats: [hat] }], canSwitch: false, memberships: []
    };
  };
  const kids = [
    { id: "p1", name: "Sam Smith", number: 7, position: "FWD", guardians: [{ name: "Jo Smith", mobile: "0400 000 000" }] },
    { id: "p2", name: "Alex Smith", number: 8, position: "MID" },
    { id: "p3", name: "Milo Park", number: 9, position: "DEF" }
  ];
  const r5ISO = daysFromNow(-14), r7ISO = daysFromNow(6), r8ISO = daysFromNow(13);
  const played = (over = {}) => ({ id: "r5", round: 5, status: "played", dateISO: r5ISO, time: "09:00", opponent: "Rovers", homeAway: "A", venue: "X", us: 3, them: 1, availability: {}, fruit: "p2", gk: "p1", ...over });
  const game = (over = {}) => ({ id: "r7", round: 7, status: "upcoming", dateISO: r7ISO, time: "09:00", opponent: "Wests", homeAway: "H", venue: "Perry Park", availability: {}, ...over });
  const later = (over = {}) => ({ id: "r8", round: 8, status: "upcoming", dateISO: r8ISO, time: "10:30", opponent: "Lions", homeAway: "A", venue: "Lion Park", availability: {}, ...over });
  const team = (features) => ({ name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "", headCoach: "Byron", ...(features ? { features } : {}) });
  const data = (over = {}) => makeData({ team: team(), players: kids, fixtures: [game(), played(), later()], ...over });
  const load = (d) => { storage.get.mockResolvedValue({ value: JSON.stringify(d) }); render(<App />); return waitForLoaded(); };
  // Home's Duties card pushes the Duties screen.
  const toDuties = async () => { fireEvent.click(await screen.findByRole("button", { name: "Duties" })); await screen.findByText(/each week:/); };
  const cards = () => [...document.querySelectorAll(".ducard")];
  const cardOf = (round) => cards().find((c) => c.querySelector(".du-round").textContent === `R${round}`);
  const slotOf = (card, label) => within(card).getByText(label).closest(".du-slot");
  const valueOf = (card, label) => slotOf(card, label).querySelector(".du-val").textContent;
  const sheet = () => within(document.querySelector(".sheet"));
  const toast = () => document.querySelector(".toast")?.textContent;
  const dutyBodies = () => fetch.mock.calls.filter((c) => String(c[0]).includes("/api/duty")).map((c) => JSON.parse(c[1].body));

  it("intro line and header kicker follow the team's duties; no duties gives the turned-off card", async () => {
    await load(data());
    await toDuties();
    expect(document.querySelector(".du-intro").textContent).toBe("Two jobs each week: a family brings half-time fruit, and one player takes a turn in goal.");
    expect(headerKicker()).toBe("Fruit and goalkeeper rota");
    cleanup();
    await load(data({ team: team({ fruitDuty: true, gkDuty: true, jerseyDuty: true }) }));
    await toDuties();
    expect(document.querySelector(".du-intro").textContent).toBe("Three jobs each week: a family brings half-time fruit, one player takes a turn in goal, and a family washes the jerseys.");
    expect(headerKicker()).toBe("Fruit, goalkeeper and jersey rota");
    expect(cardOf(7).querySelectorAll(".du-slot")).toHaveLength(3);
    expect(within(cardOf(7)).getByText("Jerseys")).toBeTruthy();
    cleanup();
    await load(data({ team: team({ fruitDuty: true, gkDuty: false, jerseyDuty: false }) }));
    await toDuties();
    expect(document.querySelector(".du-intro").textContent).toBe("One job each week: a family brings half-time fruit.");
    expect(headerKicker()).toBe("Fruit rota");
    expect(cardOf(7).querySelectorAll(".du-slot")).toHaveLength(1);
    cleanup();
    await load(data({ team: team({ fruitDuty: false, gkDuty: false, jerseyDuty: false }), fixtures: [] }));
    fireEvent.click(screen.getByText("Duties ›"));
    expect(await screen.findByText("Duties are turned off")).toBeTruthy();
    expect(document.querySelector(".du-intro")).toBeNull();
    expect(headerKicker()).toBe("Turned off for this team");
  });

  it("one card per fixture in round order with the head row; past rounds fade; values are the family, the player, or 'Not assigned yet'", async () => {
    await load(data({ fixtures: [later(), game({ fruit: "p1", gk: "p3" }), played()] }));
    await toDuties();
    expect(cards().map((c) => c.querySelector(".du-round").textContent)).toEqual(["R5", "R7", "R8"]);
    expect(cards().map((c) => c.classList.contains("past"))).toEqual([true, false, false]);
    const r7 = cardOf(7);
    expect(r7.querySelector(".du-opp").textContent).toBe("vs Wests");
    expect(r7.querySelector(".du-date").textContent).toBe(fmt(r7ISO));
    expect(valueOf(r7, "Fruit duty")).toBe("Sam S.'s family");
    expect(valueOf(r7, "In goal")).toBe("Milo P.");
    expect(slotOf(r7, "In goal").querySelector(".du-val").className).toBe("du-val");
    const r8 = cardOf(8);
    expect(valueOf(r8, "Fruit duty")).toBe("Not assigned yet");
    expect(slotOf(r8, "Fruit duty").querySelector(".du-val").className).toBe("du-val none");
    expect(valueOf(cardOf(5), "Fruit duty")).toBe("Alex S.'s family");
    expect(valueOf(cardOf(5), "In goal")).toBe("Sam S.");
    expect(screen.queryByText("Sam Smith")).toBeNull();
  });

  it("a parent with one child: 'I'll do it' claims fruit at once — POST, optimistic value, toast, then 'Yours'", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(data());
    await expectChip("Parent of Sam");
    await toDuties();
    const r7 = cardOf(7);
    const fruit = slotOf(r7, "Fruit duty");
    expect(within(fruit).getByText("Tap to volunteer")).toBeTruthy();
    fireEvent.click(within(fruit).getByRole("button", { name: "I'll do it" }));
    expect(valueOf(r7, "Fruit duty")).toBe("Sam S.'s family");
    expect(toast()).toBe("Sam S.'s family on fruit for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r7", duty: "fruit", playerId: "p1" }]));
    expect(within(fruit).queryByText("I'll do it")).toBeNull();
    expect(within(fruit).getByText("Yours")).toBeTruthy();
    expect(within(fruit).queryByText("Tap to volunteer")).toBeNull();
    expect(document.querySelector(".sheet")).toBeNull();
    expect(storage.set).not.toHaveBeenCalled(); // never a whole-document write
    // The other upcoming round still offers the claim; the past one never did.
    expect(within(cardOf(8)).getByRole("button", { name: "I'll do it" })).toBeTruthy();
    expect(cardOf(5).querySelector(".du-claim")).toBeNull();
  });

  it("a parent with two children picks whose family in the sheet; the whole slot row is tappable", async () => {
    meFetch(account("parent", ["p1", "p2"], ["Sam Smith", "Alex Smith"]));
    await load(data());
    await expectChip("Parent of Sam & Alex");
    await toDuties();
    fireEvent.click(slotOf(cardOf(7), "Fruit duty")); // the row, not the pill
    expect(sheet().getByText("Fruit duty · Round 7")).toBeTruthy();
    expect(sheet().getByText(`vs Wests · ${fmt(r7ISO)}`)).toBeTruthy();
    expect(sheet().getByText("Half-time fruit for 3 kids — oranges or watermelon go down well. We'll let Coach Byron know it's sorted.")).toBeTruthy();
    const chips = sheet().getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["Sam S.'s family", "Alex S.'s family"]);
    expect(chips.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    fireEvent.click(chips[1]);
    fireEvent.click(sheet().getByRole("button", { name: "Yes, I'll bring fruit" }));
    expect(document.querySelector(".sheet")).toBeNull();
    expect(valueOf(cardOf(7), "Fruit duty")).toBe("Alex S.'s family");
    expect(toast()).toBe("Alex S.'s family on fruit for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r7", duty: "fruit", playerId: "p2" }]));
    expect(dutyBodies()).toHaveLength(1);
  });

  it("jersey duty reads as a family duty for a parent: sheet copy, button and toast", async () => {
    meFetch(account("parent", ["p1", "p2"], ["Sam Smith", "Alex Smith"]));
    await load(data({ team: team({ fruitDuty: false, gkDuty: true, jerseyDuty: true }) }));
    await expectChip("Parent of Sam & Alex");
    await toDuties();
    fireEvent.click(within(slotOf(cardOf(7), "Jerseys")).getByRole("button", { name: "I'll do it" }));
    expect(sheet().getByText("Jerseys · Round 7")).toBeTruthy();
    expect(sheet().getByText("Take the jerseys home after the game and bring them back washed for the next one. We'll let Coach Byron know it's sorted.")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "Yes, I'll wash the jerseys" }));
    expect(valueOf(cardOf(7), "Jerseys")).toBe("Sam S.'s family");
    expect(toast()).toBe("Sam S.'s family on jerseys for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r7", duty: "jersey", playerId: "p1" }]));
  });

  it("a parent gets no control on the keeper slot, nor on a slot another family holds", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(data({ fixtures: [game({ fruit: "p3" }), later()] }));
    await expectChip("Parent of Sam");
    await toDuties();
    const r7 = cardOf(7);
    const gk = slotOf(r7, "In goal");
    expect(gk.querySelector(".softpill, .du-claim")).toBeNull();
    expect(gk.getAttribute("role")).toBeNull();
    expect(within(gk).queryByText(/Tap to/)).toBeNull();
    const fruit = slotOf(r7, "Fruit duty");
    expect(valueOf(r7, "Fruit duty")).toBe("Milo P.'s family");
    expect(fruit.querySelector(".softpill, .du-claim")).toBeNull();
    expect(within(fruit).queryByText(/Tap to/)).toBeNull();
    // Round 8's fruit is free: exactly one control on the whole screen.
    expect(document.querySelectorAll(".du-claim, .softpill")).toHaveLength(1);
    fireEvent.click(gk);
    expect(document.querySelector(".sheet")).toBeNull();
  });

  it("'Yours' opens the sheet; 'Can't do it after all' releases the claim — POST \"\" and the cleared toast", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]));
    await load(data({ fixtures: [game({ fruit: "p1" })] }));
    await expectChip("Parent of Sam");
    await toDuties();
    const r7 = cardOf(7);
    expect(valueOf(r7, "Fruit duty")).toBe("Sam S.'s family");
    fireEvent.click(within(slotOf(r7, "Fruit duty")).getByText("Yours"));
    expect(sheet().getByText("Fruit duty · Round 7")).toBeTruthy();
    expect(sheet().getByText("Your family is on fruit this round. Thanks!")).toBeTruthy();
    expect(sheet().queryByText(/Yes, I'll/)).toBeNull();
    fireEvent.click(sheet().getByRole("button", { name: "Can't do it after all" }));
    expect(document.querySelector(".sheet")).toBeNull();
    expect(valueOf(r7, "Fruit duty")).toBe("Not assigned yet");
    expect(toast()).toBe("Fruit duty cleared for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r7", duty: "fruit", playerId: "" }]));
    expect(within(slotOf(r7, "Fruit duty")).getByRole("button", { name: "I'll do it" })).toBeTruthy();
  });

  it("a refused write is undone and the server's reason is toasted; a plain failure gets the generic line", async () => {
    meFetch(account("parent", ["p1"], ["Sam Smith"]), { ok: false, status: 403, json: { error: "That duty is already taken." } });
    await load(data());
    await expectChip("Parent of Sam");
    await toDuties();
    const r7 = cardOf(7);
    fireEvent.click(within(slotOf(r7, "Fruit duty")).getByRole("button", { name: "I'll do it" }));
    expect(valueOf(r7, "Fruit duty")).toBe("Sam S.'s family"); // optimistic
    await waitFor(() => expect(toast()).toBe("That duty is already taken."));
    expect(valueOf(r7, "Fruit duty")).toBe("Not assigned yet");
    expect(within(slotOf(r7, "Fruit duty")).getByRole("button", { name: "I'll do it" })).toBeTruthy();
    cleanup();
    meFetch(account("parent", ["p1"], ["Sam Smith"]), { ok: false, status: 500, json: { error: "boom" } });
    await load(data());
    await expectChip("Parent of Sam");
    await toDuties();
    fireEvent.click(within(slotOf(cardOf(7), "Fruit duty")).getByRole("button", { name: "I'll do it" }));
    await waitFor(() => expect(toast()).toBe("Couldn't save — your change was undone."));
    expect(valueOf(cardOf(7), "Fruit duty")).toBe("Not assigned yet");
  });

  it("coach: 'Assign' opens a list of families for fruit and of players with '#7 · FWD' for the keeper; a tap assigns, posts and toasts", async () => {
    meFetch(account("coach"));
    await load(data());
    await expectChip("Coach");
    await toDuties();
    const r7 = cardOf(7);
    const fruit = slotOf(r7, "Fruit duty");
    expect(within(fruit).getByText("Tap to assign")).toBeTruthy();
    fireEvent.click(within(fruit).getByText("Assign"));
    expect(sheet().getByText("Fruit duty · Round 7")).toBeTruthy();
    expect(sheet().getByText(`vs Wests · ${fmt(r7ISO)}`)).toBeTruthy();
    const rows = () => [...document.querySelectorAll(".ds-row")];
    expect(rows().map((r) => r.querySelector(".ds-name").textContent)).toEqual(["Sam Smith's family", "Alex Smith's family", "Milo Park's family"]);
    expect(rows().map((r) => r.querySelector(".ds-sub").textContent)).toEqual(["Jo", "No contact", "No contact"]);
    expect(rows()[0].querySelector(".ds-disc").textContent).toBe("SS");
    expect(sheet().queryByLabelText("Assigned")).toBeNull();
    expect(sheet().queryByText("Clear")).toBeNull();
    fireEvent.click(rows()[0]);
    expect(document.querySelector(".sheet")).toBeNull();
    expect(valueOf(r7, "Fruit duty")).toBe("Sam S.'s family");
    expect(toast()).toBe("Sam S.'s family on fruit for Round 7");
    expect(within(slotOf(r7, "Fruit duty")).getByText("Change")).toBeTruthy();

    fireEvent.click(within(slotOf(r7, "In goal")).getByText("Assign"));
    expect(sheet().getByText("In goal · Round 7")).toBeTruthy();
    expect(rows().map((r) => r.querySelector(".ds-name").textContent)).toEqual(["Sam Smith", "Alex Smith", "Milo Park"]);
    expect(rows().map((r) => r.querySelector(".ds-sub").textContent)).toEqual(["#7 · FWD", "#8 · MID", "#9 · DEF"]);
    fireEvent.click(rows()[2]);
    expect(valueOf(r7, "In goal")).toBe("Milo P.");
    expect(toast()).toBe("Milo P. in goal for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([
      { fixtureId: "r7", duty: "fruit", playerId: "p1" },
      { fixtureId: "r7", duty: "gk", playerId: "p3" }
    ]));
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("coach: 'Change' marks the holder and offers Clear, which posts \"\" and toasts the cleared line", async () => {
    meFetch(account("coach"));
    await load(data({ fixtures: [game({ gk: "p1", fruit: "p2" })] }));
    await expectChip("Coach");
    await toDuties();
    const r7 = cardOf(7);
    fireEvent.click(within(slotOf(r7, "In goal")).getByText("Change"));
    const marked = sheet().getByLabelText("Assigned").closest(".ds-row");
    expect(marked.querySelector(".ds-name").textContent).toBe("Sam Smith");
    expect(sheet().getAllByLabelText("Assigned")).toHaveLength(1);
    fireEvent.click(sheet().getByRole("button", { name: "Clear" }));
    expect(document.querySelector(".sheet")).toBeNull();
    expect(valueOf(r7, "In goal")).toBe("Not assigned yet");
    expect(toast()).toBe("In goal cleared for Round 7");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r7", duty: "gk", playerId: "" }]));
    expect(within(slotOf(r7, "In goal")).getByText("Assign")).toBeTruthy();
    // The fruit slot was left alone.
    expect(valueOf(r7, "Fruit duty")).toBe("Alex S.'s family");
  });

  it("legacy coach mode gets the same controls as a coach hat", async () => {
    fetch.mockImplementation((url) => Promise.resolve(String(url).includes("/api/duty") ? { ok: true, status: 200, json: async () => ({ ok: true }) } : { ok: false, json: async () => ({}) }));
    await load(data());
    await enterCoachMode();
    await toDuties();
    fireEvent.click(within(slotOf(cardOf(8), "In goal")).getByText("Assign"));
    fireEvent.click(sheet().getByText("Alex Smith").closest(".ds-row"));
    expect(valueOf(cardOf(8), "In goal")).toBe("Alex S.");
    expect(toast()).toBe("Alex S. in goal for Round 8");
    await waitFor(() => expect(dutyBodies()).toEqual([{ fixtureId: "r8", duty: "gk", playerId: "p2" }]));
  });

  it("a viewer sees every card and no controls or hints; a past round has none even for the coach", async () => {
    meFetch(account("viewer"));
    await load(data({ fixtures: [game({ fruit: "p1" }), played(), later()] }));
    await expectChip("View only");
    await toDuties();
    expect(cards()).toHaveLength(3);
    expect(document.querySelectorAll(".du-claim, .softpill, .du-hint, .du-slot[role=button]")).toHaveLength(0);
    fireEvent.click(slotOf(cardOf(7), "Fruit duty"));
    expect(document.querySelector(".sheet")).toBeNull();
    cleanup();
    meFetch(account("coach"));
    await load(data());
    await expectChip("Coach");
    await toDuties();
    const r5 = cardOf(5);
    expect(r5.classList.contains("past")).toBe(true);
    expect(r5.querySelectorAll(".du-claim, .softpill, .du-hint, .du-slot[role=button]")).toHaveLength(0);
    expect(valueOf(r5, "Fruit duty")).toBe("Alex S.'s family");
    expect(cardOf(7).querySelectorAll(".softpill")).toHaveLength(2);
  });

  it("the coach's fixture editor no longer carries duty selects — duties are the Duties screen's alone", async () => {
    meFetch(account("coach"));
    await load(data());
    await expectChip("Coach");
    fireEvent.click(within(screen.getByRole("navigation")).getByText("Results"));
    fireEvent.click(await screen.findByText("Add fixture"));
    await screen.findByRole("button", { name: "Save fixture" });
    expect(sheet().queryByText("Fruit duty")).toBeNull();
    expect(sheet().queryByText("Goalkeeper")).toBeNull();
    expect(sheet().queryByText("— none —")).toBeNull();
  });
});
