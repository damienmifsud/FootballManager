// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import MatchDayPlanner from "@/components/MatchDayPlanner";

// Component tests for the per-fixture planner: roster from RSVPs (out player
// excluded, no-reply flagged with a red dot), GK seeded from the in-goal duty
// and written back through onSavePlan's third arg when block 1's keeper
// changes, tap-to-assign through the sheet, debounced autosave via
// onSavePlan, and the parent read-only Game view.
// U8 team -> 7v7, 2x20', formation 2-3-1.

const LEGEND = "No reply yet — counted in until you mark them out.";

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

let onSavePlan, close;
beforeEach(() => {
  onSavePlan = vi.fn();
  close = vi.fn();
});
afterEach(() => cleanup());

const renderPlanner = (props = {}) =>
  render(<MatchDayPlanner data={makeData()} fixture={makeFixture()} isCoach onSavePlan={onSavePlan} close={close} {...props} />);

// Opens the bottom sheet for a spot and picks a bench player from it. Cy is
// on the bench card and in the sheet; the sheet renders last in the DOM.
const pickFromSheet = async (spotEl, namePattern) => {
  fireEvent.click(spotEl);
  await screen.findByText(/From the bench/i);
  fireEvent.click(screen.getAllByText(namePattern).at(-1));
};

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
    await pickFromSheet(screen.getByText("ST"), /^Cy/); // empty striker spot
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

  it("retires the team-default save: Format tab points at Settings and only clears this plan", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText("Format"));
    expect(await screen.findByText("The format above applies to this game only. The team default lives in Settings.")).toBeTruthy();
    expect(screen.queryByText("Save as team default")).toBeNull();
    expect(screen.getByText("Clear this plan")).toBeTruthy();
  });
});

describe("no-reply red dot", () => {
  it("dots Cy (no reply) but not Sam on the Plan tab, and shows the legend", () => {
    renderPlanner();
    // One roster entry has no RSVP, so exactly one dot on the whole Plan tab.
    const dots = screen.getAllByLabelText("No reply");
    expect(dots).toHaveLength(1);
    // The dot sits inside Cy's bench chip...
    const cyChip = screen.getByText("Cy").parentElement;
    expect(within(cyChip).getByLabelText("No reply")).toBeTruthy();
    // ...and Sam's disc on the pitch has none.
    const samSpot = screen.getByText("Sam").closest("button");
    expect(within(samSpot).queryByLabelText("No reply")).toBeNull();
    // Legend under the block chips.
    expect(screen.getByText(LEGEND)).toBeTruthy();
  });

  it("dots the no-reply row in the Format tab availability list only", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText("Format"));
    await screen.findByText(/Availability — from RSVPs/);
    expect(screen.getAllByLabelText("No reply")).toHaveLength(1);
    const cyRow = screen.getByText("Cy Cole").parentElement;
    expect(within(cyRow).getByLabelText("No reply")).toBeTruthy();
    const samRow = screen.getByText("Sam Smith").parentElement;
    expect(within(samRow).queryByLabelText("No reply")).toBeNull();
    const benRow = screen.getByText("Ben Brown").parentElement;
    expect(within(benRow).queryByLabelText("No reply")).toBeNull();
  });

  it("dots the bench rows in the sheet", async () => {
    renderPlanner();
    fireEvent.click(screen.getByText("ST"));
    await screen.findByText(/From the bench/i);
    const cySheetRow = screen.getAllByText(/^Cy/).at(-1).closest("button");
    expect(within(cySheetRow).getByLabelText("No reply")).toBeTruthy();
  });

  it("shows no dots and no legend once everyone has replied", () => {
    renderPlanner({
      fixture: makeFixture({ availability: { p1: { status: "in" }, p2: { status: "out" }, p3: { status: "in" } } })
    });
    expect(screen.queryAllByLabelText("No reply")).toHaveLength(0);
    expect(screen.queryByText(LEGEND)).toBeNull();
  });
});

