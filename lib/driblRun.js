// The scheduled Dribl reader's steps. scripts/dribl-sync.mjs runs them on
// GitHub's servers (.github/workflows/dribl-sync.yml), once it is switched on.
//
// 1. Ask the site for every team's Dribl draws (GET /api/dribl with the
//    scheduled-job key, CRON_SECRET).
// 2. Read each draw from Dribl with plain requests (lib/dribl.js fetchDribl):
//    Node's own fetch with the Accept header, plus the club's header when
//    Dribl has agreed one (a name and a value it lets through). No browser,
//    and nothing dressed up as one. Dribl turns most servers away; when it
//    turns this one away the run says so and fails, which is the cue to take
//    it up with Dribl.
// 3. Post each team's draws back (POST /api/dribl), where they are checked
//    and applied exactly as a coach's are.
//
// The repository is public, and so is what a run prints: how many draws and
// games, and how each went. Never a team's name, a competition, an id or a
// link, and never Dribl's own words, which can quote a team's name: a failure
// is told by its kind and status.
//
// Pure apart from the fetch it is given. Relative imports only, so plain Node
// runs it without the app's build.
import { fetchDribl, NOT_READABLE, UNREACHABLE, WHICH_TEAM } from "./dribl.js";

export const DEFAULT_CLUB_HEADER = "X-Club-Sync";
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const DRIBL_TIMEOUT_MS = 30_000;
const SITE_TIMEOUT_MS = 90_000; // a site that has been asleep can take a while to answer

// What went wrong with one draw, by kind. `status` is Dribl's HTTP status when it gave one.
export function failureOf(error) {
  const said = String(error?.message || error || "");
  const status = Number((/^Dribl responded (\d{3})\b/.exec(said) || [])[1]) || 0;
  if (status === 401 || status === 403 || status === 429) return { kind: "refused", status };
  if (status) return { kind: "dribl-error", status };
  if (said === UNREACHABLE || error?.name === "TimeoutError" || error?.name === "AbortError") return { kind: "unreachable" };
  if (said.startsWith(NOT_READABLE) || said === "Unexpected Dribl response shape") return { kind: "unreadable" };
  if (said === WHICH_TEAM || said.startsWith("No team called") || said.startsWith("More than one team")) return { kind: "which-team" };
  if (said === "Not a Dribl fixtures request") return { kind: "not-a-request" };
  return { kind: "other" };
}

const KIND_SAYS = {
  refused: "refused by Dribl",
  "dribl-error": "Dribl had a problem",
  unreachable: "Dribl did not answer",
  unreadable: "Dribl's answer was not in the form the app reads",
  "which-team": "the team's name on Dribl needs checking in the team's set-up",
  "not-a-request": "the saved Dribl fixtures request is not one",
  other: "something else went wrong"
};
export const says = (f) => KIND_SAYS[f.kind] + (f.status ? ` (${f.status})` : "");

// The site's address as a base for its routes, or null when it is not one.
export function siteBase(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  return u.origin;
}

// Dribl's requests with the club's agreed header added, when there is one, and a time limit.
function driblFetch(fetchImpl, { clubHeader, clubKey }) {
  return (url, opts = {}) => fetchImpl(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(clubKey ? { [clubHeader]: clubKey } : {}) },
    signal: AbortSignal.timeout(DRIBL_TIMEOUT_MS)
  });
}

// Run once. Returns { ok, teams, draws, read, failed, refused, saved } and
// prints as it goes. `ok` is false when anything could not be done: the site
// refused or could not be reached, a draw could not be read, or a team's
// games could not be saved.
export async function runDriblSync({ site, cronKey, clubKey = "", clubHeader = "", fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const out = { ok: false, teams: 0, draws: 0, read: 0, failed: [], refused: 0, saved: 0 };
  const base = siteBase(site);
  if (!base) { log("SITE_URL is not set to the site's address (https://…), so there is nothing to ask."); return out; }
  if (!cronKey) { log("CRON_SECRET is not set, so the site would not answer. Set it to the same value as on the site."); return out; }
  const header = String(clubHeader || "").trim() || DEFAULT_CLUB_HEADER;
  if (clubKey && !HEADER_NAME.test(header)) { log("DRIBL_CLUB_HEADER is not a header name, so nothing was asked of Dribl."); return out; }
  const site_ = (path, opts = {}) => fetchImpl(base + path, {
    ...opts,
    headers: { Accept: "application/json", Authorization: `Bearer ${cronKey}`, ...(opts.headers || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(SITE_TIMEOUT_MS)
  });

  // 1. What to read.
  let res;
  try { res = await site_("/api/dribl"); }
  catch { log("The site could not be reached at SITE_URL."); return out; }
  if (res.status === 401 || res.status === 403) { log(`The site did not accept the key (${res.status}): CRON_SECRET here must be the same as on the site.`); return out; }
  let asked = null;
  try { asked = await res.json(); } catch {}
  if (!res.ok || !asked || !Array.isArray(asked.teams)) { log(`The site did not say what to read (${res.status}).`); return out; }
  const teams = asked.teams.filter((t) => t && typeof t.team === "string" && Array.isArray(t.sources));
  out.teams = teams.length;
  out.draws = teams.reduce((n, t) => n + t.sources.length, 0);
  if (!out.draws) { log("No team has a draw on Dribl set up, so Dribl was not asked anything."); out.ok = true; return out; }
  log(`${out.teams} ${out.teams === 1 ? "team has" : "teams have"} ${out.draws} ${out.draws === 1 ? "draw" : "draws"} on Dribl.${clubKey ? " Sending the club's agreed header." : ""}`);

  // 2 and 3, a team at a time.
  const read = driblFetch(fetchImpl, { clubHeader: header, clubKey });
  for (const [ti, t] of teams.entries()) {
    const draws = [];
    for (const [di, s] of t.sources.entries()) {
      const where = `Team ${ti + 1}, draw ${di + 1}`;
      try {
        const records = await fetchDribl({ url: s.url, team: s.team }, read);
        draws.push({ comp: s.comp, records });
        out.read++;
        log(`${where}: ${records.filter((r) => !r.bye).length} games read.`);
      } catch (e) {
        const f = failureOf(e);
        out.failed.push({ team: ti + 1, draw: di + 1, ...f });
        if (f.kind === "refused") out.refused++;
        log(`${where}: ${says(f)}.`);
      }
    }
    if (!draws.length) continue;
    let posted;
    try { posted = await site_("/api/dribl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: t.team, draws }) }); }
    catch { out.failed.push({ team: ti + 1, kind: "site" }); log(`Team ${ti + 1}: the site could not be reached to save the games.`); continue; }
    let j = null;
    try { j = await posted.json(); } catch {}
    if (!posted.ok || !j?.ok) {
      out.failed.push({ team: ti + 1, kind: "site", status: posted.status });
      log(`Team ${ti + 1}: the site did not save the games (${posted.status}${typeof j?.error === "string" ? `: ${j.error.slice(0, 120)}` : ""}).`);
      continue;
    }
    out.saved++;
    const changes = Array.isArray(j.changes) ? j.changes.length : 0;
    log(`Team ${ti + 1}: saved. ${Number(j.created) || 0} new, ${changes} ${changes === 1 ? "change" : "changes"}.`);
  }

  out.ok = !out.failed.length;
  log(`Done: ${out.read} of ${out.draws} ${out.draws === 1 ? "draw" : "draws"} read${out.failed.length ? `, ${out.failed.length} not` : ""}.`);
  if (out.refused) log("Dribl refused the reader's requests. That is the cue to take it up with Dribl: see \"A scheduled Dribl sync\" in the README.");
  return out;
}
