// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TeamPicker from "@/components/TeamPicker";

// The account-mode picker: one card per distinct team, the hats held there as
// rows. Picking writes the team_slug AND act_as cookies (validated
// server-side) and drops any legacy per-device whoami_<slug> identity.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut }));

const clearCookies = () => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
};

afterEach(() => {
  cleanup();
  clearCookies();
  vi.clearAllMocks();
});


describe("TeamPicker", () => {
  it("groups a parent of two kids on one team into ONE card with one hat", () => {
    render(<TeamPicker email="mum@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam Smith" },
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p2", playerName: "Alex Smith" }
    ]} />);
    expect(screen.getAllByText("Team A")).toHaveLength(1);
    expect(screen.getByText("Parent of Sam & Alex")).toBeTruthy();
    expect(screen.getByText("Your teams")).toBeTruthy();
    // Single hat: the whole card is the one button.
    const buttons = screen.getAllByRole("button").filter((b) => b.textContent !== "Sign out");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Team A");
  });

  it("a multi-hat team shows one row per hat under 'Choose how to view'", () => {
    render(<TeamPicker email="coach@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach", staffRole: "Assistant coach" },
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }
    ]} />);
    expect(screen.getByText("Choose how to view Team A")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assistant coach" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Parent of Sam" })).toBeTruthy();
    // No "Continue as ..." copy.
    expect(screen.queryByText(/Continue as/)).toBeNull();
  });

  it("picking a hat sets team_slug AND act_as and clears the legacy whoami cookie", () => {
    document.cookie = "whoami_a=stale; path=/";
    expect(document.cookie).toContain("whoami_a=stale");
    render(<TeamPicker email="coach@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "a", teamName: "Team A", role: "parent", playerId: "p1", playerName: "Sam" }
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Parent of Sam" }));
    expect(document.cookie).toContain("team_slug=a");
    expect(document.cookie).toContain("act_as=parent");
    expect(document.cookie).not.toContain("whoami_a=");
  });

  it("a single-hat card click sets act_as to that hat's role", () => {
    render(<TeamPicker email="boss@dam.fund" memberships={[
      { teamSlug: "b", teamName: "Team B", role: "coach", admin: true }
    ]} />);
    fireEvent.click(screen.getByText("Team B"));
    expect(document.cookie).toContain("team_slug=b");
    expect(document.cookie).toContain("act_as=coach");
    expect(document.cookie).not.toContain("whoami_b=");
  });

  it("sorts cards by team name and labels hats via hatLabel", () => {
    render(<TeamPicker email="td@club.com" memberships={[
      { teamSlug: "b", teamName: "Team B", role: "viewer", clubAdmin: true },
      { teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true }
    ]} />);
    const names = screen.getAllByText(/^Team [AB]$/).map((n) => n.textContent);
    expect(names).toEqual(["Team A", "Team B"]);
    expect(screen.getAllByText("Club admin (view only)")).toHaveLength(2);
  });

  it("preselect puts that team first under its own heading, the rest under 'Other teams'", () => {
    render(<TeamPicker email="coach@b.com" preselect="b" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "coach" },
      { teamSlug: "b", teamName: "Team B", role: "parent", playerId: "p1", playerName: "Sam" }
    ]} />);
    const heading = screen.getByText("Choose how to view Team B");
    const other = screen.getByText("Other teams");
    // Heading for the preselected team comes before "Other teams", and the
    // preselected card's hat rows sit between the two.
    expect(heading.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const coachRow = screen.getByRole("button", { name: "Coach" });
    expect(heading.compareDocumentPosition(coachRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(coachRow.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Team A (single hat) appears after "Other teams".
    const teamA = screen.getByText("Team A");
    expect(other.compareDocumentPosition(teamA) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses the club heading and team count for super admins and club admins", () => {
    render(<TeamPicker email="boss@dam.fund" memberships={[
      { teamSlug: "b", teamName: "Team B", role: "coach", admin: true },
      { teamSlug: "a", teamName: "Team A", role: "coach", admin: true }
    ]} />);
    expect(screen.getByText("Club teams")).toBeTruthy();
    expect(screen.getByText(/Signed in as boss@dam.fund · 2 teams/)).toBeTruthy();
    expect(screen.getAllByText("Super admin")).toHaveLength(2);
    cleanup();
    render(<TeamPicker email="td@club.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "viewer", clubAdmin: true }
    ]} />);
    expect(screen.getByText("Club teams")).toBeTruthy();
    expect(screen.getByText(/1 team$/)).toBeTruthy();
  });

  it("keeps the personal heading for a plain coach", () => {
    render(<TeamPicker email="coach@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach" }
    ]} />);
    expect(screen.getByText("Your teams")).toBeTruthy();
    expect(screen.getByText("Signed in as coach@a.com")).toBeTruthy();
    expect(screen.getByText("Coach")).toBeTruthy();
  });

  it("sign out clears team_slug and act_as before ending the session", () => {
    document.cookie = "team_slug=a; path=/";
    document.cookie = "act_as=coach; path=/";
    render(<TeamPicker email="coach@a.com" memberships={[
      { teamSlug: "a", teamName: "Team A", role: "coach" }
    ]} />);
    fireEvent.click(screen.getByText("Sign out"));
    expect(document.cookie).not.toContain("team_slug=");
    expect(document.cookie).not.toContain("act_as=");
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });
});
