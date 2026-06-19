import { describe, it, expect } from "vitest";
import { seasonICS } from "@/lib/ics";

// seasonICS is the only export; the date math, recurrence, escaping and
// birthday logic are exercised through the generated ICS text. SEASON in the
// module is 2026, so all in-season dates below use 2026.

// Split the feed into its component lines (the module joins with CRLF).
const lines = (ics) => ics.split("\r\n");
// Extract each VEVENT block as an array of lines.
function events(ics) {
  const out = [];
  let cur = null;
  for (const l of lines(ics)) {
    if (l === "BEGIN:VEVENT") cur = [];
    else if (l === "END:VEVENT") { out.push(cur); cur = null; }
    else if (cur) cur.push(l);
  }
  return out;
}
const find = (block, prefix) => block.find((l) => l.startsWith(prefix));

describe("seasonICS — calendar wrapper", () => {
  it("wraps events in a VCALENDAR with the team name", () => {
    const ics = seasonICS({ team: { name: "Olympic FC" } });
    const ls = lines(ics);
    expect(ls[0]).toBe("BEGIN:VCALENDAR");
    expect(ls[ls.length - 1]).toBe("END:VCALENDAR");
    expect(ls).toContain("VERSION:2.0");
    expect(ls.some((l) => l === "X-WR-CALNAME:Olympic FC 2026")).toBe(true);
  });

  it("falls back to 'Team' when no team name is set", () => {
    const ics = seasonICS({});
    expect(lines(ics)).toContain("X-WR-CALNAME:Team 2026");
  });
});

describe("seasonICS — game fixtures", () => {
  const game = (over = {}) => ({
    id: "g1", round: 5, dateISO: "2026-06-20", time: "09:30",
    homeAway: "H", opponent: "Wests", venue: "Perry Park", status: "upcoming",
    ...over
  });

  it("emits a timed event with a +105 minute end for a game with a kickoff time", () => {
    const ev = events(seasonICS({ fixtures: [game()] }))[0];
    expect(find(ev, "DTSTART:")).toBe("DTSTART:20260620T093000");
    // 09:30 + 105 min = 11:15
    expect(find(ev, "DTEND:")).toBe("DTEND:20260620T111500");
    expect(find(ev, "LOCATION:")).toBe("LOCATION:Perry Park");
  });

  it("renders home games as 'us v them' and away games as 'them v us'", () => {
    const home = events(seasonICS({ team: { name: "Olympic" }, fixtures: [game({ homeAway: "H" })] }))[0];
    expect(find(home, "SUMMARY:")).toBe("SUMMARY:⚽ Olympic v Wests");
    const away = events(seasonICS({ team: { name: "Olympic" }, fixtures: [game({ homeAway: "A" })] }))[0];
    expect(find(away, "SUMMARY:")).toBe("SUMMARY:⚽ Wests v Olympic");
  });

  it("appends the score and round to a played game", () => {
    const ev = events(seasonICS({ fixtures: [game({ status: "played", us: 3, them: 1 })] }))[0];
    expect(find(ev, "DESCRIPTION:")).toBe("DESCRIPTION:Round 5 (3-1)");
  });

  it("marks cancelled games in the summary and description", () => {
    const ev = events(seasonICS({ fixtures: [game({ status: "cancelled" })] }))[0];
    expect(find(ev, "SUMMARY:").startsWith("SUMMARY:CANCELLED — ⚽")).toBe(true);
    expect(find(ev, "DESCRIPTION:")).toContain("— CANCELLED");
  });

  it("emits an all-day event when the game has no time", () => {
    const ev = events(seasonICS({ fixtures: [game({ time: "" })] }))[0];
    expect(find(ev, "DTSTART;VALUE=DATE:")).toBe("DTSTART;VALUE=DATE:20260620");
    // all-day DTEND is the next day
    expect(find(ev, "DTEND;VALUE=DATE:")).toBe("DTEND;VALUE=DATE:20260621");
  });

  it("excludes fixtures outside the season year", () => {
    const ics = seasonICS({ fixtures: [game({ dateISO: "2025-06-20" })] });
    expect(events(ics)).toHaveLength(0);
  });

  it("escapes commas and semicolons in text fields", () => {
    const ev = events(seasonICS({ team: { name: "Us" }, fixtures: [game({ homeAway: "A", opponent: "Wests, Red; Blue" })] }))[0];
    expect(find(ev, "SUMMARY:")).toBe("SUMMARY:⚽ Wests\\, Red\\; Blue v Us");
  });
});

describe("seasonICS — sessions", () => {
  it("emits a weekly RRULE event for a recurring session", () => {
    const ev = events(seasonICS({
      sessions: [{
        id: "s1", title: "Training", recur: "weekly", weekday: 2,
        time: "17:00", endTime: "18:00", location: "Park", notes: "bring water",
        startISO: "2026-03-01", untilISO: "2026-09-01"
      }]
    }))[0];
    const rrule = find(ev, "RRULE:");
    expect(rrule).toContain("FREQ=WEEKLY");
    expect(rrule).toContain("BYDAY=TU"); // weekday 2 = Tuesday
    expect(rrule).toContain("UNTIL=20260901T235959");
    expect(find(ev, "SUMMARY:")).toBe("SUMMARY:Training");
  });

  it("emits a single event for a one-off session", () => {
    const evs = events(seasonICS({
      sessions: [{ id: "s2", title: "One off", dateISO: "2026-05-10", time: "09:00", endTime: "10:00" }]
    }));
    expect(evs).toHaveLength(1);
    expect(find(evs[0], "DTSTART:")).toBe("DTSTART:20260510T090000");
  });

  it("uses the explicit endTime when provided", () => {
    const ev = events(seasonICS({
      sessions: [{ id: "s2", title: "One off", dateISO: "2026-05-10", time: "09:00", endTime: "10:30" }]
    }))[0];
    expect(find(ev, "DTEND:")).toBe("DTEND:20260510T103000");
  });
});

describe("seasonICS — birthdays", () => {
  it("creates a 'turns N' all-day event for a player with a birth year", () => {
    const ev = events(seasonICS({ players: [{ id: "p1", name: "Sam", dob: "2018-07-04" }] }))[0];
    expect(find(ev, "SUMMARY:")).toBe("SUMMARY:🎂 Sam turns 8"); // 2026 - 2018
    expect(find(ev, "DTSTART;VALUE=DATE:")).toBe("DTSTART;VALUE=DATE:20260704");
  });

  it("skips players with a missing or too-short dob", () => {
    const ics = seasonICS({ players: [{ id: "p1", name: "NoDob" }, { id: "p2", name: "Short", dob: "2018" }] });
    expect(events(ics)).toHaveLength(0);
  });

  it("skips players with an invalid dob", () => {
    const ics = seasonICS({ players: [{ id: "p1", name: "Bad", dob: "2018-13-99" }] });
    expect(events(ics)).toHaveLength(0);
  });

  it("omits a guest's birthday that falls outside their guest window", () => {
    const ics = seasonICS({
      players: [{ id: "p1", name: "Guest", dob: "2017-01-01", guest: true, fromISO: "2026-06-01", untilISO: "2026-09-01" }]
    });
    expect(events(ics)).toHaveLength(0);
  });

  it("includes a guest's birthday that falls inside their guest window", () => {
    const ics = seasonICS({
      players: [{ id: "p1", name: "Guest", dob: "2017-07-15", guest: true, fromISO: "2026-06-01", untilISO: "2026-09-01" }]
    });
    expect(events(ics)).toHaveLength(1);
  });
});
