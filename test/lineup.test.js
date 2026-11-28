import { describe, it, expect } from "vitest";
import {
  fillLineup, planIssues, ruleReceipts, repairPeriodCoverage, buildLineupCtx,
  ruleLabel, ratingOf, sanitizeOpposition, OPPOSITION_CHIPS
} from "@/lib/lineup";
import { makePositions, parseFormation, minutesFor, rosterForFixture, autoFillAssignments, computeSegments } from "@/lib/planner";
import { DEFAULT_RULES } from "@/lib/teamSetup";
import { redactForViewer } from "@/lib/visibility";
import { SQUAD_7, FORMAT_7, SQUAD_9, FORMAT_9, SQUAD_UNRATED, setup, player } from "./helpers/lineupFixtures";

const OPPS = ["weaker", "even", "stronger", "hardest"];
const grpOf = (q) => (q.gk ? "GK" : q.grp);
const keepers = (plan, pos) => plan.map((s) => s[pos.find((q) => q.gk).key]);
const R = (GK, DEF, MID, FWD) => ({ GK, DEF, MID, FWD });

describe("positions carry their line and width", () => {
  it("GK, DEF / MID / FWD rows, one row is all MID, wide ends on rows of 3+", () => {
    const pos = makePositions([2, 3, 1], true);
    expect(pos.map((q) => q.grp)).toEqual(["GK", "DEF", "DEF", "MID", "MID", "MID", "FWD"]);
    expect(pos.filter((q) => q.wide).map((q) => q.label)).toEqual(["LM", "RM"]);
    expect(makePositions([3, 4, 1], true).filter((q) => q.wide).map((q) => q.label)).toEqual(["LB", "RB", "LM", "RM"]);
    expect(makePositions([4], false).every((q) => q.grp === "MID")).toBe(true);
    expect(makePositions([2, 3, 1], true).map((q) => q.key)).toEqual(["GK", "r0c0", "r0c1", "r1c0", "r1c1", "r1c2", "r2c0"]);
  });
});

describe("1. never a 0, never a 0 or unrated keeper", () => {
  for (const [name, squad, format] of [["7v7", SQUAD_7, FORMAT_7], ["9v9", SQUAD_9, FORMAT_9], ["unrated", SQUAD_UNRATED, FORMAT_7]]) {
    for (const opposition of OPPS) {
      it(`${name}, ${opposition}`, () => {
        const { ctx, empty, positions } = setup(squad, format, { opposition });
        const { plan } = fillLineup(empty, ctx);
        const byId = Object.fromEntries(squad.map((p) => [p.id, p]));
        plan.forEach((seg) => positions.forEach((q) => {
          const p = byId[seg[q.key]];
          if (!p) return;
          expect(ratingOf(p, grpOf(q))).not.toBe(0);
          if (q.gk) expect(ratingOf(p, "GK")).toBeGreaterThanOrEqual(1);
        }));
      });
    }
  }

  it("leaves the keeper spot empty, with a note, when nobody is rated in goal", () => {
    const squad = SQUAD_7.map((p) => ({ ...p, ratings: { ...p.ratings, GK: p.id === "sp" ? null : 0 } }));
    const { ctx, empty } = setup(squad, FORMAT_7);
    const res = fillLineup(empty, ctx);
    expect(res.plan.every((s) => !s.GK)).toBe(true);
    expect(res.notes.join(" ")).toMatch(/keeper spot is left for you/);
  });
});

describe("2. the keeper changes only at period breaks", () => {
  it("9v9 in thirds: one keeper per third, and keepers rotate between thirds when evenly matched", () => {
    const { ctx, empty, positions } = setup(SQUAD_9, FORMAT_9);
    const { plan } = fillLineup(empty, ctx);
    const gks = keepers(plan, positions);
    ctx.periodOf.forEach((P, i) => { if (i > 0 && ctx.periodOf[i - 1] === P) expect(gks[i]).toBe(gks[i - 1]); });
    expect(new Set(gks).size).toBeGreaterThan(1);
  });

  it("7v7: Spencer, the only keeper, stays in goal", () => {
    const { ctx, empty, positions } = setup(SQUAD_7, FORMAT_7);
    expect(new Set(keepers(fillLineup(empty, ctx).plan, positions))).toEqual(new Set(["sp"]));
  });
});

