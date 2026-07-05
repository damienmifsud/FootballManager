// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TeamPicker from "@/components/TeamPicker";

// The account-mode team list: parents see their kids' teams; super admins and
// club admins see every team in the system and jump into any of them.
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

afterEach(() => {
  cleanup();
  // clear cookies set by pick()
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
});

describe("TeamPicker", () => {
  it("labels a super admin's club-wide access and counts the teams", () => {
    render(<TeamPicker email="boss@dam.fund" memberships={[
      { teamSlug: "b", teamName: "Team B", role: "coach", admin: true },
      { teamSlug: "a", teamName: "Team A", role: "coach", admin: true }
    ]} />);
    expect(screen.getByText("Club teams")).toBeTruthy();
    expect(screen.getByText(/2 teams/)).toBeTruthy();
    expect(screen.getAllByText("Super admin — full access")).toHaveLength(2);
    // Alphabetical: Team A card before Team B.
    const names = screen.getAllByText(/^Team [AB]$/).map((n) => n.textContent);
    expect(names).toEqual(["Team A", "Team B"]);
  });

  it("labels a club admin view-only and a parent by their child", () => {
    render(<TeamPicker email="td@club.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam", clubAdmin: true }
    ]} />);
    expect(screen.getByText("Club admin — view only")).toBeTruthy();
    expect(screen.getByText("Parent of Sam")).toBeTruthy();
    expect(screen.getByText("Club teams")).toBeTruthy(); // club-wide viewer gets the club heading
  });

  it("keeps the personal heading for a plain coach/parent", () => {
    render(<TeamPicker email="coach@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach" }
    ]} />);
    expect(screen.getByText("Your teams")).toBeTruthy();
    expect(screen.getByText("Coach / manager access")).toBeTruthy();
  });

  it("picking a team sets the team_slug cookie (and binds a parent to their child)", () => {
    render(<TeamPicker email="mum@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }
    ]} />);
    fireEvent.click(screen.getByText("Team A"));
    expect(document.cookie).toContain("team_slug=a");
    expect(document.cookie).toContain("whoami_a=");
  });

  it("picking as an admin sets only the team cookie — no child binding", () => {
    render(<TeamPicker email="boss@dam.fund" memberships={[
      { teamSlug: "b", teamName: "Team B", role: "coach", admin: true }
    ]} />);
    fireEvent.click(screen.getByText("Team B"));
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).not.toContain("whoami_b=");
  });
});
