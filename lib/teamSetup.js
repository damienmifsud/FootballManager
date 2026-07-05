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

// Staff rows for the team header / Squad tab (same shape getStaff() reads).
export const STAFF_ROLES = ["Head coach", "Assistant coach", "Manager"];
export function sanitizeStaff(input, max = 6) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, max).map((s) => {
    const name = String(s?.name || "").trim().slice(0, 80);
    if (!name) return null;
    return {
      role: String(s?.role || "").trim().slice(0, 40) || "Coach",
      name,
      mobile: String(s?.mobile || "").replace(/\D/g, "").slice(0, 15),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s?.email || "").trim()) ? String(s.email).trim().toLowerCase() : "",
      photo: ""
    };
  }).filter(Boolean);
}

// Logos arrive as downscaled data URLs from the client; refuse anything else
// (or anything suspiciously large — the client shrinks to ~10-20KB).
export function sanitizeLogo(input, maxLen = 300000) {
  const s = String(input || "");
  return s.startsWith("data:image/") && s.length <= maxLen ? s : "";
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
