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
    fireEvent.click(screen.getByText("Auto-fill"));
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

describe("two-team squads and missing numbers", () => {
  const sub = () => document.querySelector(".mdp .truncate.text-xs").textContent;
  it("the header sub-line names the side on a paired round, and not otherwise", () => {
    const f = makeFixture({ round: 7, side: "McKay", opponent: "Oxley United" });
    const twin = makeFixture({ id: "f2", round: 7, side: "McKain", opponent: "Oxley United" });
    const { unmount } = render(<MatchDayPlanner data={{ ...makeData(), fixtures: [f, twin] }} fixture={f} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Round 7 vs Oxley United · McKay · /);
    unmount();
    render(<MatchDayPlanner data={{ ...makeData(), fixtures: [f] }} fixture={f} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Round 7 vs Oxley United · (?!McKay)/);
  });
  it("the header sub-line names the competition too, and pairs only within it", () => {
    const WINTER = { comp: "cwinter", compName: "Winterfest" };
    const f = makeFixture({ round: 2, side: "McKay", opponent: "Lions", ...WINTER });
    const twin = makeFixture({ id: "f2", round: 2, side: "McKain", opponent: "Lions", ...WINTER });
    let view = render(<MatchDayPlanner data={{ ...makeData(), fixtures: [f, twin] }} fixture={f} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Winterfest · Round 2 vs Lions · McKay · /);
    view.unmount();
    // The season's round 2 on the other side is not this game's pair: no side shown.
    const season = makeFixture({ id: "s2", round: 2, side: "McKain", opponent: "Wests" });
    view = render(<MatchDayPlanner data={{ ...makeData(), fixtures: [f, season] }} fixture={f} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Winterfest · Round 2 vs Lions · (?!McKay)/);
    view.unmount();
    // A game with no round is still named: by its competition, or as a match.
    view = render(<MatchDayPlanner data={makeData()} fixture={makeFixture({ round: null, opponent: "Lions", ...WINTER })} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Winterfest vs Lions · /);
    view.unmount();
    render(<MatchDayPlanner data={makeData()} fixture={makeFixture({ round: null, opponent: "Lions" })} isCoach onSavePlan={onSavePlan} close={close} />);
    expect(sub()).toMatch(/^Match vs Lions · /);
  });

  it("a player stored with number 0 shows initials on the disc, never 0", () => {
    const data = { ...makeData(), players: makeData().players.map((p) => ({ ...p, number: 0 })) };
    render(<MatchDayPlanner data={data} fixture={makeFixture()} isCoach onSavePlan={onSavePlan} close={close} />);
    const discs = [...document.querySelectorAll(".mdp *")].filter((el) => el.children.length === 0).map((el) => el.textContent.trim());
    expect(discs).toContain("SS");
    expect(discs).not.toContain("0");
  });
});

describe("the shirts on the pitch", () => {
  // Every element painted in the kit's colour (jsdom reports it as rgb()).
  const painted = (rgb) => [...document.querySelectorAll("[style]")].filter((el) => el.style.background === rgb || el.style.backgroundColor === rgb).length;
  const BLUE = "rgb(40, 87, 196)", RED = "rgb(200, 16, 46)";

  it("are the team's kit, the game's own when it was switched, and red when neither says", () => {
    const withTeamKit = (strip) => ({ ...makeData(), team: { ...makeData().team, strip } });
    renderPlanner({ data: withTeamKit("Blue") });
    expect(painted(BLUE)).toBeGreaterThan(0);
    expect(painted(RED)).toBe(0);
    cleanup();
    renderPlanner({ data: withTeamKit("Blue"), fixture: makeFixture({ strip: "Red" }) });
    expect(painted(RED)).toBeGreaterThan(0);
    expect(painted(BLUE)).toBe(0);
    cleanup();
    renderPlanner();
    expect(painted(RED)).toBeGreaterThan(0);
    expect(painted(BLUE)).toBe(0);
  });
});

