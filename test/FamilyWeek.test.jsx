// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import FamilyWeek from "@/components/FamilyWeek";
import MyTeams from "@/components/MyTeams";
import { teamsFor } from "@/lib/hats";

// Both teams together on My teams: the next two weeks for a family on two or
// more teams, with replies given from the one page. /api/family and /api/rsvp
// are stood in for here; the route and the builder have their own tests.
// Everyone is made up.
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const TODAY = "2026-06-10"; // a Wednesday
const U9 = { teamSlug: "u9", teamName: "Riverside FC U9 Reds" };
const U11 = { teamSlug: "u11", teamName: "Riverside FC U11 Blues" };
const FF = { teamSlug: "ff", teamName: "Fast Fives" };
const item = (team, over) => ({ ...team, kind: "game", what: "game", id: "f1", dateISO: TODAY, time: "09:00", title: "vs Wests", place: "Perry Park", label: "Round 7", replies: [], ...over });
const week = (over = {}) => ({
  todayISO: TODAY, days: 14,
  teams: [
    { ...U9, players: [{ id: "p1", name: "Leo K." }] },
    { ...U11, players: [{ id: "p3", name: "Mia K." }] },
    { ...FF, players: [{ id: "p7", name: "Sam K.", isSelf: true }] }
  ],
  items: [
    item(FF, { id: "g0", dateISO: "2026-06-10", time: "19:10", title: "vs Rovers", place: "Court 2", label: "Round 3", replies: [{ playerId: "p7", name: "Sam K.", isSelf: true, status: null }] }),
    item(U9, { kind: "session", what: "training", id: "s1", occ: "2026-06-11", dateISO: "2026-06-11", time: "17:00", endTime: "18:00", title: "Training", place: "Field 3", label: "", replies: [{ playerId: "p1", name: "Leo K.", status: "in" }] }),
    item(U11, { id: "g1", dateISO: "2026-06-13", time: "08:15", title: "vs Lions", place: "Lion Park", label: "Round 2", replies: [{ playerId: "p3", name: "Mia K.", status: null }] }),
    item(U9, { id: "f1", dateISO: "2026-06-13", time: "09:00", replies: [{ playerId: "p1", name: "Leo K.", status: "out", reason: "Away" }] })
  ],
  ...over
});

let current;          // what /api/family answers now
let rsvp;             // what /api/rsvp answers: { ok, status, json }
let onReply;          // called with the body of each reply, to change `current`
beforeEach(() => {
  current = week();
  rsvp = { ok: true, status: 200, json: { ok: true } };
  onReply = null;
  document.cookie = "teams_view=; path=/; max-age=0";
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes("/api/family")) return { ok: true, json: async () => JSON.parse(JSON.stringify(current)) };
    if (u.includes("/api/rsvp")) {
      if (rsvp.ok && onReply) onReply(JSON.parse(init.body));
      return { ok: rsvp.ok, status: rsvp.status, json: async () => rsvp.json };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "teams_view=; path=/; max-age=0"; });

const calls = (path) => fetch.mock.calls.filter((c) => String(c[0]).includes(path));
const replyBodies = () => calls("/api/rsvp").map((c) => JSON.parse(c[1].body));
const show = async () => { render(<FamilyWeek />); await screen.findByText("Coming up"); await waitFor(() => expect(document.querySelector(".auth-day")).toBeTruthy()); };
const days = () => [...document.querySelectorAll(".auth-day")];
const dayHeads = () => days().map((d) => d.querySelector(".auth-day-head").textContent);
const events = (scope = document) => [...scope.querySelectorAll(".auth-ev")];
const ev = (title) => events().find((e) => e.querySelector(".auth-ev-title").textContent === title);
const replyRow = (title, who) => [...ev(title).querySelectorAll(".auth-reply")].find((r) => r.querySelector(".who").textContent === who);
const sheet = () => within(screen.getByRole("dialog"));
const seg = (name) => screen.getByRole("button", { name });