describe("3. period coverage", () => {
  it("feasible: every available player appears in every period", () => {
    for (const [squad, format] of [[SQUAD_7, FORMAT_7], [SQUAD_9, FORMAT_9]]) {
      for (const opposition of OPPS) {
        const { ctx, empty } = setup(squad, format, { opposition });
        const { plan } = fillLineup(empty, ctx);
        for (let P = 0; P < format.periods; P++) {
          const seen = new Set();
          plan.forEach((s, i) => { if (ctx.periodOf[i] === P) Object.values(s).forEach((id) => seen.add(id)); });
          squad.forEach((p) => expect(seen.has(p.id)).toBe(true));
        }
      }
    }
  });

  it("infeasible: the receipt is na with a reason, and the fill still runs", () => {
    // 4 halves of one block each, 7 spots, 10 players: nobody can cover every quarter.
    const format = { ...FORMAT_7, periods: 4, subInterval: 30 };
    const { ctx, empty } = setup(SQUAD_7, format);
    const res = fillLineup(empty, ctx);
    const row = res.receipts.find((r) => r.ruleId === "bi-period");
    expect(row.state).toBe("na");
    expect(row.note).toMatch(/Not enough spots: 10 players, 1 block × 7 spots in the 1st quarter/);
    expect(res.plan.every((s) => Object.keys(s).length === 7)).toBe(true);
  });

  it("repairPeriodCoverage puts a missing player on without emptying anyone's period", () => {
    const { ctx, positions } = setup(SQUAD_7, FORMAT_7);
    const keys = positions.map((q) => q.key);
    const ids = ["sp", "he", "ma", "ol", "ja", "le", "se"];
    const others = ["sp", "he", "ma", "ol", "ja", "le", "ru"];
    // First half: Aiden and Nico never appear; Henry and co play both blocks.
    const plan = [ids, others, ["sp", "ai", "ni", "ol", "ja", "le", "ru"], ["sp", "ai", "ni", "se", "he", "ma", "ru"]]
      .map((row) => Object.fromEntries(row.map((id, k) => [keys[k], id])));
    const { plan: out, notes } = repairPeriodCoverage(plan, ctx, new Set());
    const firstHalf = new Set([...Object.values(out[0]), ...Object.values(out[1])]);
    expect(firstHalf.has("ai")).toBe(true);
    expect(firstHalf.has("ni")).toBe(true);
    SQUAD_7.forEach((p) => expect(firstHalf.has(p.id)).toBe(true));
    expect(out[0].GK).toBe("sp");
    expect(notes[0]).toMatch(/^Aiden in for \w+ at \w+ \(block \d\) so everyone plays the 1st half$/);
  });
});

describe("4. weak players go wide when the split allows it", () => {
  it("no 1-2 rated player sits central when there's a wide spot for them", () => {
    // 2-3-1: wide spots are LM and RM. Two weak midfielders, everyone else strong.
    const squad = [
      player("k", "Kip", R(4, 3, 3, 3)),
      player("a", "Ada", R(0, 4, 4, 4)), player("b", "Bo", R(0, 4, 4, 4)), player("c", "Cy", R(0, 4, 4, 4)),
      player("d", "Di", R(0, 4, 4, 4)),
      player("w1", "Wes", R(0, 3, 2, 3)), player("w2", "Wil", R(0, 3, 1, 3))
    ];
    for (const opposition of OPPS) {
      const { ctx, empty, positions } = setup(squad, FORMAT_7, { opposition });
      const { plan, receipts } = fillLineup(empty, ctx);
      plan.forEach((seg) => positions.forEach((q) => {
        if (q.gk || q.wide) return;
        const p = squad.find((x) => x.id === seg[q.key]);
        const r = ratingOf(p, q.grp);
        expect(r === 1 || r === 2).toBe(false);
      }));
      expect(receipts.find((r) => r.ruleId === "bi-weak-wide").state).toBe("ok");
    }
  });
});

