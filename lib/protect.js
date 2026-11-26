// Protects the fields owned by the narrow routes from the whole-document save.
//
// Why: the dashboard posts its ENTIRE in-memory copy to /api/data whenever the
// coach changes anything (a score, a fixture, a player's number). Meanwhile
// parents' RSVPs are written through /api/rsvp, game plans through /api/plan,
// duty claims through /api/duty and coach ratings through /api/player-coach —
// and none of those writes ever flow back into the coach's open tab. So a
// coach recording a score used to post a copy that was stale for those fields
// and wipe every reply that had landed since their page loaded. The fix: the whole-doc save is never the
// source of truth for those fields. For every record that exists on both
// sides (matched by id) the stored value wins:
//   fixtures: availability, plan, record, fruit, gk, jersey
//   sessions: availability
//   players:  coach
// Records only in the incoming document (something the coach just created) are
// kept exactly as sent; records only in the stored document (something the
// coach just deleted) stay deleted. Inputs are never mutated and no key the
// stored record lacks is ever invented — if stored has no plan, the result has
// no plan either, even if the stale copy carried one.
//
// Two whole keys are owned by narrow routes too, and the whole-document save
// never writes either: the stored value wins, and a document that has none
// stays without one, whatever is sent (the first save of a new document
// included).
//   squadi: the league page's setup. /api/league is its only writer, and the
//     only place a pasted link is checked. Two stale copies are in mind: a
//     dashboard tab opened before a coach saved the setup, which would post
//     the old one (or none) back with its next save, and a league tab left
//     open from before /api/league existed, whose whole-document save carries
//     a setup that route never saw.
//   competitionSquads: who is in each competition's squad, written through
//     /api/competition-squad. A dashboard tab opened before the coach picked a
//     squad would otherwise put everyone back in it with its next save.

const PROTECTED = {
  fixtures: ["availability", "plan", "record", "fruit", "gk", "jersey"],
  sessions: ["availability"],
  players: ["coach"]
};
const PROTECTED_KEYS = ["squadi", "competitionSquads"];
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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
      if (hasOwn(stored, key)) out[key] = stored[key];
      else delete out[key];
    }
    return out;
  });
}

// Nothing is stored yet: the document is kept as sent, minus any whole key a
// narrow route owns. The same object comes back when there is nothing to drop.
function withoutProtectedKeys(incoming) {
  if (!PROTECTED_KEYS.some((key) => hasOwn(incoming, key))) return incoming;
  const out = { ...incoming };
  for (const key of PROTECTED_KEYS) delete out[key];
  return out;
}

// A new document equal to `incoming`, except that the protected fields on any
// record that also exists in `stored` come from `stored`, and a protected
// whole key is whatever `stored` has (absent when `stored` has none).
export function preserveNarrowFields(stored, incoming) {
  if (incoming == null || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  if (stored == null || typeof stored !== "object" || Array.isArray(stored)) return withoutProtectedKeys(incoming);
  const out = { ...incoming };
  for (const [list, keys] of Object.entries(PROTECTED)) {
    if (list in incoming) out[list] = protectList(stored[list], incoming[list], keys);
  }
  for (const key of PROTECTED_KEYS) {
    if (hasOwn(stored, key)) out[key] = stored[key];
    else delete out[key];
  }
  return out;
}
