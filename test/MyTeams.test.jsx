// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import MyTeams from "@/components/MyTeams";
import { teamsFor } from "@/lib/hats";

// My teams (/teams): a card per team the person is on themselves, their roles
// there as pills, and the way into club admin for the people who run the
// club. Opening a team writes the team_slug AND act_as cookies (validated
// server-side) and drops any legacy per-device whoami_<slug> identity.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut }));

const clearCookies = () => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
};
afterEach(() => { cleanup(); clearCookies(); vi.clearAllMocks(); });

const coach = (slug, name, over = {}) => ({ teamSlug: slug, teamName: name, role: "coach", ...over });
const parent = (slug, name, playerId, playerName) => ({ teamSlug: slug, teamName: name, role: "parent", playerId, playerName });
const clubCoach = (slug, name) => ({ teamSlug: slug, teamName: name, role: "coach", admin: true, club: true });
const clubView = (slug, name) => ({ teamSlug: slug, teamName: name, role: "viewer", clubAdmin: true, club: true });
const show = (memberships, props = {}) => render(<MyTeams teams={teamsFor(memberships)} email="sam@example.com" {...props} />);
const cards = () => [...document.querySelectorAll(".auth-mine")];
const pills = (card) => [...card.querySelectorAll(".auth-pill")].map((p) => p.textContent);