// Slice 3 step 1: opposition chips, the ratings-aware auto-fill, the "Why this
// lineup" receipts and the unrated nudge.
describe("ratings-aware auto-fill", () => {
  const rated = () => {
    const d = makeData();
    d.team.rules = [{ id: "bi-period", text: "Everyone available plays in both halves", builtin: true }];
    d.players = d.players.map((p) => p.id === "p1" ? { ...p, coach: { ratings: { GK: 4, DEF: 2, MID: 2, FWD: 2 } } } : p);
    return d;
  };

  it("saves the chosen opposition with the plan and shows its blurb", async () => {
    renderPlanner();
    expect(screen.getByText(/Balanced: fair minutes/)).toBeTruthy(); // About even by default
    fireEvent.click(screen.getByText("Much stronger"));
    expect(screen.getByText(/Strongest shape all game/)).toBeTruthy();
    await waitFor(() => expect(onSavePlan.mock.calls.at(-1)?.[1].opposition).toBe("hardest"), { timeout: 2500 });
  });

  it("opens with the fixture's saved opposition", () => {
    renderPlanner({ fixture: makeFixture({ plan: { opposition: "weaker", subTimes: [10, 30], assignments: [{}, {}, {}, {}], hintSeen: true } }) });
    expect(screen.getByText(/Mix it up/)).toBeTruthy();
  });

  it("shows the Why this lineup card after auto-fill, with a row for every active rule", async () => {
    renderPlanner({ data: rated() });
    expect(screen.queryByText("Why this lineup")).toBeNull();
    fireEvent.click(screen.getByText("Auto-fill"));
    expect(await screen.findByText("Why this lineup")).toBeTruthy();
    // The stored list held only rule 1; the other five are appended, on.
    for (const label of ["Everyone available plays in every half", "Keeper changes only at the break",
      "Nobody plays a spot they're rated 0 in", "Players come back on in the position they left"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Uses ratings and your lineup rules")).toBeTruthy();
  });

  it("nudges about unrated players and opens the first one", () => {
    const onOpenPlayer = vi.fn();
    renderPlanner({ data: rated(), onOpenPlayer });
    expect(screen.getByText(/1 player has no ratings yet, so auto-fill treats them as average/)).toBeTruthy();
    fireEvent.click(screen.getByText("Rate them in Squad."));
    expect(onOpenPlayer).toHaveBeenCalledWith("p3");
  });
});

// Slice 3 step 2: a shape per period, what they play, and the counter card.
describe("shape card", () => {
  it("records their shape, shows the counters with zones and the call, and Use changes this half's shape", async () => {
    renderPlanner();
    // Collapsed: our home shape for the 1st half, their shape not set.
    expect(screen.getByText(/1st half · their shape not set/)).toBeTruthy();
    fireEvent.click(screen.getByText(/1st half · their shape not set/));
    expect(screen.getByText("Your shape, 1st half")).toBeTruthy();
    // They play 2-3-1 (U8: 7v7, our home is 2-3-1). Their chips come after ours.
    fireEvent.click(screen.getAllByText("2-3-1").at(-1));
    expect(screen.getByText("Counter to their 2-3-1")).toBeTruthy();
    // About even lists defend first: 3-2-1, with GameDay's call for it.
    expect(screen.getByText("DEFEND")).toBeTruthy();
    expect(screen.getByText("Drop in: centre mid between the backs")).toBeTruthy();
    expect(screen.getByText(/Back 3v1/)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Use")[0]);
    expect(screen.getByText("changed")).toBeTruthy();
    // The pitch now has three backs: LB, CB, RB.
    expect(screen.getByText("CB")).toBeTruthy();
    await waitFor(() => {
      const plan = onSavePlan.mock.calls.at(-1)?.[1];
      expect(plan?.shapes).toEqual({ 0: "3-2-1" });
      expect(plan?.theirShapes).toEqual({ 0: "2-3-1" });
    }, { timeout: 2500 });
  });

  it("carries their shape into the next half and opens with saved shapes", () => {
    renderPlanner({ fixture: makeFixture({ plan: { subTimes: [10, 30], assignments: [{}, {}, {}, {}], hintSeen: true, shapes: { 1: "2-2-2" }, theirShapes: { 0: "t:3fwd" } } }) });
    expect(screen.getByText(/they play three forwards/)).toBeTruthy();
    // Block 3 is the 2nd half: our 2-2-2, their shape carried over.
    fireEvent.click(screen.getByText("20–30'").closest("button"));
    expect(screen.getByText(/they played three forwards in the 1st half/)).toBeTruthy();
    expect(screen.getAllByText("2-2-2").length).toBeGreaterThan(0);
  });
});

// A competition played in a format of its own (the club's set-up, sent with
// the team's document as data.competitionFormats): its games start from it.
describe("a game in a competition with a format of its own", () => {
  const allIn = { p1: { status: "in" }, p2: { status: "in" }, p3: { status: "in" } };
  const FIVES = { playersOnField: 5, hasGK: true, periods: 2, gameLength: 30 };
  const withFives = () => ({ ...makeData(), competitionFormats: { cfives: FIVES } });

  it("starts the plan from the competition's format, not the team's", async () => {
    renderPlanner({ data: withFives(), fixture: makeFixture({ comp: "cfives", compName: "Summer Fives", availability: allIn }) });
    await waitFor(() => expect(onSavePlan).toHaveBeenCalled(), { timeout: 2500 });
    expect(onSavePlan.mock.calls[0][1].format).toMatchObject(FIVES);
  });

  it("a season game beside it keeps the team's", async () => {
    renderPlanner({ data: withFives(), fixture: makeFixture({ availability: allIn }) });
    await waitFor(() => expect(onSavePlan).toHaveBeenCalled(), { timeout: 2500 });
    expect(onSavePlan.mock.calls[0][1].format).toMatchObject({ playersOnField: 7, gameLength: 40 });
  });

  it("clearing the plan goes back to the competition's format", async () => {
    const seven = { gameLength: 40, periods: 2, playersOnField: 7, hasGK: true, formation: "2-3-1", subInterval: 10 };
    renderPlanner({ data: withFives(), fixture: makeFixture({ comp: "cfives", compName: "Summer Fives", availability: allIn,
      plan: { format: seven, subTimes: [10, 30], assignments: [{}, {}, {}, {}], overrides: {}, hintSeen: true, updatedAt: 1 } }) });
    fireEvent.click(screen.getByText("Format"));
    fireEvent.click(await screen.findByText("Clear this plan"));
    fireEvent.click(await screen.findByText("Really clear? Tap again"));
    await waitFor(() => expect(onSavePlan.mock.calls.at(-1)?.[1].format).toMatchObject(FIVES), { timeout: 2500 });
  });
});

// Suggest (the AI fill): only for coaches given it; the result fills the plan
// and the Why this lineup card shows the assistant's note.
describe("Suggest", () => {
  it("is hidden unless the coach can use it", () => {
    renderPlanner();
    expect(screen.queryByText("Suggest")).toBeNull();
  });

  it("sends the current plan, applies the reply and shows the why", async () => {
    const onSuggest = vi.fn().mockResolvedValue({
      assignments: [{ GK: "p1", r2c0: "p3" }, { GK: "p1" }, { GK: "p1" }, { GK: "p1" }],
      why: "Cy up front all first block.", notes: [], locked: ["0:GK", "1:GK", "2:GK", "3:GK"]
    });
    renderPlanner({ canSuggest: true, onSuggest });
    fireEvent.click(screen.getByText("Suggest"));
    await screen.findByText("Cy up front all first block.");
    const [fixtureId, payload] = onSuggest.mock.calls[0];
    expect(fixtureId).toBe("f1");
    expect(payload.assignments[0]).toEqual({ GK: "p1" });
    expect(payload).toMatchObject({ opposition: "even", shapes: {}, theirShapes: {} });
    expect(screen.getByText("Why this lineup")).toBeTruthy();
    await waitFor(() => expect(onSavePlan.mock.calls.at(-1)?.[1].assignments[0]).toEqual({ GK: "p1", r2c0: "p3" }), { timeout: 2500 });
  });

  it("shows the server's error and keeps the plan", async () => {
    const onSuggest = vi.fn().mockRejectedValue(new Error("Suggest isn't switched on for you on this team. Ask your club admin."));
    renderPlanner({ canSuggest: true, onSuggest });
    fireEvent.click(screen.getByText("Suggest"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Ask your club admin/);
  });
});
