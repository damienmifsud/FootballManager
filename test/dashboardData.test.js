import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeStats, nextFixture, isPastGame, fmtDate, countdown, ytId, videoKind,
  mapsUrl, activeOn, intlPhone, recentChanges, initials, secToClock, clockToSec,
  occurrences, monthItems, upcomingItems, nextBirthdays
} from "@/lib/dashboardData";

// Pin "now" for the helpers that read the clock (countdown, isPastGame,
// recentChanges, nextFixture, activeOn's default). 2026-06-18 local.
const NOW = new Date(2026, 5, 18, 12, 0, 0);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("computeStats", () => {
  const data = {
    players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" }],
    fixtures: [
      { status: "played", round: 1, dateISO: "2026-03-01", us: 3, them: 1, goals: [{ pid: "p1", n: 2 }], assists: [{ pid: "p2", n: 1 }] },
      { status: "played", round: 2, dateISO: "2026-03-08", us: 1, them: 1 },
      { status: "played", round: 3, dateISO: "2026-03-15", us: 0, them: 2 },
      { status: "upcoming", round: 4, dateISO: "2026-09-01", us: null, them: null }
    ]
  };

  it("tallies record, goals, points and last-5 form in date order", () => {
    const s = computeStats(data);
    expect(s).toMatchObject({ played: 3, w: 1, dr: 1, l: 1, gf: 4, ga: 4, pts: 4 });
    expect(s.form).toEqual(["W", "D", "L"]);
    expect(s.perRound).toEqual([
      { round: "R1", GF: 3, GA: 1 }, { round: "R2", GF: 1, GA: 1 }, { round: "R3", GF: 0, GA: 2 }
    ]);
  });

  it("builds a scorer board (goals first), excluding players with none", () => {
    const s = computeStats(data);
    expect(s.scorers.map(p => p.id)).toEqual(["p1", "p2"]);
    expect(s.scorers[0]).toMatchObject({ id: "p1", goals: 2, assists: 0 });
    expect(s.scorers[1]).toMatchObject({ id: "p2", goals: 0, assists: 1 });
  });
});

describe("nextFixture", () => {
  it("returns the soonest upcoming fixture on/after today, ignoring played", () => {
    const data = { fixtures: [
      { id: "a", status: "played", dateISO: "2026-06-10" },
      { id: "b", status: "upcoming", dateISO: "2026-09-01", time: "09:00" },
      { id: "c", status: "upcoming", dateISO: "2026-07-01", time: "10:00" }
    ] };
    expect(nextFixture(data).id).toBe("c");
  });

  it("sorts TBC (no date) fixtures last and returns null when none upcoming", () => {
    expect(nextFixture({ fixtures: [{ id: "x", status: "played", dateISO: "2026-01-01" }] })).toBeNull();
    const data = { fixtures: [
      { id: "tbc", status: "upcoming", dateISO: "" },
      { id: "dated", status: "upcoming", dateISO: "2026-08-01" }
    ] };
    expect(nextFixture(data).id).toBe("dated");
  });
});

describe("isPastGame", () => {
  it("is true only for a dated game before today", () => {
    expect(isPastGame({ dateISO: "2026-06-10" })).toBe(true);
    expect(isPastGame({ dateISO: "2026-06-25" })).toBe(false);
    expect(isPastGame({ dateISO: "" })).toBe(false);
    expect(isPastGame(null)).toBe(false);
  });
});

describe("fmtDate", () => {
  it("formats an ISO date and returns '' for falsy input", () => {
    expect(fmtDate("")).toBe("");
    const out = fmtDate("2026-06-20");
    expect(out).toContain("Jun");
    expect(out).toContain("20");
  });
});

describe("countdown", () => {
  it("returns null without a date", () => { expect(countdown(null)).toBeNull(); });
  it("says 'Kicking off' once the time has passed", () => {
    expect(countdown("2026-06-18", "09:00")).toBe("Kicking off");
  });
  it("counts days and hours when more than a day away", () => {
    expect(countdown("2026-06-20", "12:00")).toBe("2d 0h");
  });
  it("counts hours and minutes when less than a day away", () => {
    expect(countdown("2026-06-18", "14:30")).toBe("2h 30m");
  });
});

