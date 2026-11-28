import { describe, it, expect } from "vitest";
import { SUGGEST_SCHEMA, buildSuggestPrompt, emptyByBlockOf, mergeFills, rebalanceIssues } from "@/lib/suggest";
import { DEFAULT_RULES } from "@/lib/teamSetup";
import { SQUAD_7, FORMAT_7, setup } from "./helpers/lineupFixtures";

describe("reply schema", () => {
  it("fixed keys everywhere (structured outputs needs additionalProperties false)", () => {
    expect(SUGGEST_SCHEMA.additionalProperties).toBe(false);
    expect(SUGGEST_SCHEMA.properties.fills.items.additionalProperties).toBe(false);
    expect(SUGGEST_SCHEMA.required).toEqual(["fills", "why"]);
  });
});

describe("emptyByBlockOf and mergeFills", () => {
  const { ctx, positions } = setup(SQUAD_7, FORMAT_7);
  const base = [{ GK: "sp" }, {}, {}, {}];

  it("lists each block's empty spots in order", () => {
    const empty = emptyByBlockOf(base, ctx.positionsByBlock);
    expect(empty[0]).toEqual(positions.filter((q) => !q.gk).map((q) => q.key));
    expect(empty[1]).toEqual(positions.map((q) => q.key));
  });

  it("fills empty spots only, skipping unknown, unavailable and doubled players", () => {
    const empty = { 0: ["r0c0", "r0c1", "r1c0"] };
    const out = mergeFills(base, [{ block: 0, players: ["he", "sp", "ghost"] }, { block: 9, players: ["he"] }, "junk"], empty, new Set(["he", "sp"]));
    expect(out[0]).toEqual({ GK: "sp", r0c0: "he" }); // sp is already in goal; ghost isn't in the squad
    expect(out[1]).toEqual({});
    expect(mergeFills(base, "nope", empty, new Set())).toEqual(base);
  });
});

describe("the prompt", () => {
  it("carries the data, opposition policy, shapes and the team's rules in priority order", () => {
    const { ctx } = setup(SQUAD_7, FORMAT_7, { opposition: "hardest" });
    const base = [{ GK: "sp" }, { GK: "sp" }, { GK: "sp" }, { GK: "sp" }];
    const empty = emptyByBlockOf(base, ctx.positionsByBlock);
    const p = buildSuggestPrompt(ctx, base, empty, { shapes: ["2-3-1", "3-2-1"], theirShapes: { 0: "t:3fwd" }, opponent: "Wests", notes: { le: "Quick, loves running at backs" } });
    const data = JSON.parse(p.slice(p.indexOf("DATA:\n") + 6, p.indexOf("\n\nRatings")));
    expect(data.players.map((x) => x.name)).toContain("Spencer");
    expect(data.players.find((x) => x.id === "le").note).toBe("Quick, loves running at backs");
    expect(data.lockedMin.sp).toBe(40);
    expect(data.empty).toEqual(empty);
    expect(p).toMatch(/OPPOSITION THIS WEEK: MUCH STRONGER \(vs Wests\)\. Every player's final total must reach at least 20'/);
    expect(p).toMatch(/1st half: 2-3-1 \(Balanced; .*\) vs their 2-1-3 \(three forwards\)/);
    expect(p).toMatch(/2nd half: 3-2-1/);
    const rules = p.slice(p.indexOf("COACH'S RULES"));
    expect(rules.indexOf("1. Everyone available takes the pitch in every half")).toBeGreaterThan(0);
    expect(rules).toMatch(/6\. Keep a player in the same position/);
    // Last names never go to the model.
    expect(p).not.toMatch(/Spencer Lee/);
  });

  it("only active rules, and custom rules in the coach's words", () => {
    const rules = [{ ...DEFAULT_RULES[0], off: true }, ...DEFAULT_RULES.slice(1, 2), { id: "r_1", text: "Twins never on together", builtin: false }];
    const { ctx } = setup(SQUAD_7, FORMAT_7, { rules });
    const p = buildSuggestPrompt(ctx, ctx.segments.map(() => ({})), emptyByBlockOf(ctx.segments.map(() => ({})), ctx.positionsByBlock));
    expect(p).not.toMatch(/takes the pitch in every half/);
    expect(p).toMatch(/1\. The goalkeeper only changes at a break/);
    expect(p).toMatch(/2\. Twins never on together/);
  });
});

describe("rebalanceIssues", () => {
  it("lists what the plan breaks, leaving out what the coach's own picks cause", () => {
    const { ctx, positions } = setup(SQUAD_7, FORMAT_7);
    const keys = positions.map((q) => q.key);
    const row = ["he", "sp", "se", "ma", "ol", "ja", "le"]; // Henry (GK 0) in goal
    const plan = [row, row, row, row].map((r) => Object.fromEntries(r.map((id, k) => [keys[k], id])));
    const mine = rebalanceIssues(plan, ctx, new Set());
    expect(mine.some((m) => /Henry is rated 0 in goal/.test(m))).toBe(true);
    const locked = new Set(plan.flatMap((s, i) => Object.keys(s).map((k) => i + ":" + k)));
    expect(rebalanceIssues(plan, ctx, locked).some((m) => /rated 0/.test(m))).toBe(false);
  });
});
