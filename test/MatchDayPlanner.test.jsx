// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import MatchDayPlanner from "@/components/MatchDayPlanner";

// Component tests for the per-fixture planner: roster from RSVPs (out player
// excluded, no-reply flagged), GK seeded from the in-goal duty, tap-to-assign
// through the sheet, debounced autosave via onSavePlan, and the parent
// read-only Game view. U8 team -> 7v7, 2x20', formation 2-3-1.

function makeData() {
  return {
    team: { name: "Test FC", ageGroup: "U8" },
    players: [
      { id: "p1", name: "Sam Smith", number: 1 },
      { id: "p2", name: "Ben Brown", number: 2 },
      { id: "p3", name: "Cy Cole", number: 3 }
    ],
    fixtures: []
  };
}
function makeFixture(over = {}) {
  return {
    id: "f1", round: 5, dateISO: "2026-09-01", time: "09:00",
    opponent: "Wests", homeAway: "H", venue: "Perry Park", status: "upcoming",
    gk: "p1",
    availability: { p1: { status: "in" }, p2: { status: "out", reason: "Sick" } }, // p3 = no reply
    ...over
  };
}

let onSavePlan, onSaveTeamFormat, close;
beforeEach(() => {
  onSavePlan = vi.fn();
  onSaveTeamFormat = vi.fn();
  close = vi.fn();
});
afterEach(() => cleanup());

const renderPlanner = (props = {}) =>
  render(<MatchDayPlanner data={makeData()} fixture={makeFixture()} isCoach onSavePlan={onSavePlan} onSaveTeamFormat={onSaveTeamFormat} close={close} {...props} />);

describe("coach view", () => {
  it("opens on the Plan tab with the duty keeper pre-pinned", () => {
    renderPlanner();
    expect(screen.getByText("KICK-OFF LINEUP")).toBeTruthy();
    // GK seeded from fixture.gk = Sam; his first name sits on the pitch.
    expect(screen.getByText("Sam")).toBeTruthy();
    // Only 2 of 3 are IN (Ben is out) for a 7-a-side format.
    expect(screen.getByText(/Only 2 marked IN/)).toBeTruthy();
  });

  it("builds the bench from RSVPs: out player excluded, no-reply flagged", () => {
    renderPlanner();
    // Bench card: Cy (no reply -> available + flagged); Ben (out) not benched.
    expect(screen.getByText("Cy")).toBeTruthy();
    expect(screen.getByText("no reply")).toBeTruthy();
    expect(screen.queryByText("Ben")).toBeNull();
  });

  it("assigns a bench player to a tapped spot and autosaves the plan", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText("ST")); // empty striker spot
    await screen.findByText(/From the bench/i);
    // Cy appears in the bench card and in the sheet; the sheet renders last.
    const cySheet = screen.getAllByText(/^Cy/).at(-1);
    fireEvent.click(cySheet);
    // The debounced autosave lands with Cy in the ST spot of block 1.
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last).toBeTruthy();
      expect(last[0]).toBe("f1");
      expect(last[1].assignments[0]).toMatchObject({ GK: "p1", r2c0: "p3" });
    }, { timeout: 2500 });
  });

  it("auto-fill fills the empty spots with available players only", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText(/Auto-fill for fair minutes/));
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last).toBeTruthy();
      const used = new Set(last[1].assignments.flatMap((s) => Object.values(s)));
      expect(used.has("p2")).toBe(false); // Ben is out
      expect(used.has("p1")).toBe(true);
      expect(used.has("p3")).toBe(true);
    }, { timeout: 2500 });
  });

  it("saves the current format as the team default from the Format tab", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText("Format"));
    fireEvent.click(await screen.findByText("Save as team default"));
    expect(onSaveTeamFormat).toHaveBeenCalledWith(expect.objectContaining({ playersOnField: 7, hasGK: true }));
  });
});

describe("parent view", () => {
  const plannedFixture = () => makeFixture({
    plan: {
      format: { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 },
      subTimes: [10, 30],
      assignments: [{ GK: "p1" }, { GK: "p1" }, { GK: "p1" }, { GK: "p1" }],
      overrides: {}, hintSeen: true, updatedAt: 1
    }
  });

  it("shows only the read-only Game view — no tabs, no clock controls, no saving", async () => {
    render(<MatchDayPlanner data={makeData()} fixture={plannedFixture()} isCoach={false} onSavePlan={onSavePlan} onSaveTeamFormat={onSaveTeamFormat} close={close} />);
    expect(screen.getByText("On the pitch now")).toBeTruthy();
    expect(screen.getByText(/coach runs the clock/i)).toBeTruthy();
    // Coach-only surfaces are absent.
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByText(/Auto-fill/)).toBeNull();
    expect(screen.queryByText("Format")).toBeNull();
    // Parents never write.
    await new Promise((r) => setTimeout(r, 900));
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("close button calls close", () => {
    render(<MatchDayPlanner data={makeData()} fixture={plannedFixture()} isCoach={false} onSavePlan={onSavePlan} onSaveTeamFormat={onSaveTeamFormat} close={close} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(close).toHaveBeenCalled();
  });
});