describe("GK write-back on save", () => {
  it("passes the new keeper as the third arg when the coach changes block 1's GK through the sheet", async () => {
    renderPlanner();
    // Sam is in goal; tap his spot on the pitch to open the GK sheet.
    await pickFromSheet(screen.getByText("Sam").closest("button"), /^Cy/);
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last).toBeTruthy();
      expect(last[0]).toBe("f1");
      expect(last[1].assignments[0].GK).toBe("p3");
      expect(last[2]).toBe("p3");
    }, { timeout: 2500 });
  });

  it("passes undefined as the third arg when the keeper is unchanged", async () => {
    renderPlanner();
    await pickFromSheet(screen.getByText("ST"), /^Cy/); // outfield change only
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last).toBeTruthy();
      expect(last[1].assignments[0]).toMatchObject({ GK: "p1", r2c0: "p3" });
      expect(last).toHaveLength(3);
      expect(last[2]).toBeUndefined();
    }, { timeout: 2500 });
  });

  it("does not write the keeper back on the first autosave of a fresh plan", async () => {
    renderPlanner();
    await waitFor(() => expect(onSavePlan).toHaveBeenCalled(), { timeout: 2500 });
    const first = onSavePlan.mock.calls[0];
    expect(first[1].assignments[0]).toMatchObject({ GK: "p1" });
    expect(first[2]).toBeUndefined();
  });

  // Opening the planner is not a coach action: whatever the loaded plan says
  // about block 1, the in-goal duty is left exactly as the fixture has it.
  const FORMAT = { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };
  const allIn = { p1: { status: "in" }, p2: { status: "in" }, p3: { status: "in" } };
  const stalePlanFixture = () => makeFixture({
    gk: "p1", availability: allIn,
    plan: { format: FORMAT, subTimes: [10, 30], assignments: [{ GK: "p3" }, { GK: "p3" }, { GK: "p3" }, { GK: "p3" }], overrides: {}, hintSeen: true, updatedAt: 1 }
  });
  const firstSave = async () => {
    await waitFor(() => expect(onSavePlan).toHaveBeenCalled(), { timeout: 2500 });
    return onSavePlan.mock.calls[0];
  };

  it("opening an existing plan whose block-1 keeper differs from the duty does not rewrite the duty", async () => {
    renderPlanner({ fixture: stalePlanFixture() });
    const first = await firstSave();
    expect(first[1].assignments[0]).toMatchObject({ GK: "p3" });
    expect(first[2]).toBeUndefined();
  });

  it("...but the coach then changing block 1's keeper writes the new keeper back", async () => {
    renderPlanner({ fixture: stalePlanFixture() });
    await firstSave();
    // Cy is in goal on the pitch; swap him for Ben through the sheet.
    await pickFromSheet(screen.getByText("Cy").closest("button"), /^Ben/);
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last[1].assignments[0].GK).toBe("p2");
      expect(last[2]).toBe("p2");
    }, { timeout: 2500 });
  });

  it("does not clear the duty when the duty keeper has RSVP'd out (block 1 opens with no keeper)", async () => {
    renderPlanner({ fixture: makeFixture({ availability: { p1: { status: "out" }, p2: { status: "in" }, p3: { status: "in" } } }) });
    const first = await firstSave();
    expect(first[1].assignments[0].GK).toBeUndefined();
    expect(first[2]).toBeUndefined();
  });

  it("does not clear the duty when the duty keeper is a guest outside their window", async () => {
    const data = makeData();
    data.players[0] = { ...data.players[0], guest: true, fromISO: "2026-07-01", untilISO: "2026-08-01" }; // Sam gone by 1 Sep
    renderPlanner({ data, fixture: makeFixture({ availability: allIn }) });
    const first = await firstSave();
    expect(first[1].assignments[0].GK).toBeUndefined();
    expect(first[2]).toBeUndefined();
  });

  it("never writes the duty back under a format with no keeper spot, even after an edit", async () => {
    const noGK = { gameLength: 40, periods: 2, playersOnField: 4, hasGK: false, formation: "2-2", subInterval: 10 };
    renderPlanner({ fixture: makeFixture({
      availability: allIn,
      plan: { format: noGK, subTimes: [10, 30], assignments: [{}, {}, {}, {}], overrides: {}, hintSeen: true, updatedAt: 1 }
    }) });
    const first = await firstSave();
    expect(first[2]).toBeUndefined();
    // Put Cy on the pitch: still a plan-only save.
    await pickFromSheet(screen.getAllByText("LB")[0], /^Cy/);
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(Object.values(last[1].assignments[0])).toContain("p3");
      expect(last).toHaveLength(3);
      expect(last[2]).toBeUndefined();
    }, { timeout: 2500 });
  });

  it("emptying block 1 saves the plan but does not clear the duty", async () => {
    renderPlanner();
    await firstSave();
    fireEvent.click(screen.getByText("Clear block"));
    await waitFor(() => {
      const last = onSavePlan.mock.calls.at(-1);
      expect(last[1].assignments[0]).toEqual({});
      expect(last).toHaveLength(3);
      expect(last[2]).toBeUndefined();
    }, { timeout: 2500 });
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
    render(<MatchDayPlanner data={makeData()} fixture={plannedFixture()} isCoach={false} onSavePlan={onSavePlan} close={close} />);
    expect(screen.getByText("On the pitch now")).toBeTruthy();
    expect(screen.getByText(/coach runs the clock/i)).toBeTruthy();
    // Coach-only surfaces are absent.
    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.queryByText(/Auto-fill/)).toBeNull();
    expect(screen.queryByText("Format")).toBeNull();
    // No-reply dots and legend are coach planning aids; parents never see them.
    expect(screen.queryAllByLabelText("No reply")).toHaveLength(0);
    expect(screen.queryByText(LEGEND)).toBeNull();
    // Parents never write.
    await new Promise((r) => setTimeout(r, 900));
    expect(onSavePlan).not.toHaveBeenCalled();
  });

  it("close button calls close", () => {
    render(<MatchDayPlanner data={makeData()} fixture={plannedFixture()} isCoach={false} onSavePlan={onSavePlan} close={close} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(close).toHaveBeenCalled();
  });
});