describe("5. sticky positions", () => {
  it("a player back from the bench gets their last position when it's free", () => {
    // Everyone rated the same, so only stickiness separates the spots.
    const squad = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => player(id, id.toUpperCase() + "x", R(id === "a" ? 4 : 0, 3, 3, 3)));
    const { ctx, empty, positions } = setup(squad, FORMAT_7);
    const { plan } = fillLineup(empty, ctx);
    const outfield = positions.filter((q) => !q.gk);
    let checked = 0;
    for (const p of squad) {
      let last = null, benched = false;
      plan.forEach((seg) => {
        const key = outfield.find((q) => seg[q.key] === p.id)?.key || null;
        if (!key) { if (last) benched = true; return; }
        if (benched && last) { expect(key).toBe(last); checked++; }
        last = key; benched = false;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("6. opposition trades minutes for strength", () => {
  const top = ["b0", "b5"]; // the GK-rated pair: Ava (4) and Finn (3)
  it("hardest gives the top-rated more minutes than weaker, and nobody goes under the floor", () => {
    const totals = {};
    for (const opposition of OPPS) {
      const { ctx, empty, segments } = setup(SQUAD_9, FORMAT_9, { opposition });
      const res = fillLineup(empty, ctx);
      totals[opposition] = minutesFor(res.plan, segments, SQUAD_9);
      if (opposition === "stronger" || opposition === "hardest") {
        const floor = Math.min(60 / 2, (60 * 9) / 13);
        SQUAD_9.forEach((p) => expect(totals[opposition][p.id]).toBeGreaterThanOrEqual(floor - 2.5));
        expect(res.receipts[0]).toMatchObject({ ruleId: "floor", state: "ok", label: "Everyone reaches 30'" });
      }
    }
    expect(totals.hardest.b0).toBeGreaterThan(totals.weaker.b0);
    const spread = (m) => Math.max(...Object.values(m)) - Math.min(...Object.values(m));
    expect(spread(totals.hardest)).toBeGreaterThan(spread(totals.weaker));
    void top;
  });

  it("one FWD 5 among 1s lands at ST in most blocks under Much stronger, and plays fair minutes under Weaker", () => {
    const squad = SQUAD_9.map((p) => ({ ...p, ratings: p.id === "b3" ? R(0, 1, 1, 5) : R(p.ratings.GK, 1, 1, 1) }));
    const at = (opposition) => {
      const { ctx, empty, positions, segments } = setup(squad, FORMAT_9, { opposition });
      const { plan } = fillLineup(empty, ctx);
      const st = positions.find((q) => q.label === "ST").key;
      return { st: plan.filter((s) => s[st] === "b3").length, mins: minutesFor(plan, segments, squad).b3 };
    };
    const hard = at("hardest"), weak = at("weaker");
    expect(hard.st).toBeGreaterThan(12 / 2);
    expect(hard.mins).toBeGreaterThan(weak.mins);
    expect(weak.mins).toBeLessThanOrEqual(45);
  });
});

describe("7. coach-placed slots are never changed", () => {
  it("locked picks survive the fill and the repair", () => {
    const { ctx, segments, positions } = setup(SQUAD_9, FORMAT_9);
    const base = segments.map(() => ({}));
    base[0] = { GK: "b5", r0c1: "b1" };
    base[3] = { r2c0: "b12", r1c0: "b2" };
    base[7] = { r1c3: "b4" };
    const { plan } = fillLineup(base, ctx);
    base.forEach((seg, i) => Object.entries(seg).forEach(([k, id]) => expect(plan[i][k]).toBe(id)));
    expect(plan.every((s) => Object.keys(s).length === positions.length)).toBe(true);
  });
});

describe("8. receipts agree with planIssues", () => {
  it("every rule with an issue is a warn, and a warn has an issue", () => {
    const { ctx, segments, positions } = setup(SQUAD_7, FORMAT_7);
    // A messy hand-made plan: keeper swaps mid-half, a 0 at ST, Rubi on the bench twice.
    const keys = positions.map((q) => q.key);
    const plan = [
      ["sp", "he", "se", "ma", "ol", "ja", "ai"],
      ["ja", "he", "se", "ma", "ol", "le", "ai"],
      ["sp", "he", "se", "ma", "ol", "le", "ai"],
      ["sp", "he", "se", "ma", "ol", "le", "ai"]
    ].map((row) => Object.fromEntries(row.map((id, k) => [keys[k], id])));
    const issues = planIssues(plan, ctx);
    const receipts = ruleReceipts(plan, ctx);
    for (const r of receipts) {
      const has = issues.some((x) => x.ruleId === r.ruleId);
      if (has) expect(r.state).toBe("warn");
      if (r.state === "warn") expect(has).toBe(true);
    }
    const tags = new Set(issues.map((x) => x.tag));
    for (const t of ["gk", "zero", "period", "bench"]) expect(tags.has(t)).toBe(true);
    void segments;
  });

  it("a GK-0 duty keeper is respected and the receipt says it comes from the locked picks", () => {
    const { ctx, segments } = setup(SQUAD_7, FORMAT_7);
    const base = segments.map(() => ({ GK: "he" })); // Henry is GK 0
    const res = fillLineup(base, ctx);
    expect(res.plan.every((s) => s.GK === "he")).toBe(true);
    const row = res.receipts.find((r) => r.ruleId === "bi-rating-zero");
    expect(row.state).toBe("warn");
    expect(row.note).toMatch(/Henry is rated 0 in goal/);
    expect(row.note).toMatch(/comes from your locked picks/);
  });

  it("the 9v9 fill shows six rule rows and no warnings", () => {
    const { ctx, empty } = setup(SQUAD_9, FORMAT_9);
    const res = fillLineup(empty, ctx);
    expect(res.receipts).toHaveLength(6);
    expect(res.receipts.filter((r) => r.state === "warn")).toEqual([]);
    expect(res.receipts.at(-1)).toMatchObject({ ruleId: "bi-sticky-positions", state: "asked" });
  });

  it("switched-off rules get no row; custom rules are asked", () => {
    const rules = [...DEFAULT_RULES.map((r) => (r.id === "bi-weak-wide" ? { ...r, off: true } : r)), { id: "r_1", text: "Twins never on together", builtin: false }];
    const { ctx, empty } = setup(SQUAD_7, FORMAT_7, { rules });
    const ids = fillLineup(empty, ctx).receipts.map((r) => [r.ruleId, r.state]);
    expect(ids.map((x) => x[0])).not.toContain("bi-weak-wide");
    expect(ids.at(-1)).toEqual(["r_1", "asked"]);
  });
});

describe("9. rule 1 follows the format", () => {
  it("halves, thirds, quarters and a single period", () => {
    const r = { id: "bi-period", text: "Everyone available plays in both halves" };
    expect(ruleLabel(r, { periods: 2 })).toBe("Everyone available plays in every half");
    expect(ruleLabel(r, { periods: 3 })).toBe("Everyone available plays in every third");
    expect(ruleLabel(r, { periods: 4 })).toBe("Everyone available plays in every quarter");
    expect(ruleLabel(r, { periods: 1 })).toBe("Everyone available gets on the pitch");
    expect(ruleLabel({ id: "r_1", text: "Mine" }, { periods: 3 })).toBe("Mine");
  });
});

describe("11. performance", () => {
  it("the 9v9 fill runs in under 50 ms", () => {
    const { ctx, empty } = setup(SQUAD_9, FORMAT_9, { opposition: "hardest" });
    fillLineup(empty, ctx); // warm up
    const t = performance.now();
    fillLineup(empty, ctx);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("12. a parent session's roster is unrated and the fill still runs", () => {
  it("redactForViewer strips ratings; rosterForFixture reports null", () => {
    const data = {
      team: { name: "T", matchFormat: FORMAT_7 },
      players: SQUAD_7.map((p, i) => ({ id: p.id, name: p.name, number: i + 1, coach: { ratings: p.ratings, note: "" } })),
      fixtures: [{ id: "f1", dateISO: "2026-12-05", availability: {} }]
    };
    const coachRoster = rosterForFixture(data, data.fixtures[0]);
    expect(coachRoster.find((p) => p.id === "sp").ratings).toEqual(SQUAD_7[0].ratings);
    const seen = redactForViewer(data, { role: "parent", playerIds: ["sp"], todayISO: "2026-11-28" });
    const roster = rosterForFixture(seen, seen.fixtures[0]);
    expect(roster.every((p) => p.ratings === null)).toBe(true);
    const positions = makePositions(parseFormation(FORMAT_7.formation), true);
    const segments = computeSegments(40, 2, [10, 30]);
    const ctx = buildLineupCtx({ segments, positions, roster, rules: DEFAULT_RULES, format: FORMAT_7 });
    const res = fillLineup(segments.map(() => ({})), ctx);
    expect(res.plan.every((s) => Object.keys(s).length === 6)).toBe(true); // keeper left for the coach
    expect(res.receipts.find((r) => r.ruleId === "bi-rating-zero").state).toBe("na");
  });
});

describe("unrated players count as average", () => {
  it("four unrated players still play fair minutes and are never treated as 0", () => {
    const { ctx, empty, segments } = setup(SQUAD_UNRATED, FORMAT_7);
    const { plan } = fillLineup(empty, ctx);
    const m = minutesFor(plan, segments, SQUAD_UNRATED);
    SQUAD_UNRATED.filter((p) => !p.ratings).forEach((p) => expect(m[p.id]).toBeGreaterThanOrEqual(20));
  });
});

describe("wrapper and helpers", () => {
  it("autoFillAssignments still fills everything by fair minutes with no rules", () => {
    const positions = makePositions([1], true);
    const segments = computeSegments(20, 1, [10]);
    const roster = [player("p1", "A", null), player("p2", "B", null), player("p3", "C", null)];
    const filled = autoFillAssignments([{}, {}], segments, positions, roster);
    expect(filled.every((s) => s.GK && s.r0c0)).toBe(true);
  });

  it("opposition is one of four, defaulting to even", () => {
    expect(OPPOSITION_CHIPS.map((c) => c.label)).toEqual(["Weaker", "About even", "Stronger", "Much stronger"]);
    expect(sanitizeOpposition("hardest")).toBe("hardest");
    expect(sanitizeOpposition("brutal")).toBe("even");
    expect(sanitizeOpposition(undefined)).toBe("even");
  });
});

describe("a shape per period", () => {
  it("fills each block with its own period's spots, and the checks read those spots", () => {
    const { segments, ctx: base } = setup(SQUAD_7, FORMAT_7);
    const first = makePositions([2, 3, 1], true), second = makePositions([3, 2, 1], true);
    const byBlock = base.periodOf.map((P) => (P === 0 ? first : second));
    const ctx = buildLineupCtx({ segments, positions: first, positionsByBlock: byBlock, roster: SQUAD_7, rules: DEFAULT_RULES, format: FORMAT_7 });
    const res = fillLineup(segments.map(() => ({})), ctx);
    res.plan.forEach((seg, i) => expect(Object.keys(seg).sort()).toEqual(byBlock[i].map((q) => q.key).sort()));
    // Second half: three backs, so r0c2 is a DEF spot nobody rated 0 at the back plays.
    res.plan.slice(2).forEach((seg) => expect(ratingOf(SQUAD_7.find((p) => p.id === seg.r0c2), "DEF")).not.toBe(0));
    expect(res.receipts.filter((r) => r.state === "warn")).toEqual([]);
  });
});
