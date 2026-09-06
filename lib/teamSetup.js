// Per-team settings for the /admin wizard and the coach's team setup: feature
// flags, what parents see, match-day rules, coach-only player fields and the
// match format. Everything lives on the team document (data.team.*) so the
// dashboard can gate its UI; absent values fall back to sensible defaults
// (features: fruit and goalkeeper duty on, focus on, jersey duty — a new
// duty — off). All pure; the routes call the sanitize* guards server-side.
import { defaultFormatForAgeGroup, parseFormation, fallbackFormation } from "@/lib/planner";

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

// ---- What parents see -----------------------------------------------------
// Coach-controlled visibility of match-day info for parent/viewer accounts.
// Same shape as the feature flags: known keys only, booleans, on top of defaults.
export const DEFAULT_PARENTS_SEE = {
  planBeforeKickoff: false,
  liveScore: true,
  liveLineup: true,
  ownChildMinutes: false,
  everyoneMinutes: false
};
export const PARENTS_SEE_LABELS = {
  planBeforeKickoff: "Lineup and sub plan before kick-off",
  liveScore: "Live score and clock",
  liveLineup: "Who's on the pitch on game day",
  ownChildMinutes: "Their own child's minutes after the game",
  everyoneMinutes: "Everyone's minutes after the game"
};
// Grouping for the settings UI, in the order the game unfolds.
export const PARENTS_SEE_GROUPS = [
  { title: "Before kick-off", keys: ["planBeforeKickoff"] },
  { title: "During the game", keys: ["liveScore", "liveLineup"] },
  { title: "After the game", keys: ["ownChildMinutes", "everyoneMinutes"] }
];

// The effective parent-visibility flags for a team object ({} tolerated).
export function teamParentsSee(team) {
  return { ...DEFAULT_PARENTS_SEE, ...(team?.parentsSee || {}) };
}

// Server-side guard: only known keys, coerced to booleans, on top of defaults.
export function sanitizeParentsSee(input) {
  const out = { ...DEFAULT_PARENTS_SEE };
  if (input && typeof input === "object") {
    for (const k of Object.keys(DEFAULT_PARENTS_SEE)) {
      if (k in input) out[k] = !!input[k];
    }
  }
  return out;
}

// ---- Match-day rules ------------------------------------------------------
// The planner's auto-fill honours team.rules in priority order (earlier beats
// later). Built-in rules have fixed text and can be switched off but never
// deleted; the coach can add short custom rules of their own.
export const BUILTIN_RULES = {
  "bi-period": "Everyone available plays in both halves",
  "bi-gk-break": "Keeper changes only at the break",
  "bi-rating-zero": "Nobody plays a spot they're rated 0 in",
  "bi-weak-wide": "Less confident players start out wide, not through the middle",
  "bi-no-double-bench": "Nobody sits out two blocks in a row",
  "bi-sticky-positions": "Players come back on in the position they left"
};
const DEFAULT_RULE_IDS = ["bi-period", "bi-gk-break", "bi-rating-zero"];
const builtinRule = (id, off) => ({ id, text: BUILTIN_RULES[id], builtin: true, ...(off ? { off: true } : {}) });
// Seeded when a team has no rules yet, in this priority order.
export const DEFAULT_RULES = DEFAULT_RULE_IDS.map((id) => builtinRule(id, false));
const MAX_RULES = 20;
const RULE_ID_RE = /^[a-z0-9_-]{1,24}$/i;
const isBuiltinId = (id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(BUILTIN_RULES, id);

// The effective rules for a team object: its own list, else a fresh copy of
// the defaults (never the shared DEFAULT_RULES array itself).
export function teamRules(team) {
  const rules = team?.rules;
  if (Array.isArray(rules) && rules.length) return rules;
  return DEFAULT_RULES.map((r) => ({ ...r }));
}

// Server-side guard for team.rules. Keeps order, caps the list, drops
// duplicate ids (first wins), forces built-in text/flag, tidies custom rules
// and re-appends any of the seeded built-ins the client left out.
export function sanitizeRules(input) {
  if (!Array.isArray(input)) return DEFAULT_RULES.map((r) => ({ ...r }));
  const kept = [];
  const seen = new Set();
  // Read the whole list first: the cap is applied after the seeded built-ins are
  // guaranteed, so a built-in ranked past the cap keeps its on/off state.
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    let rule;
    if (isBuiltinId(raw.id)) {
      rule = builtinRule(raw.id, !!raw.off);
    } else {
      const text = String(raw.text ?? "").trim().slice(0, 160);
      if (!text) continue;
      const id = typeof raw.id === "string" && RULE_ID_RE.test(raw.id) ? raw.id : "r_" + uid();
      rule = {
        id,
        text,
        builtin: false,
        ...(Number.isFinite(raw.createdAt) ? { createdAt: raw.createdAt } : {}),
        ...(raw.off ? { off: true } : {})
      };
    }
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    kept.push(rule);
  }
  // Built-ins can't be deleted: anything seeded that went missing comes back on.
  for (const id of DEFAULT_RULE_IDS) {
    if (!seen.has(id)) kept.push(builtinRule(id, false));
  }
  // If re-appending pushed us over the cap, the lowest-priority custom rules go.
  while (kept.length > MAX_RULES) {
    const i = kept.findLastIndex((r) => !r.builtin);
    if (i < 0) break;
    kept.splice(i, 1);
  }
  return kept;
}

