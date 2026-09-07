import { describe, it, expect } from "vitest";
import { preserveNarrowFields } from "@/lib/protect";

// The dashboard posts its whole in-memory copy to /api/data. Everything the
// narrow routes write (RSVPs, plans, ratings) is missing from that copy if it
// landed after the page loaded, so preserveNarrowFields makes the stored
// document the source of truth for exactly those fields.

const stored = () => ({
  team: { name: "A" },
  players: [
    { id: "p1", name: "Sam", coach: { ratings: { GK: 3, DEF: 4, MID: 2, FWD: 1 }, note: "Left foot only" } },
    { id: "p2", name: "Ava" }
  ],
  fixtures: [
    {
      id: "f1", round: 1,
      availability: {
        p1: { status: "in", by: "Mum", at: 1 }, p2: { status: "out", reason: "Away", by: "Dad", at: 2 },
        p3: { status: "in", by: "Nan", at: 3 }, p4: { status: "in", by: "Mum", at: 4 },
        p5: { status: "out", reason: "Sick", by: "Dad", at: 5 }, p6: { status: "in", by: "Mum", at: 6 }
      },
      plan: { subTimes: [10, 20], assignments: [{ GK: "p1" }], updatedAt: 9 },
      record: { savedAt: 10, scoreUs: 2, scoreThem: 1, minutes: [{ pid: "p1", min: 30 }] }
    },
    { id: "f2", round: 2 }
  ],
  sessions: [
    { id: "s1", kind: "training", availability: { "2026-09-08": { p1: { status: "in", by: "Mum", at: 7 } } } },
    { id: "s2", kind: "training" }
  ]
});

// What the coach's tab held: it loaded before any reply, then they typed in
// a score for f1.
const stale = () => ({
  team: { name: "A" },
  players: [
    { id: "p1", name: "Sam" },
    { id: "p2", name: "Ava" }
  ],
  fixtures: [
    { id: "f1", round: 1, us: 2, them: 1, availability: {} },
    { id: "f2", round: 2 }
  ],
  sessions: [
    { id: "s1", kind: "training", availability: {} },
    { id: "s2", kind: "training" }
  ]
});

describe("preserveNarrowFields", () => {
  it("keeps the six RSVPs that landed after the coach's page loaded when they save a score", () => {
    const out = preserveNarrowFields(stored(), stale());
    const f1 = out.fixtures.find((f) => f.id === "f1");
    expect(f1).toMatchObject({ us: 2, them: 1 });
    expect(Object.keys(f1.availability)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(f1.availability).toEqual(stored().fixtures[0].availability);
  });

  it("takes the fixture's plan and record from the stored document", () => {
    const out = preserveNarrowFields(stored(), stale());
    const f1 = out.fixtures.find((f) => f.id === "f1");
    expect(f1.plan).toEqual(stored().fixtures[0].plan);
    expect(f1.record).toEqual(stored().fixtures[0].record);
  });

  it("drops a stale plan or record the stored fixture no longer has", () => {
    const incoming = stale();
    incoming.fixtures[1] = { id: "f2", round: 2, plan: { assignments: [] }, record: { scoreUs: 0 }, availability: { p9: { status: "in" } } };
    const out = preserveNarrowFields(stored(), incoming);
    const f2 = out.fixtures.find((f) => f.id === "f2");
    expect(f2).toEqual({ id: "f2", round: 2 });
  });

  it("keeps a session occurrence's availability from the stored document", () => {
    const out = preserveNarrowFields(stored(), stale());
    const s1 = out.sessions.find((s) => s.id === "s1");
    expect(s1.availability).toEqual({ "2026-09-08": { p1: { status: "in", by: "Mum", at: 7 } } });
    expect(out.sessions.find((s) => s.id === "s2")).toEqual({ id: "s2", kind: "training" });
  });

  it("keeps a player's coach block from the stored document", () => {
    const incoming = stale();
    incoming.players[1] = { id: "p2", name: "Ava", coach: { ratings: { GK: 5 }, note: "stale" } };
    const out = preserveNarrowFields(stored(), incoming);
    expect(out.players[0].coach).toEqual(stored().players[0].coach);
    expect(out.players[0].name).toBe("Sam");
    // p2 has no coach block in the store, so the stale one is not written.
    expect(out.players[1]).toEqual({ id: "p2", name: "Ava" });
  });

  it("keeps records that exist only in the incoming document exactly as sent", () => {
    const incoming = stale();
    const newFixture = { id: "f3", round: 3, availability: { p1: { status: "in" } }, plan: { assignments: [] } };
    const newSession = { id: "s3", kind: "training", availability: { "2026-09-09": {} } };
    const newPlayer = { id: "p3", name: "Leo", coach: { ratings: { GK: 1 }, note: "" } };
    incoming.fixtures.push(newFixture);
    incoming.sessions.push(newSession);
    incoming.players.push(newPlayer);
    const out = preserveNarrowFields(stored(), incoming);
    expect(out.fixtures.find((f) => f.id === "f3")).toEqual(newFixture);
    expect(out.sessions.find((s) => s.id === "s3")).toEqual(newSession);
    expect(out.players.find((p) => p.id === "p3")).toEqual(newPlayer);
  });

  it("honours deletions: records only in the stored document stay deleted", () => {
    const incoming = stale();
    incoming.fixtures = incoming.fixtures.filter((f) => f.id !== "f1");
    incoming.players = incoming.players.filter((p) => p.id !== "p1");
    incoming.sessions = incoming.sessions.filter((s) => s.id !== "s1");
    const out = preserveNarrowFields(stored(), incoming);
    expect(out.fixtures.map((f) => f.id)).toEqual(["f2"]);
    expect(out.players.map((p) => p.id)).toEqual(["p2"]);
    expect(out.sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it("returns the incoming document unchanged when nothing is stored yet", () => {
    const incoming = stale();
    expect(preserveNarrowFields(null, incoming)).toBe(incoming);
    expect(preserveNarrowFields(undefined, incoming)).toBe(incoming);
    expect(preserveNarrowFields("junk", incoming)).toBe(incoming);
  });

  it("never mutates either input", () => {
    const s = stored();
    const i = stale();
    const sBefore = JSON.stringify(s);
    const iBefore = JSON.stringify(i);
    const out = preserveNarrowFields(s, i);
    expect(JSON.stringify(s)).toBe(sBefore);
    expect(JSON.stringify(i)).toBe(iBefore);
    expect(out).not.toBe(i);
    expect(out.fixtures).not.toBe(i.fixtures);
  });

  it("never invents a key the stored record lacks", () => {
    const s = stored();
    s.fixtures[0] = { id: "f1", round: 1 };
    s.sessions[0] = { id: "s1", kind: "training" };
    const out = preserveNarrowFields(s, stale());
    const f1 = out.fixtures.find((f) => f.id === "f1");
    expect("availability" in f1).toBe(false);
    expect("plan" in f1).toBe(false);
    expect("record" in f1).toBe(false);
    expect("availability" in out.sessions.find((x) => x.id === "s1")).toBe(false);
    expect("coach" in out.players.find((p) => p.id === "p2")).toBe(false);
  });

  it("leaves the rest of the document alone", () => {
    const incoming = { ...stale(), team: { name: "Renamed" }, extra: 1 };
    const out = preserveNarrowFields(stored(), incoming);
    expect(out.team).toEqual({ name: "Renamed" });
    expect(out.extra).toBe(1);
  });
});
