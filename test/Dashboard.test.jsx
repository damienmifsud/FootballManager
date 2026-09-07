// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import App from "@/components/Dashboard";
import { isoLocal } from "@/lib/dashboardData";
import { signOut } from "next-auth/react";

// The context bar's Sign out calls Auth.js's signOut; under test it just records the call.
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
  // SubscribeCard / AskTab fetch endpoints that don't exist under test.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete window.storage; });

// The header coach button (unique, only present once data has loaded) makes a
// reliable "loaded" anchor — the team name itself appears in multiple cards.
const waitForLoaded = () => screen.findByRole("button", { name: /View/ });

describe("App — loading and data", () => {
  it("shows a loading state, then renders the team header from stored data", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    expect(screen.getByText("Loading…")).toBeTruthy(); // initial synchronous render
    await waitForLoaded();
    expect(screen.getByText(/Div 1 · U8/)).toBeTruthy();
    expect(screen.getByText("Coach Byron · Asst Dee")).toBeTruthy();
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
  it("enters coach mode directly when no PIN is set, revealing the Settings tab", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "" } })) });
    render(<App />);
    await waitForLoaded();
    expect(screen.queryByText("Settings")).toBeNull(); // coach-only tab hidden in view mode

    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    // Now in coach mode: the toggle flips and the Settings tab appears.
    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Coach/ })).toBeTruthy();
  });

  it("does NOT enter coach mode when a PIN is set", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    // Coach mode must stay off: no coach toggle, no coach-only Settings tab.
    expect(screen.queryByRole("button", { name: /Coach/ })).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
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
  const openMatch = async () => {
    fireEvent.click(await screen.findByText("Who's playing?"));
    await screen.findByText("Who's playing? Tap your player");
  };
  const clearCookies = () => document.cookie.split(";").forEach((c) => {
    const k = c.split("=")[0].trim();
    if (k) document.cookie = `${k}=; path=/; max-age=0`;
  });
  // The hat shown in the context bar: the static text next to the "Viewing as" label.
  const hatShown = async () => {
    const lbl = await screen.findByText("Viewing as", { selector: "label" });
    return lbl.closest(".fld").querySelector(".static").textContent;
  };

  it("hides the coach toggle entirely for a parent, and shows the parent chip instead of the legacy sign-in", async () => {
    meFetch(account({ email: "mum@a.com", role: "parent", hats: [parentHat(["p1"], ["Sam Smith"])] }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    expect(await hatShown()).toBe("Parent of Sam");
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
  });

  it("hides the coach toggle and the respond button for a view-only club admin", async () => {
    meFetch(account({ email: "td@club.com", role: "viewer", hats: [viewerHat] }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    expect(await hatShown()).toBe("Club admin (view only)");
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
  });

  it("lets a server-verified coach enter coach mode without the PIN", async () => {
    meFetch(account({ email: "coach@a.com" }));
    // A coachPin is set, but the server-verified role skips the PIN sheet.
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ team: { name: "Test FC", division: "Div 1", ageGroup: "U8", coachPin: "1234" } })) });
    render(<App />);
    const viewBtn = await screen.findByRole("button", { name: /View/ });
    // Wait for /api/me to land before toggling.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(viewBtn);
    expect(await screen.findByText("Settings")).toBeTruthy();
  });

  it("shows a static 'Viewing as Coach' (no hat select) when there is one hat, but always a Team select", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    expect(await hatShown()).toBe("Coach");
    expect(screen.queryByRole("combobox", { name: "Viewing as" })).toBeNull();
    const team = screen.getByRole("combobox", { name: "Team" });
    expect(team.querySelectorAll("option")).toHaveLength(1);
    expect(team.value).toBe("a");
    expect(screen.getByText("Test FC", { selector: "option" })).toBeTruthy();
    expect(document.querySelector(".whoami")).toBeNull();
  });

  it("two hats: the 'Viewing as' select lists them; picking a hat sets the team_slug and act_as cookies", async () => {
    clearCookies();
    const hats = [coachHat, parentHat(["p1"], ["Sam Smith"])];
    meFetch(account({
      email: "both@a.com", hats, canSwitch: true,
      teams: [{ teamSlug: "a", teamName: "Test FC", hats }, { teamSlug: "bees", teamName: "Bees FC", hats: [coachHat] }]
    }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    const hat = await screen.findByRole("combobox", { name: "Viewing as" });
    expect(hat.value).toBe("coach");
    const labels = Array.from(hat.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["Coach", "Parent of Sam"]);
    expect(screen.queryByRole("button", { name: "Switch team or role" })).toBeNull();

    fireEvent.change(hat, { target: { value: "parent" } });
    expect(document.cookie).toContain("team_slug=a");
    expect(document.cookie).toContain("act_as=parent");
    clearCookies();
  });

  it("the Team select lists every team; switching lands in that team's strongest hat and drops its legacy identity cookie", async () => {
    clearCookies();
    document.cookie = "whoami_b=parent-device; path=/";
    const hats = [coachHat, parentHat(["p1"], ["Sam Smith"])];
    meFetch(account({
      email: "both@a.com", hats, canSwitch: true,
      teams: [{ teamSlug: "a", teamName: "Test FC", hats }, { teamSlug: "b", teamName: "Bees FC", hats: [parentHat(["p9"], ["Kai Lee"]), { role: "viewer", playerIds: [], playerNames: [] }] }]
    }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    const team = await screen.findByRole("combobox", { name: "Team" });
    expect(Array.from(team.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Test FC", "Bees FC"]);
    expect(team.value).toBe("a");
    expect(document.cookie).toContain("whoami_b=parent-device");

    fireEvent.change(team, { target: { value: "b" } });
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).toContain("act_as=parent"); // strongest hat on Bees FC is parent, not viewer
    expect(document.cookie).not.toContain("whoami_b=");
    clearCookies();
  });

  it("admins see 'Create a team…' in the Team select and a Club admin link in the account menu", async () => {
    meFetch(account({ email: "admin@club.com", admin: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    const team = await screen.findByRole("combobox", { name: "Team" });
    expect(screen.getByText("Create a team…", { selector: "option" }).value).toBe("__new");
    expect(team.querySelectorAll("option")).toHaveLength(2);
    const summary = screen.getByText("admin@club.com").closest("summary");
    expect(summary.getAttribute("aria-label")).toBe("Account menu");
    fireEvent.click(summary);
    const link = screen.getByRole("link", { name: /Club admin/ });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(link.closest(".ctxbar .menu")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sign out/ }).closest(".menu")).toBeTruthy();
    // The header sub-line no longer carries the link.
    expect(document.querySelector(".head .sub").textContent).not.toContain("Club admin");
  });

  it("a club admin (not super admin) also gets the create-team option and the Club admin link", async () => {
    meFetch(account({ email: "club@club.com", clubAdmin: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByRole("combobox", { name: "Team" });
    expect(screen.getByText("Create a team…", { selector: "option" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Club admin/ }).getAttribute("href")).toBe("/admin");
  });

  it("a plain coach sees neither 'Create a team…' nor the Club admin link", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByRole("combobox", { name: "Team" });
    expect(screen.queryByText("Create a team…")).toBeNull();
    expect(screen.queryByRole("link", { name: /Club admin/ })).toBeNull();
    expect(screen.getByText("coach@a.com").closest("summary")).toBeTruthy();
  });

  it("Sign out in the account menu clears the hat cookies, POSTs /api/logout and calls next-auth signOut", async () => {
    clearCookies();
    document.cookie = "team_slug=a; path=/";
    document.cookie = "act_as=coach; path=/";
    document.cookie = "whoami_a=device; path=/";
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByRole("combobox", { name: "Team" });
    signOut.mockClear();
    fireEvent.click(screen.getByText("coach@a.com").closest("summary"));
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" }));
    expect(fetch).toHaveBeenCalledWith("/api/logout", { method: "POST" });
    expect(document.cookie).not.toContain("team_slug=");
    expect(document.cookie).not.toContain("act_as=");
    expect(document.cookie).not.toContain("whoami_a=");
    clearCookies();
  });

  it("legacy mode (no account): the bar offers 'Sign in to respond' and a Sign out menu item; no floating chip", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    const signin = await screen.findByRole("button", { name: "Sign in to respond" });
    expect(signin.closest(".ctxbar")).toBeTruthy();
    expect(document.querySelector(".whoami")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/logout", { method: "POST" }));
    expect(document.querySelector(".head .sub").textContent).not.toContain("Club admin");
  });

  it("a coach-parent wearing the parent hat gets the parent experience: no coach toggle, In/Out for both of their kids only", async () => {
    meFetch(account({ email: "both@a.com", role: "parent", hats: [coachHat, parentHat(["p1", "p2"], ["Sam Smith", "Alex Smith"])], canSwitch: true }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players: threeKids })) });
    render(<App />);
    // Two hats, so the hat field is a select showing the worn one.
    const hat = await screen.findByRole("combobox", { name: "Viewing as" });
    expect(hat.value).toBe("parent");
    expect(hat.selectedOptions[0].textContent).toBe("Parent of Sam & Alex");
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    await openMatch();
    expect(screen.getAllByRole("button", { name: "In" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Out" })).toHaveLength(2);
    // Milo's row is read-only (a pill, not buttons) and no legacy sign-in button appears.
    const milo = screen.getByText(/Milo Park/).closest(".avrow");
    expect(milo.querySelector(".avbtn")).toBeNull();
    expect(milo.querySelector(".avpill")).toBeTruthy();
    expect(screen.queryByText("Sign in to mark your child")).toBeNull();
    expect(screen.getByText(/You're marking Sam & Alex\./)).toBeTruthy();
  });

  it("a view-only club admin gets no In/Out buttons and no sign-in button in the match sheet", async () => {
    meFetch(account({ email: "td@club.com", role: "viewer", hats: [viewerHat] }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players: threeKids })) });
    render(<App />);
    expect(await hatShown()).toBe("Club admin (view only)");
    await openMatch();
    expect(screen.queryByRole("button", { name: "In" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Out" })).toBeNull();
    expect(screen.queryByText("Sign in to mark your child")).toBeNull();
    expect(screen.getByText("Club admins can see replies but can't respond.")).toBeTruthy();
  });

  it("shows no View/Coach toggle at all until /api/me has answered", async () => {
    fetch.mockImplementation((url) => {
      if (String(url).includes("/api/me")) return new Promise(() => {}); // never answers
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByText(/Div 1 · U8/);
    expect(screen.queryByRole("button", { name: /View/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Coach/ })).toBeNull();
    expect(screen.queryByText(/Sign in to respond/)).toBeNull();
  });

  it("viewingAs: a coach edit writes nothing and shows the read-only notice", async () => {
    meFetch(account({ email: "admin@club.com", admin: true, realAdmin: true, viewingAs: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByText("Settings")); // proves coach mode; also the Club admin link is there
    expect(screen.getByRole("link", { name: /Club admin/ }).getAttribute("href")).toBe("/admin");
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(await screen.findByText("Add fixture"));
    fireEvent.click(await screen.findByRole("button", { name: "Save fixture" }));
    expect(await screen.findByText("Read only while viewing as coach@a.com.")).toBeTruthy();
    expect(storage.set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Read only while viewing as/)).toBeNull();
  });

  it("hides the Coach PIN field and the PIN advice in Settings in account mode", async () => {
    meFetch(account({ email: "coach@a.com" }));
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /View/ }));
    fireEvent.click(await screen.findByText("Settings"));
    await screen.findByText("Team details");
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
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /View/ }));
    fireEvent.click(screen.getByText("Results"));
    await screen.findByText("Add fixture");
    expect(container.querySelectorAll(".sqrow")).toHaveLength(1);
    fireEvent.click(screen.getByText("Add fixture"));
    fireEvent.click(await screen.findByRole("button", { name: "Save fixture" }));
    expect(await screen.findByText(/Couldn't save — your change was undone\. quota/)).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll(".sqrow")).toHaveLength(1));
  });
});

describe("App — RSVP toggle (match modal)", () => {
  it("marks a player 'in', updating the count and POSTing to /api/rsvp", async () => {
    // RSVP succeeds so the optimistic update sticks (a failed POST reverts it).
    fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /View/ })); // coach can mark anyone

    // Open the match modal from the Home "Who's playing?" card.
    fireEvent.click(screen.getByText("Who's playing?"));
    const inBtn = await screen.findByRole("button", { name: "In" });
    fireEvent.click(inBtn);

    // Optimistic count update in the modal, and the RSVP POST.
    expect(await screen.findByText("1 in")).toBeTruthy();
    await waitFor(() => {
      const call = fetch.mock.calls.find(c => String(c[0]).includes("/api/rsvp"));
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toMatchObject({ kind: "game", id: "f1", playerId: "p1", status: "in" });
    });
  });
});

describe("App — per-team feature flags (duties)", () => {
  it("shows fruit + goalkeeper tiles by default, with jersey duty off", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await screen.findByRole("button", { name: /View/ });
    expect(screen.getByText("Fruit duty")).toBeTruthy();
    expect(screen.getByText("In goal")).toBeTruthy();
    expect(screen.queryByText("Jerseys")).toBeNull();
  });

  it("honours the flags: jersey on, fruit and goalkeeper off", async () => {
    const data = makeData();
    data.team.features = { fruitDuty: false, gkDuty: false, jerseyDuty: true };
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    render(<App />);
    await screen.findByRole("button", { name: /View/ });
    expect(screen.getByText("Jerseys")).toBeTruthy();
    expect(screen.queryByText("Fruit duty")).toBeNull();
    expect(screen.queryByText("In goal")).toBeNull();
    // Duties tab shows only the jersey section.
    fireEvent.click(screen.getByText("Duties"));
    expect(await screen.findByText("Jersey washing")).toBeTruthy();
    expect(screen.queryByText("Goalkeeper")).toBeNull();
  });
});

describe("App — Squadi-style results rows", () => {
  const withFixtures = (fixtures) => makeData({ fixtures });

  it("renders crests from the local registry (never Squadi's hotlink) and an initials disc for unknown clubs", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "f1", round: 1, status: "played", dateISO: "2026-05-02", time: "09:00", opponent: "Oxley United FC U8 Eagles", opponentLogo: "https://squadi.example/oxley.png", homeAway: "H", venue: "X", us: 2, them: 1, availability: {} },
      { id: "f2", round: 2, status: "played", dateISO: "2026-05-09", time: "09:00", opponent: "Wests", opponentLogo: "https://squadi.example/wests.png", homeAway: "A", venue: "X", us: 1, them: 1, availability: {} }
    ])) });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /View/ });
    fireEvent.click(screen.getByText("Results"));
    const srcs = [...container.querySelectorAll(".sqrow img.sqcrest")].map((i) => i.getAttribute("src"));
    expect(srcs).toContain("/crests/oxley-united.png");
    expect(srcs.filter((s) => s === "/crests/olympic-fc.png")).toHaveLength(2); // our side on both rows
    expect(srcs.some((s) => /^https?:/.test(s))).toBe(false);
    // Unknown club: initials disc, no image.
    const rows = container.querySelectorAll(".sqrow");
    expect(rows[1].querySelector(".sqcrest-ph").textContent).toBe("W");
    expect(container.querySelector('img[src^="http"]')).toBeNull();
  });

  it("flips an away game (home team left) but colours the score by our result", async () => {
    // Olympic away win 3–1 → rendered home-perspective as 1–3 with a WIN chip.
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "f1", round: 4, status: "played", dateISO: "2026-05-02", time: "09:00", opponent: "Wests", homeAway: "A", venue: "X", us: 3, them: 1, availability: {} }
    ])) });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /View/ });
    fireEvent.click(screen.getByText("Results"));
    const row = container.querySelector(".sqrow");
    expect(row.querySelector(".sqscore").className).toContain("win");
    expect(row.querySelector(".sqscore").textContent).toBe("1–3");
    // Away flip: opponent (home side) renders first, Olympic highlighted on the right.
    const names = [...row.querySelectorAll(".sqname")].map((n) => n.textContent);
    expect(names).toEqual(["Wests", "Test FC"]);
    expect(row.querySelector(".sqteam.away").className).toContain("squs");
  });

  it("renders the non-score states as chips (cancelled dims the row)", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(withFixtures([
      { id: "c1", round: 1, status: "cancelled", dateISO: "2026-05-02", opponent: "A", homeAway: "H", us: null, them: null, availability: {} },
      { id: "u1", round: 2, status: "upcoming", dateISO: "2099-05-02", opponent: "B", homeAway: "H", us: null, them: null, availability: {} },
      { id: "n1", round: 3, status: "played", dateISO: "2020-01-01", opponent: "C", homeAway: "H", us: null, them: null, availability: {} }
    ])) });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: /View/ });
    fireEvent.click(screen.getByText("Results"));
    expect(screen.getByText("Canc")).toBeTruthy();
    expect(screen.getByText("Upcoming")).toBeTruthy();
    expect(screen.getByText("No score")).toBeTruthy();
    expect(container.querySelector(".sqrow.canc")).toBeTruthy();
  });
});