describe("ytId / videoKind", () => {
  it("extracts ids from common YouTube URL shapes and bare ids", () => {
    expect(ytId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytId("not a video")).toBeNull();
    expect(ytId("")).toBeNull();
  });
  it("classifies link kinds", () => {
    expect(videoKind("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(videoKind("https://app.veo.co/matches/123")).toBe("veo");
    expect(videoKind("https://example.com/clip.mp4")).toBe("other");
    expect(videoKind("just text")).toBeNull();
    expect(videoKind("")).toBeNull();
  });
});

describe("mapsUrl / intlPhone / initials", () => {
  it("builds an encoded maps query", () => {
    expect(mapsUrl("Perry Park, Brisbane")).toBe("https://www.google.com/maps/search/?api=1&query=Perry%20Park%2C%20Brisbane");
  });
  it("converts AU mobiles to international and strips formatting", () => {
    expect(intlPhone("0400 123 456")).toBe("61400123456");
    expect(intlPhone("+61 400 123 456")).toBe("61400123456");
    expect(intlPhone("")).toBe("");
  });
  it("derives up-to-two uppercase initials", () => {
    expect(initials("Sam Smith")).toBe("SS");
    expect(initials("Madonna")).toBe("M");
    expect(initials("")).toBe("?");
  });
});

describe("activeOn", () => {
  it("is always true for non-guests", () => {
    expect(activeOn({ guest: false }, "2026-01-01")).toBe(true);
  });
  it("respects a guest's from/until window", () => {
    const g = { guest: true, fromISO: "2026-06-01", untilISO: "2026-08-31" };
    expect(activeOn(g, "2026-07-01")).toBe(true);
    expect(activeOn(g, "2026-05-01")).toBe(false);
    expect(activeOn(g, "2026-09-01")).toBe(false);
  });
  it("defaults to today when no date is given", () => {
    expect(activeOn({ guest: true, untilISO: "2026-06-01" })).toBe(false); // today is 06-18
    expect(activeOn({ guest: true, untilISO: "2026-12-01" })).toBe(true);
  });
});

describe("recentChanges", () => {
  const day = 86400000;
  it("keeps changes from the last 14 days and drops older ones", () => {
    const f = { schedChanges: [
      { field: "fresh", at: NOW.getTime() - 2 * day },
      { field: "stale", at: NOW.getTime() - 20 * day }
    ] };
    expect(recentChanges(f).map(c => c.field)).toEqual(["fresh"]);
  });
  it("tolerates a missing schedChanges array", () => {
    expect(recentChanges({})).toEqual([]);
    expect(recentChanges(null)).toEqual([]);
  });
});

describe("secToClock / clockToSec", () => {
  it("formats seconds with an hours component only when needed", () => {
    expect(secToClock(75)).toBe("1:15");
    expect(secToClock(3661)).toBe("1:01:01");
    expect(secToClock(-5)).toBe("0:00");
  });
  it("parses mm:ss and hh:mm:ss back to seconds", () => {
    expect(clockToSec("1:15")).toBe(75);
    expect(clockToSec("1:01:01")).toBe(3661);
    expect(clockToSec("90")).toBe(90);
  });
});

describe("occurrences", () => {
  it("returns the single date for a one-off in the right year", () => {
    expect(occurrences({ dateISO: "2026-05-10" })).toEqual(["2026-05-10"]);
    expect(occurrences({ dateISO: "2025-05-10" })).toEqual([]); // not this season
    expect(occurrences(null)).toEqual([]);
  });
  it("expands a weekly session onto its weekday within the window", () => {
    const occ = occurrences({ recur: "weekly", weekday: 2, startISO: "2026-06-01", untilISO: "2026-06-30" });
    expect(occ.length).toBe(5); // Tuesdays in June 2026
    for (const iso of occ) expect(new Date(iso + "T00:00:00").getDay()).toBe(2);
    expect(occ[0] >= "2026-06-01" && occ[occ.length - 1] <= "2026-06-30").toBe(true);
  });
  it("defaults to the current year, not a fixed season", () => {
    expect(occurrences({ recur: "weekly", weekday: 2, startISO: "2026-06-01", untilISO: "2026-06-30" }).length).toBe(5);
    vi.setSystemTime(new Date(2027, 5, 18));
    expect(occurrences({ dateISO: "2027-05-10" })).toEqual(["2027-05-10"]);
    expect(occurrences({ dateISO: "2026-05-10" })).toEqual([]);
  });
  it("clamps a weekly session to the season window (before its start, after its end)", () => {
    const win = { startISO: "2026-02-15", endISO: "2026-11-30" };
    const occ = occurrences({ recur: "weekly", weekday: 2 }, 2026, win);
    expect(occ[0]).toBe("2026-02-17"); // first Tuesday on/after 15 Feb
    expect(occ[occ.length - 1]).toBe("2026-11-24"); // last Tuesday on/before 30 Nov
    expect(occ.every((iso) => iso >= win.startISO && iso <= win.endISO)).toBe(true);
    expect(occ.length).toBe(41);
  });
  it("the session's own from/until narrows further inside the window, and an empty overlap gives nothing", () => {
    const win = { startISO: "2026-02-15", endISO: "2026-11-30" };
    const occ = occurrences({ recur: "weekly", weekday: 2, startISO: "2026-03-01", untilISO: "2026-03-31" }, 2026, win);
    expect(occ).toEqual(["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24", "2026-03-31"]);
    expect(occurrences({ recur: "weekly", weekday: 2, startISO: "2026-12-01" }, 2026, win)).toEqual([]);
    expect(occurrences({ recur: "weekly", weekday: 2 }, 2027, win)).toEqual([]); // window entirely in 2026
  });
  it("a window across the year boundary only yields the part in the asked year, and an 18-month run is never truncated", () => {
    const win = { startISO: "2026-10-01", endISO: "2027-03-31" };
    const in2026 = occurrences({ recur: "weekly", weekday: 6 }, 2026, win);
    const in2027 = occurrences({ recur: "weekly", weekday: 6 }, 2027, win);
    expect(in2026[0]).toBe("2026-10-03");
    expect(in2026[in2026.length - 1]).toBe("2026-12-26");
    expect(in2027[0]).toBe("2027-01-02");
    expect(in2027[in2027.length - 1]).toBe("2027-03-27");
    const long = occurrences({ recur: "weekly", weekday: 1, startISO: "2026-01-01", untilISO: "2026-12-31" }, 2026);
    expect(long.length).toBe(52); // the old 60-week guard never bit here; the 120 cap never will
  });
});

describe("monthItems", () => {
  const data = {
    fixtures: [{ id: "f1", dateISO: "2026-06-20", time: "09:00", opponent: "Wests" }, { id: "f2", dateISO: "2026-07-05", opponent: "Souths" }],
    sessions: [{ id: "s1", title: "Training", recur: "weekly", weekday: 2, time: "17:00", startISO: "2026-06-01", untilISO: "2026-06-30" }],
    players: [{ id: "p1", name: "Sam", dob: "2018-06-15" }]
  };
  it("collects games, training occurrences and birthdays for the month, sorted", () => {
    const items = monthItems(data, 2026, 5); // June (0-indexed)
    const kinds = new Set(items.map(i => i.kind));
    expect(kinds).toEqual(new Set(["game", "training", "birthday"]));
    expect(items.find(i => i.kind === "game").title).toBe("vs Wests");
    expect(items.find(i => i.kind === "birthday").title).toBe("Sam turns 8"); // plain text, no emoji (S4)
    // July fixture is excluded
    expect(items.some(i => i.title === "vs Souths")).toBe(false);
    // sorted ascending by date+time
    const keys = items.map(i => i.dateISO + (i.time || ""));
    expect(keys).toEqual([...keys].sort());
  });
  it("excludes an expired guest's birthday", () => {
    const d = { fixtures: [], sessions: [], players: [{ id: "g", name: "Guest", dob: "2018-06-15", guest: true, untilISO: "2026-01-01" }] };
    expect(monthItems(d, 2026, 5)).toEqual([]);
  });
  it("uses the plain birthday title when the birth year is unknown", () => {
    const d = { fixtures: [], sessions: [], players: [{ id: "p", name: "Sam", dob: "1900-06-15" }] };
    expect(monthItems(d, 2026, 5)[0].title).toBe("Sam's birthday");
    expect(upcomingItems(d, "2026-06-14", 7)[0].title).toBe("Sam's birthday");
  });
  it("shows no weekly training outside the team's season window; fixtures are explicit dates and stay", () => {
    const d = {
      team: { season: { startISO: "2026-03-01", endISO: "2026-09-30" } },
      fixtures: [{ id: "f1", dateISO: "2026-11-07", time: "09:00", opponent: "Cup" }],
      sessions: [{ id: "s1", title: "Training", recur: "weekly", weekday: 2, time: "17:00" }], // unbounded, as the wizard seeds it
      players: []
    };
    expect(monthItems(d, 2026, 1).filter((i) => i.kind === "training")).toEqual([]); // February: before the season
    expect(monthItems(d, 2026, 2).filter((i) => i.kind === "training").length).toBe(5); // March: 5 Tuesdays
    expect(monthItems(d, 2026, 10).filter((i) => i.kind === "training")).toEqual([]); // November: after the season
    expect(monthItems(d, 2026, 10).map((i) => i.title)).toEqual(["vs Cup"]);
  });
  it("works for a 2027 season", () => {
    const d = {
      team: { season: { startISO: "2027-02-01", endISO: "2027-11-30" } },
      fixtures: [], players: [],
      sessions: [{ id: "s1", title: "Training", recur: "weekly", weekday: 3, time: "17:00" }]
    };
    const feb = monthItems(d, 2027, 1);
    expect(feb.length).toBe(4); // Wednesdays in February 2027: 3, 10, 17, 24
    expect(feb[0].dateISO).toBe("2027-02-03");
    expect(monthItems(d, 2027, 0)).toEqual([]); // January 2027 is outside
    expect(monthItems(d, 2026, 5)).toEqual([]); // and so is all of 2026
  });
});

describe("upcomingItems", () => {
  it("returns games/sessions/birthdays within the window", () => {
    const data = {
      fixtures: [{ id: "f1", dateISO: "2026-06-20", time: "09:00", opponent: "Wests" }, { id: "far", dateISO: "2026-08-01", opponent: "Far" }],
      sessions: [{ id: "s1", title: "Training", recur: "weekly", weekday: 2, time: "17:00" }],
      players: [{ id: "p1", name: "Sam", dob: "2018-06-21" }]
    };
    const items = upcomingItems(data, "2026-06-18", 7); // 18th–24th
    const titles = items.map(i => i.title);
    expect(titles).toContain("vs Wests");
    expect(titles).toContain("Sam turns 8"); // plain text, no emoji (S4)
    expect(titles).toContain("Training");
    expect(titles).not.toContain("vs Far"); // outside the 7-day window
  });
  it("clamps weekly training to the season window", () => {
    const data = {
      team: { season: { startISO: "2026-06-22", endISO: "2026-12-31" } },
      fixtures: [{ id: "f1", dateISO: "2026-06-20", time: "09:00", opponent: "Wests" }],
      sessions: [{ id: "s1", title: "Training", recur: "weekly", weekday: 2, time: "17:00" }],
      players: []
    };
    const items = upcomingItems(data, "2026-06-18", 7); // 18th–24th; the season starts on the 22nd
    expect(items.map((i) => i.title)).toEqual(["vs Wests", "Training"]);
    expect(items[1].dateISO).toBe("2026-06-23"); // Tuesday the 16th is gone, the 23rd stays
    const none = upcomingItems({ ...data, team: { season: { startISO: "2026-07-01", endISO: "2026-12-31" } } }, "2026-06-18", 7);
    expect(none.map((i) => i.title)).toEqual(["vs Wests"]);
  });
});

describe("nextBirthdays", () => {
  const data = { players: [
    { id: "p1", name: "Sam", dob: "2018-06-21" },   // soon
    { id: "p2", name: "Lee", dob: "2017-12-25" },    // later this year
    { id: "p3", name: "Mo", dob: "2019-01-05" }      // rolls to next year
  ] };
  it("returns the next n birthdays from a date, rolling past ones to next year", () => {
    const out = nextBirthdays(data, "2026-06-18", 3);
    expect(out.map(b => b.p.id)).toEqual(["p1", "p2", "p3"]);
    expect(out[0]).toMatchObject({ iso: "2026-06-21", age: 8 });
    expect(out[2].iso).toBe("2027-01-05"); // rolled into next year
  });
  it("respects the n limit and skips expired guests", () => {
    expect(nextBirthdays(data, "2026-06-18", 1).map(b => b.p.id)).toEqual(["p1"]);
    const guests = { players: [{ id: "g", name: "G", dob: "2018-07-01", guest: true, untilISO: "2026-06-01" }] };
    expect(nextBirthdays(guests, "2026-06-18", 2)).toEqual([]);
  });
});