describe("My teams", () => {
  it("heads the page and says who is signed in", () => {
    show([coach("a", "Team A")]);
    expect(document.querySelector(".auth-title").textContent).toBe("My teams");
    expect(screen.getByText("Signed in as sam@example.com")).toBeTruthy();
  });

  it("one card per team, sorted by name, with every role held there as a pill", () => {
    show([
      parent("b", "Under 11 Blues", "p3", "Mia Kelly"),
      coach("a", "Under 9 Reds", { staffRole: "Assistant coach" }),
      parent("a", "Under 9 Reds", "p1", "Leo Kelly"),
      parent("a", "Under 9 Reds", "p2", "Ana Kelly")
    ]);
    expect(cards().map((c) => c.querySelector(".auth-team-name").textContent)).toEqual(["Under 11 Blues", "Under 9 Reds"]);
    expect(pills(cards()[0])).toEqual(["Parent of Mia"]);
    expect(pills(cards()[1])).toEqual(["Assistant coach", "Parent of Leo & Ana"]);
    // Staff and family read apart at a glance.
    expect(cards()[1].querySelector(".auth-pill.staff").textContent).toBe("Assistant coach");
    expect(cards()[1].querySelector(".auth-pill.family").textContent).toBe("Parent of Leo & Ana");
    // Each card is one button named by its team and roles.
    expect(screen.getByRole("button", { name: "Under 9 Reds: Assistant coach, Parent of Leo & Ana" })).toBe(cards()[1]);
  });

  it("opening a team wears the strongest role there, and drops a stale per-device identity", () => {
    document.cookie = "whoami_a=stale; path=/";
    show([coach("a", "Team A"), parent("a", "Team A", "p1", "Leo"), parent("b", "Team B", "p2", "Mia")]);
    fireEvent.click(cards()[0]);
    expect(document.cookie).toContain("team_slug=a");
    expect(document.cookie).toContain("act_as=coach");
    expect(document.cookie).not.toContain("whoami_a=");
    fireEvent.click(cards()[1]);
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).toContain("act_as=parent");
  });

  it("a team they play in is theirs: a Player pill in the family tint, opened in that role", () => {
    const player = (slug, name, playerId, playerName) => ({ teamSlug: slug, teamName: name, role: "player", playerId, playerName });
    show([
      player("ff", "Fast Fives", "p7", "Jo Park"),
      player("u9", "Under 9 Reds", "p1", "Jo Park"), parent("u9", "Under 9 Reds", "p2", "Leo Park"),
      coach("u11", "Under 11 Blues", { staffRole: "Manager" }), player("u11", "Under 11 Blues", "p4", "Jo Park")
    ]);
    expect(cards().map((c) => [c.querySelector(".auth-team-name").textContent, pills(c)])).toEqual([
      ["Fast Fives", ["Player"]],
      ["Under 11 Blues", ["Manager", "Player"]],
      ["Under 9 Reds", ["Player and parent of Leo"]]
    ]);
    expect(cards()[0].querySelector(".auth-pill.family").textContent).toBe("Player");
    expect(screen.getByRole("button", { name: "Fast Fives: Player" })).toBe(cards()[0]);
    fireEvent.click(cards()[0]);
    expect(document.cookie).toContain("team_slug=ff");
    expect(document.cookie).toContain("act_as=parent"); // the family hat: there is no separate player hat to ask for
  });

  it("someone on no team is told how a login gets linked, as a parent or as a player", () => {
    show([]);
    expect(screen.getByText("No team is linked to this login yet")).toBeTruthy();
    expect(screen.getByText("Ask your coach to add this email to your child's record, or to your own if you play, then sign in again.")).toBeTruthy();
  });

  it("a plain member sees no club section", () => {
    show([coach("a", "Team A"), parent("b", "Team B", "p1", "Leo")]);
    expect(screen.queryByText("Club")).toBeNull();
    expect(screen.queryByRole("link", { name: /Club admin/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("a view-only role given on purpose is a team of their own, with a plain pill", () => {
    show([{ teamSlug: "a", teamName: "Team A", role: "viewer" }]);
    expect(pills(cards()[0])).toEqual(["View only"]);
    expect(cards()[0].querySelector(".auth-pill").className).toBe("auth-pill");
  });
});

describe("My teams — the people who run the club", () => {
  it("a super admin sees only the teams they are on, not every team they can open", () => {
    show([clubCoach("a", "Team A"), clubCoach("b", "Team B"), parent("b", "Team B", "p1", "Leo"), clubCoach("c", "Team C"), clubCoach("d", "Team D")], { admin: "super" });
    expect(cards().map((c) => c.querySelector(".auth-team-name").textContent)).toEqual(["Team B"]);
    // Their own role is the pill; the club-level access is not listed as one.
    expect(pills(cards()[0])).toEqual(["Parent of Leo"]);
    expect(document.body.textContent).not.toContain("Super admin");
    // Everything else is one tap away in club admin.
    const link = screen.getByRole("link", { name: /Club admin/ });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(within(link).getByText("All 4 teams and who can do what")).toBeTruthy();
  });

  it("opening their own team still lands in the strongest role they hold there, club-level included", () => {
    show([clubCoach("b", "Team B"), parent("b", "Team B", "p1", "Leo")], { admin: "super" });
    fireEvent.click(cards()[0]);
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).toContain("act_as=coach");
  });

  it("a super admin on the staff of a team shows that staff role", () => {
    show([coach("a", "Team A", { staffRole: "Head coach", admin: true }), clubCoach("b", "Team B")], { admin: "super" });
    expect(cards().length).toBe(1);
    expect(pills(cards()[0])).toEqual(["Head coach"]);
  });

  it("on no team themselves: says so and points at club admin", () => {
    show([clubCoach("a", "Team A"), clubCoach("b", "Team B")], { admin: "super" });
    expect(cards()).toEqual([]);
    expect(screen.getByText("You're not on a team yourself")).toBeTruthy();
    expect(screen.getByText("Open any team from club admin.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Club admin/ })).toBeTruthy();
  });

  it("a club admin gets the same page, with the club row worded for what they can do", () => {
    show([clubView("a", "Team A"), parent("a", "Team A", "p1", "Leo"), clubView("b", "Team B")], { admin: "club" });
    expect(cards().map((c) => c.querySelector(".auth-team-name").textContent)).toEqual(["Team A"]);
    expect(pills(cards()[0])).toEqual(["Parent of Leo"]);
    expect(within(screen.getByRole("link", { name: /Club admin/ })).getByText("All 2 teams")).toBeTruthy();
  });

  it("words the club row for one team and for none", () => {
    show([clubCoach("a", "Team A")], { admin: "super" });
    expect(screen.getByText("The club's team and who can do what")).toBeTruthy();
    cleanup();
    show([], { admin: "super" });
    expect(screen.getByText("Create the first team")).toBeTruthy();
  });
});

describe("My teams — viewing as someone else", () => {
  it("shows that person's teams with a way back to club admin, and no club section", () => {
    show([coach("a", "Team A"), parent("b", "Team B", "p1", "Leo")], { email: "mum@example.com (viewing as)", viewingAs: true });
    expect(screen.getByText("Signed in as mum@example.com (viewing as)")).toBeTruthy();
    expect(cards().length).toBe(2);
    expect(screen.queryByText("Club")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to club admin" }).getAttribute("href")).toBe("/admin");
  });
});

describe("My teams — sign out", () => {
  it("clears the team and role cookies and ends the session", () => {
    document.cookie = "team_slug=a; path=/"; document.cookie = "act_as=coach; path=/";
    show([coach("a", "Team A")]);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(document.cookie).not.toContain("team_slug=");
    expect(document.cookie).not.toContain("act_as=");
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
