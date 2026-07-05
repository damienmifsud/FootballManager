// Per-team feature flags + training-schedule seeding for the /admin wizard.
// Features live on the team document (data.team.features) so the dashboard
// can gate its UI; absent flags fall back to the pre-flag behaviour (fruit
// and goalkeeper duty on, focus on) with jersey duty — a new duty — off.

const uid = () => Math.random().toString(36).slice(2, 9);

export const DEFAULT_FEATURES = { fruitDuty: true, jerseyDuty: false, gkDuty: true, focus: true };
export const FEATURE_LABELS = {
  fruitDuty: "Fruit duty",
  jerseyDuty: "Jersey duty",
  gkDuty: "Goalkeeper duty",
  focus: "Focus of the week"
};

// The effective flags for a team object ({} tolerated).
export function teamFeatures(team) {
  return { ...DEFAULT_FEATURES, ...(team?.features || {}) };
}

// Server-side guard: only known keys, coerced to booleans, on top of defaults.
export function sanitizeFeatures(input) {
  const out = { ...DEFAULT_FEATURES };
  if (input && typeof input === "object") {
    for (const k of Object.keys(DEFAULT_FEATURES)) {
      if (k in input) out[k] = !!input[k];
    }
  }
  return out;
}

// Turn the wizard's training rows into the dashboard's weekly session shape —
// the same one the calendar tab, the ICS feed (RRULE) and RSVPs already
// understand, so seeded sessions appear in every subscribed calendar exactly
// like Squadi-synced games do.
// Rows: { weekday: 0-6 (JS getDay), time: "HH:MM", endTime?: "HH:MM", location?, title? }
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function sanitizeTrainingSessions(input, max = 7) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, max).map((r) => {
    if (!r) return null;
    const weekday = Number(r.weekday);
    const time = String(r.time || "").trim();
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !TIME_RE.test(time)) return null;
    const endTime = TIME_RE.test(String(r.endTime || "").trim()) ? String(r.endTime).trim() : "";
    return {
      id: uid(),
      title: String(r.title || "").trim().slice(0, 60) || "Training",
      kind: "training",
      recur: "weekly",
      weekday,
      time,
      ...(endTime ? { endTime } : {}),
      location: String(r.location || "").trim().slice(0, 120),
      notes: ""
    };
  }).filter(Boolean);
}