describe("App — coach edit-save (fixture)", () => {
  it("persists a new fixture via window.storage and clears the sample flag", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /View/ })); // coach mode

    fireEvent.click(screen.getByText("Results"));          // Fixtures tab
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
const enterCoachMode = async () => {
  await waitForLoaded();
  fireEvent.click(screen.getByRole("button", { name: /View/ }));
  await screen.findByText("Settings");
};

describe("Match day hub card", () => {
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

  // Coach mode -> Results tab -> tap the fixture row -> hub card in the sheet.
  const openHub = async (container) => {
    await enterCoachMode();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".sqrow"));
    await screen.findByText("Match day");
  };
  // The four .stg cells in order: Availability, Plan, Live, Record.
  const stage = (i) => document.querySelectorAll(".stg")[i];

  it("nobody replied: Availability is 'now' with counts and the no-reply line names both kids", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture()] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("now");
    expect(stage(0).textContent).toContain("0 in · 0 out · 2 no reply");
    expect(screen.getByText("Seyjan and Milo haven't replied. They're counted in until you mark them out.")).toBeTruthy();
    // Plan not started, Live/Record still to come, coach-only pill and primary button.
    expect(stage(1).className).not.toMatch(/now|done/);
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Kick-off 09:00")).toBeTruthy();
    expect(screen.getByText("After full time")).toBeTruthy();
    expect(screen.getByText("Coach only")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the plan" })).toBeTruthy();
  });

  it("one reply outstanding: '1 in · 0 out · 1 no reply' and a singular no-reply line", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ availability: { p1: { status: "in", by: "Coach", at: 1 } } })] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("now");
    expect(stage(0).textContent).toContain("1 in · 0 out · 1 no reply");
    expect(screen.getByText("Milo hasn't replied. They're counted in until you mark them out.")).toBeTruthy();
  });

  it("everyone replied: Availability is done with in/out counts and no no-reply line", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ availability: { p1: { status: "in", by: "Coach", at: 1 }, p2: { status: "out", reason: "Sick", by: "Coach", at: 1 } } })] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("done");
    expect(stage(0).textContent).toContain("1 in · 1 out");
    expect(screen.queryByText(/replied\. They're counted in/)).toBeNull();
  });

  it("a no-reply player the coach marked OUT in the planner is counted out: no dot, no no-reply line", async () => {
    const f = fixture({
      availability: { p1: { status: "in", by: "Coach", at: 1 } }, // Milo: no reply
      plan: { subTimes: [], assignments: [], overrides: { p2: "out" }, updatedAt: 1 }
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("done");
    expect(stage(0).textContent).toContain("1 in · 1 out");
    expect(stage(0).textContent).not.toContain("no reply");
    expect(screen.queryByText(/replied\. They're counted in/)).toBeNull();
    expect(document.querySelectorAll(".rdot")).toHaveLength(0);
  });

  it("a no-reply player the coach marked IN in the planner is counted in: no dot, no no-reply line", async () => {
    const f = fixture({
      availability: { p1: { status: "in", by: "Coach", at: 1 } }, // Milo: no reply
      plan: { subTimes: [], assignments: [], overrides: { p2: "in" }, updatedAt: 1 }
    });
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("done");
    expect(stage(0).textContent).toContain("2 in · 0 out");
    expect(screen.queryByText(/replied\. They're counted in/)).toBeNull();
    expect(document.querySelectorAll(".rdot")).toHaveLength(0);
  });

  it("an override on one player leaves the other no-reply player dotted and named", async () => {
    const f = fixture({ plan: { subTimes: [], assignments: [], overrides: { p1: "in" }, updatedAt: 1 } }); // nobody RSVP'd
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [f] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(0).className).toContain("now");
    expect(stage(0).textContent).toContain("1 in · 0 out · 1 no reply");
    expect(screen.getByText("Milo hasn't replied. They're counted in until you mark them out.")).toBeTruthy();
    expect(document.querySelectorAll(".rdot")).toHaveLength(1);
  });

  it("half-filled plan: Plan is 'now' with 'Gaps to fill'", async () => {
    const data = makeData({ players: four, fixtures: [fixture({ plan: { subTimes: [], assignments: [{ r0c0: "p1" }, {}], updatedAt: 1 } })] });
    data.team.matchFormat = u7;
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(1).className).toContain("now");
    expect(screen.getByText("Gaps to fill")).toBeTruthy();
  });

  it("complete plan: Plan is done with the block count", async () => {
    // 4v4, no keeper, 2 halves and no extra subs -> 2 blocks, 4 spots each.
    const data = makeData({ players: four, fixtures: [fixture({ plan: { subTimes: [], assignments: [fullBlock, fullBlock], updatedAt: 1 } })] });
    data.team.matchFormat = u7;
    storage.get.mockResolvedValue({ value: JSON.stringify(data) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(1).className).toContain("done");
    expect(screen.getByText("Lineup set · 2 blocks")).toBeTruthy();
  });

  it("game day: Live is 'now' and the primary button reads 'Kick off'", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ dateISO: isoLocal(new Date()) })] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(2).className).toContain("now");
    expect(screen.getByRole("button", { name: "Kick off" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open the plan" })).toBeNull();
  });

  it("record present: Record (and Live) are done and read 'Saved'", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ status: "played", dateISO: "2026-05-02", us: 2, them: 1, record: { savedAt: 1, savedBy: "Coach", minutes: [{ pid: "p1", min: 30 }] } })] })) });
    const { container } = render(<App />);
    await openHub(container);
    expect(stage(3).className).toContain("done");
    expect(stage(2).className).toContain("done");
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("parents see no hub, but do get the live-lineup button once a plan exists", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture({ plan: { subTimes: [], assignments: [{ r0c0: "p1" }, {}], updatedAt: 1 } })] })) });
    const { container } = render(<App />);
    await waitForLoaded(); // stay in view mode
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".sqrow"));
    expect(await screen.findByText("Match day — live lineup")).toBeTruthy();
    expect(screen.queryByText("Match day")).toBeNull();
    expect(screen.queryByText("Coach only")).toBeNull();
    expect(document.querySelector(".stages")).toBeNull();
  });

  it("parents get no button at all when there is no plan yet", async () => {
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData({ players, fixtures: [fixture()] })) });
    const { container } = render(<App />);
    await waitForLoaded();
    fireEvent.click(screen.getByText("Results"));
    fireEvent.click(container.querySelector(".sqrow"));
    await screen.findByText("Who's playing? Tap your player");
    expect(screen.queryByText("Match day — live lineup")).toBeNull();
    expect(screen.queryByText("Match day")).toBeNull();
  });
});

describe("Settings — parents can see", () => {
  it("toggles a switch, POSTs only parentsSee to /api/team-settings and flips aria-checked", async () => {
    stubNarrowRoutes();
    storage.get.mockResolvedValue({ value: JSON.stringify(makeData()) });
    render(<App />);
    await enterCoachMode();
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
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
    fireEvent.click(screen.getByText("Settings"));
    fireEvent.click(await screen.findByRole("switch", { name: "Keeper changes only at the break" }));
    expect(await screen.findByText("Couldn't save — try again.")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
  });
});

describe("Player sheet — ratings", () => {
  const openPlayer = async () => {
    fireEvent.click(screen.getByText("Squad"));
    fireEvent.click(await screen.findByText("Sam Smith"));
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

  it("shows the four season tiles from match records, and no Ratings card for a parent", async () => {
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
    const tiles = [...document.querySelectorAll(".statgrid .stat")].map((t) => t.querySelector(".k").textContent + "=" + t.querySelector(".v").textContent);
    expect(tiles).toEqual(["Games=2", "Min=56", "Goals=1", "Assists=0"]);
    expect(screen.queryByText("Ratings")).toBeNull();
    expect(screen.queryByText("Coach only")).toBeNull();
  });
});