// ---- Coach-only player fields ---------------------------------------------
// Position ratings (0-5, null = not rated) and a private note per player.
const RATING_KEYS = ["GK", "DEF", "MID", "FWD"];
const sanitizeRating = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(5, Math.max(0, Math.round(v))) : null);
export function sanitizeCoachFields(input) {
  const ratings = {};
  const src = input && typeof input === "object" ? input : {};
  const rawRatings = src.ratings && typeof src.ratings === "object" ? src.ratings : {};
  for (const k of RATING_KEYS) ratings[k] = sanitizeRating(rawRatings[k]);
  return { ratings, note: String(src.note ?? "").trim().slice(0, 400) };
}

// ---- Match format ---------------------------------------------------------
// Full format object on top of the age-group default. Numbers are rounded and
// clamped; the formation (the home shape) must fit the outfield count or it
// falls back to the planner's default shape for that many players.
const MAX_FORMATION_ROWS = 5, MAX_PLAYERS_PER_ROW = 6;
// Numbers and numeric strings (form fields) only — null/booleans/junk keep the default.
const clampInt = (v, lo, hi, fallback) => {
  const raw = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  const n = Math.round(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
export function formationFits(formation, outfield) {
  const rows = parseFormation(formation);
  return rows.length > 0 && rows.length <= MAX_FORMATION_ROWS
    && rows.every((n) => n <= MAX_PLAYERS_PER_ROW)
    && rows.reduce((s, n) => s + n, 0) === outfield;
}
export function sanitizeMatchFormat(input, ageGroup) {
  const base = defaultFormatForAgeGroup(ageGroup);
  if (!input || typeof input !== "object") return base;
  const out = { ...base };
  if ("gameLength" in input) out.gameLength = clampInt(input.gameLength, 10, 120, base.gameLength);
  if ("periods" in input) out.periods = clampInt(input.periods, 1, 4, base.periods);
  if ("playersOnField" in input) out.playersOnField = clampInt(input.playersOnField, 3, 11, base.playersOnField);
  if ("hasGK" in input) out.hasGK = !!input.hasGK;
  if ("subInterval" in input) out.subInterval = clampInt(input.subInterval, 2, 45, base.subInterval);
  const outfield = out.playersOnField - (out.hasGK ? 1 : 0);
  const candidate = "formation" in input ? String(input.formation ?? "").trim().slice(0, 20) : out.formation;
  out.formation = formationFits(candidate, outfield) ? candidate : fallbackFormation(outfield);
  return out;
}
