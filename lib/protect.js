// Protects the fields owned by the narrow routes from the whole-document save.
//
// Why: the dashboard posts its ENTIRE in-memory copy to /api/data whenever the
// coach changes anything (a score, a fixture, a player's number). Meanwhile
// parents' RSVPs are written through /api/rsvp, game plans through /api/plan
// and coach ratings through /api/player-coach — and none of those writes ever
// flow back into the coach's open tab. So a coach recording a score used to
// post a copy that was stale for those fields and wipe every reply that had
// landed since their page loaded. The fix: the whole-doc save is never the
// source of truth for those fields. For every record that exists on both
// sides (matched by id) the stored value wins:
//   fixtures: availability, plan, record
//   sessions: availability
//   players:  coach
// Records only in the incoming document (something the coach just created) are
// kept exactly as sent; records only in the stored document (something the
// coach just deleted) stay deleted. Inputs are never mutated and no key the
// stored record lacks is ever invented — if stored has no plan, the result has
// no plan either, even if the stale copy carried one.

const PROTECTED = {
  fixtures: ["availability", "plan", "record"],
  sessions: ["availability"],
  players: ["coach"]
};

function protectList(storedList, incomingList, keys) {
  if (!Array.isArray(incomingList)) return incomingList;
  const byId = new Map();
  for (const rec of Array.isArray(storedList) ? storedList : []) {
    if (rec && rec.id != null) byId.set(rec.id, rec);
  }
  return incomingList.map((rec) => {
    if (!rec || rec.id == null || !byId.has(rec.id)) return rec;
    const stored = byId.get(rec.id);
    const out = { ...rec };
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
      else delete out[key];
    }
    return out;
  });
}

// A new document equal to `incoming`, except that the protected fields on any
// record that also exists in `stored` come from `stored`.
export function preserveNarrowFields(stored, incoming) {
  if (stored == null || typeof stored !== "object" || Array.isArray(stored)) return incoming;
  if (incoming == null || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  const out = { ...incoming };
  for (const [list, keys] of Object.entries(PROTECTED)) {
    if (list in incoming) out[list] = protectList(stored[list], incoming[list], keys);
  }
  return out;
}