describe("Both teams together", () => {
  it("lists the next two weeks across the family's teams by day, each event with its team and the family's own replies", async () => {
    await show();
    expect(calls("/api/family")).toHaveLength(1);
    expect(seg("Together").getAttribute("aria-pressed")).toBe("true");
    expect(seg("One team at a time").getAttribute("aria-pressed")).toBe("false");
    expect(dayHeads()).toEqual(["TodayWed 10 Jun", "TomorrowThu 11 Jun", "Sat 13 Jun"]);
    expect(events().map((e) => [
      e.querySelector(".auth-ev-title").textContent, e.querySelector(".auth-ev-meta").textContent,
      [...e.querySelectorAll(".auth-ev-tags > *")].map((t) => t.textContent)
    ])).toEqual([
      ["vs Rovers", "19:10 · Court 2", ["Fast Fives", "Round 3"]],
      ["Training", "17:00–18:00 · Field 3", ["U9 Reds"]],          // the club's name dropped where most teams share it
      ["vs Lions", "08:15 · Lion Park", ["U11 Blues", "Round 2"]],
      ["vs Wests", "09:00 · Perry Park", ["U9 Reds", "Round 7"]]
    ]);
    // Their own reply reads You; a child goes by first name. The button says where each stands.
    expect(events().map((e) => [...e.querySelectorAll(".auth-reply")].map((r) => [r.querySelector(".who").textContent, r.querySelector(".auth-rr").textContent, r.querySelector(".auth-rr").className])))
      .toEqual([[["You", "Reply", "auth-rr"]], [["Leo", "In", "auth-rr in"]], [["Mia", "Reply", "auth-rr"]], [["Leo", "Out", "auth-rr out"]]]);
    expect(screen.getByRole("status").textContent).toBe("2 replies to give");
    expect(ev("Training").querySelector(".auth-ev-ic").className).toBe("auth-ev-ic training");
  });

  it("a reply names its team and its player, and the list is read again from the server", async () => {
    onReply = (body) => { current.items[2].replies[0].status = body.status; };
    await show();
    fireEvent.click(within(replyRow("vs Lions", "Mia")).getByRole("button"));
    expect(sheet().getByText("Reply for Mia")).toBeTruthy();
    expect(sheet().getByText("vs Lions · Sat 13 Jun · 08:15 · U11 Blues")).toBeTruthy();
    expect(sheet().getByText(/You can change it any time before kick-off\./)).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(replyBodies()).toEqual([{ kind: "game", id: "g1", playerId: "p3", status: "in", teamSlug: "u11" }]);
    await waitFor(() => expect(within(replyRow("vs Lions", "Mia")).getByRole("button").textContent).toBe("In"));
    expect(calls("/api/family")).toHaveLength(2);
    expect(screen.getByText("Mia's in for Saturday")).toBeTruthy();
    expect(screen.getByText("1 reply to give")).toBeTruthy();
  });

  it("Out carries the note as the reason; a training reply carries its date; their own reply is said as theirs", async () => {
    await show();
    fireEvent.click(within(replyRow("Training", "Leo")).getByRole("button"));
    expect(sheet().getByText("Reply for Leo")).toBeTruthy();
    expect(sheet().getByText(/before it starts\./)).toBeTruthy();
    expect(sheet().getByRole("button", { name: "In" }).getAttribute("aria-pressed")).toBe("true"); // where it stands now
    fireEvent.change(sheet().getByLabelText("Note for coach"), { target: { value: "  School camp " } });
    fireEvent.click(sheet().getByRole("button", { name: "Out" }));
    await waitFor(() => expect(replyBodies()).toHaveLength(1));
    expect(replyBodies()[0]).toEqual({ kind: "session", id: "s1", occ: "2026-06-11", playerId: "p1", status: "out", reason: "School camp", teamSlug: "u9" });
    expect(await screen.findByText("Leo's out for Thursday")).toBeTruthy();

    fireEvent.click(within(replyRow("vs Rovers", "You")).getByRole("button"));
    expect(sheet().getByText("Your reply")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(replyBodies()).toHaveLength(2));
    expect(replyBodies()[1]).toEqual({ kind: "game", id: "g0", playerId: "p7", status: "in", teamSlug: "ff" });
    expect(await screen.findByText("You're in for Wednesday")).toBeTruthy();
  });

  it("choosing the answer already given clears it", async () => {
    await show();
    fireEvent.click(within(replyRow("vs Wests", "Leo")).getByRole("button", { name: /Reply for Leo, vs Wests, Sat 13 Jun: Out/ }));
    fireEvent.click(sheet().getByRole("button", { name: "Out" }));
    await waitFor(() => expect(replyBodies()).toHaveLength(1));
    expect(replyBodies()[0]).toEqual({ kind: "game", id: "f1", playerId: "p1", status: null, teamSlug: "u9" });
    expect(await screen.findByText("Leo's reply cleared")).toBeTruthy();
  });

  it("a reply the server refuses is said in the sheet, which stays open; nothing is shown as changed", async () => {
    rsvp = { ok: false, status: 403, json: { error: "forbidden" } };
    await show();
    fireEvent.click(within(replyRow("vs Lions", "Mia")).getByRole("button"));
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    expect((await sheet().findByRole("alert")).textContent).toBe("Couldn't save that reply. Try again.");
    expect(calls("/api/family")).toHaveLength(1); // not read again: nothing changed
    // A reason the server gives in words is passed on as written.
    rsvp = { ok: false, status: 403, json: { error: "You're viewing as another user — read only. Exit view-as to make changes." } };
    fireEvent.click(sheet().getByRole("button", { name: "In" }));
    await waitFor(() => expect(sheet().getByRole("alert").textContent).toMatch(/read only/));
    fireEvent.click(sheet().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(replyRow("vs Lions", "Mia")).getByRole("button").textContent).toBe("Reply");
  });

  it("a paired round says one reply covers both games; a cancelled game asks nobody; an event that needs no reply says so", async () => {
    current = week({ items: [
      item(U9, { id: "r", time: "09:00", title: "vs Wests", label: "Round 4 · Red", paired: true, replies: [{ playerId: "p1", name: "Leo K.", status: null }] }),
      item(U9, { id: "c", time: "11:00", title: "vs Rained off", cancelled: true, replies: [] }),
      item(U11, { id: "w", time: "12:00", title: "vs Winter", label: "Winterfest · Round 1", replies: [] })
    ] });
    await show();
    fireEvent.click(within(replyRow("vs Wests", "Leo")).getByRole("button"));
    expect(sheet().getByText("Your reply covers both games this round.")).toBeTruthy();
    fireEvent.click(sheet().getByRole("button", { name: "Cancel" }));
    expect([...ev("vs Rained off").querySelectorAll(".auth-ev-tags > *")].map((t) => t.textContent)).toEqual(["U9 Reds", "Round 7", "Cancelled"]);
    expect(ev("vs Rained off").querySelector(".auth-reply")).toBeNull();
    expect(ev("vs Rained off").querySelector(".auth-ev-note")).toBeNull();
    expect(ev("vs Winter").querySelector(".auth-ev-note").textContent).toBe("No reply needed for this one.");
    expect(screen.getByRole("status").textContent).toBe("1 reply to give");
  });

  it("an event with no time yet says so; with every reply given the count says All replied; nothing on is said plainly", async () => {
    current = week({ items: [item(U9, { time: "", place: "", replies: [{ playerId: "p1", name: "Leo K.", status: "in" }] })] });
    await show();
    expect(ev("vs Wests").querySelector(".auth-ev-meta").textContent).toBe("Time to come");
    expect(screen.getByRole("status").textContent).toBe("All replied");
    cleanup();
    current = week({ items: [] });
    render(<FamilyWeek />);
    expect(await screen.findByText("Nothing on in the next two weeks.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("viewing as a family, the replies are shown and cannot be changed", async () => {
    current = week({ readOnly: true });
    await show();
    expect(screen.getByText("Read only while viewing as someone else.")).toBeTruthy();
    expect(document.querySelectorAll(".auth-rr")).toHaveLength(0);
    expect(events().map((e) => [...e.querySelectorAll(".auth-reply .auth-pill")].map((p) => [p.textContent, p.className])))
      .toEqual([[["No reply", "auth-pill st"]], [["In", "auth-pill st in"]], [["No reply", "auth-pill st"]], [["Out", "auth-pill st out"]]]);
  });

  it("when the list cannot be loaded it says so and offers to try again", async () => {
    fetch.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    render(<FamilyWeek />);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't load what is coming up.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(document.querySelector(".auth-day")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Together, or one team at a time", () => {
  it("One team at a time puts the list away and is remembered; Together brings it back", async () => {
    await show();
    fireEvent.click(seg("One team at a time"));
    expect(seg("One team at a time").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".auth-day")).toBeNull();
    expect(screen.queryByText("Coming up")).toBeNull();
    expect(screen.getByText("Open a team below. Together shows the next two weeks for all of them in one list.")).toBeTruthy();
    expect(document.cookie).toContain("teams_view=separate");
    // The next visit starts the same way, without asking the server for the list.
    cleanup();
    fetch.mockClear();
    render(<FamilyWeek />);
    await waitFor(() => expect(seg("One team at a time").getAttribute("aria-pressed")).toBe("true"));
    expect(calls("/api/family")).toHaveLength(0);
    fireEvent.click(seg("Together"));
    await waitFor(() => expect(document.querySelector(".auth-day")).toBeTruthy());
    expect(document.cookie).toContain("teams_view=together");
    expect(calls("/api/family")).toHaveLength(1);
  });
});

describe("My teams with a family on two teams", () => {
  const parent = (t, playerId, playerName) => ({ ...t, role: "parent", playerId, playerName });
  it("shows them together above the cards, which still open one team each", async () => {
    render(<MyTeams teams={teamsFor([parent(U9, "p1", "Leo K."), parent(U11, "p3", "Mia K.")])} email="sam@example.com" family />);
    await screen.findByText("Coming up");
    const label = screen.getByText("Open a team");
    const cards = [...document.querySelectorAll(".auth-mine")];
    expect(cards.map((c) => c.querySelector(".auth-team-name").textContent)).toEqual(["Riverside FC U11 Blues", "Riverside FC U9 Reds"]);
    // In reading order: the choice, the list, then the label and the cards.
    const section = screen.getByRole("region", { name: "My teams together" });
    expect(section.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cards[1]);
    expect(document.cookie).toContain("team_slug=u9");
  });

  it("anyone else gets My teams as it was: no list, no choice, and the server is not asked", async () => {
    render(<MyTeams teams={teamsFor([{ ...U9, role: "coach" }, parent(U11, "p3", "Mia K.")])} email="sam@example.com" />);
    expect(screen.queryByRole("region", { name: "My teams together" })).toBeNull();
    expect(screen.queryByText("Open a team")).toBeNull();
    expect(screen.queryByRole("button", { name: "Together" })).toBeNull();
    await Promise.resolve();
    expect(calls("/api/family")).toHaveLength(0);
  });
});
