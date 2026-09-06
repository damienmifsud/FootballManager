// Server-side visibility layer: what a parent or viewer account gets to see of
// the team document. /api/data runs every GET through redactForViewer before
// the JSON leaves the server, so coach-only material (rules, the coach PIN,
// player ratings and notes, the match record, un-published game plans, the
// match clock unless the live-score switch is on) never reaches a parent's
// browser — the dashboard can't leak what it never received.
//
// Coaches and admins get the document untouched. Everyone else is trimmed
// according to the coach's "what parents see" switches (team.parentsSee, with
// defaults from lib/teamSetup). Pure: no Next imports, never mutates its input,
// never adds a key the document didn't already have. Other families' guardian
// contacts and family PINs are trimmed too — a parent only receives their own.
import { teamParentsSee } from "@/lib/teamSetup";

const pad2 = (n) => String(n).padStart(2, "0");

// Today's date in Brisbane (UTC+10, no daylight saving) as "yyyy-mm-dd". Same
// arithmetic as lib/squadiSync.js toBrisbane: shift by ten hours, read UTC parts.
// Accepts a millisecond timestamp (default: now), a Date or an ISO string.
export function brisbaneTodayISO(now = Date.now()) {
  const ms = typeof now === "number" ? now : new Date(now).getTime();
  const d = new Date(ms + 10 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isCoachRole(role) {
  return role === "coach" || role === "admin";
}

// A parent following the game live may see who's on the pitch, but not the
// coach's working state: manual availability overrides and the "seen the hint"
// flag are planner UI bookkeeping, not lineup.
function livePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const { overrides, hintSeen, ...rest } = plan;
  return rest;
}

// The match clock (plan.timer: running/elapsed/anchor) is what the "live score
// and clock" switch governs on the server; with it off, no plan a parent gets
// carries the timer, however the plan itself was published.
function withoutClock(plan) {
  if (!plan || typeof plan !== "object" || !("timer" in plan)) return plan;
  const { timer, ...rest } = plan;
  return rest;
}

function redactFixture(fixture, see, ownIds, todayISO) {
  if (!fixture || typeof fixture !== "object") return fixture;
  const { plan, record, ...out } = fixture;

  // Plan: published ahead of time when the coach allows it; otherwise only on
  // game day for the live lineup (trimmed to what the pitch shows). The clock
  // rides along only while the live score switch is on.
  if (plan !== undefined) {
    let shown;
    if (see.planBeforeKickoff) shown = plan;
    else if (see.liveLineup && todayISO && fixture.dateISO === todayISO) shown = livePlan(plan);
    if (shown !== undefined) out.plan = see.liveScore ? shown : withoutClock(shown);
  }

  // Record: minutes only, and only per the after-the-game switches. Snapshot,
  // match log, opposition notes, shapes, blocks and the recorded score are the
  // coach's alone.
  if (record !== undefined) {
    const minutes = Array.isArray(record?.minutes) ? record.minutes : [];
    if (see.everyoneMinutes) out.record = { minutes };
    else if (see.ownChildMinutes) out.record = { minutes: minutes.filter((m) => ownIds.has(m?.pid)) };
  }
  return out;
}

// Returns a new document trimmed for the viewer. { role, playerIds, todayISO }:
// role "coach"/"admin" sees everything (same reference back); playerIds are the
// viewer's own children on this team (for the own-child minutes switch);
// todayISO is Brisbane's date, used for the game-day live-lineup rule.
export function redactForViewer(data, { role, playerIds = [], todayISO } = {}) {
  if (data == null) return data;
  if (isCoachRole(role)) return data;

  const see = teamParentsSee(data.team);
  const ownIds = new Set(playerIds);
  const out = { ...data };

  // Lineup rules and the coach PIN are the coach's alone.
  if (data.team && typeof data.team === "object") {
    const { rules, coachPin, ...team } = data.team;
    out.team = team;
  }
  // Ratings and notes are the coach's alone. Guardian contact details and the
  // family PIN belong to each family: a parent gets their own children's, never
  // another household's (the UI labels them "coach only", and the server now
  // agrees).
  if (Array.isArray(data.players)) {
    out.players = data.players.map((p) => {
      if (!p || typeof p !== "object") return p;
      const { coach, ...rest } = p;
      if (ownIds.has(p.id)) return rest;
      const { guardians, parentName, parentContact, parentEmails, pin, ...stranger } = rest;
      return stranger;
    });
  }
  if (Array.isArray(data.fixtures)) {
    out.fixtures = data.fixtures.map((f) => redactFixture(f, see, ownIds, todayISO));
  }
  return out;
}
