"use client";
// Team setup wizard for the super admin (/admin). Creates teams live via
// /api/teams — no TEAMS env editing, no restarts. Also lists every team with
// its code + calendar feed, and can edit or remove wizard-created teams
// (editing an env-defined team takes it over into the store).
//
// Direction C: one hairline card in the AdminShell, team rows split by
// hairlines, numbered steps (Anton numerals), switches for on/off choices,
// lucide icons in place of glyphs. Markup only: every request and payload is
// what it was.
import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, RefreshCw, X, Check, ExternalLink } from "lucide-react";
import { parsePlayerImport, mergeImportedStaff, PLAYER_FILE_ACCEPT } from "@/lib/majestri";
import { DEFAULT_FEATURES, FEATURE_LABELS, DEFAULT_PARENTS_SEE, PARENTS_SEE_LABELS, STAFF_ROLES, seasonLabel, KITS } from "@/lib/teamSetup";
import { downscaleImage } from "@/lib/clientImage";
import { MAX_COMPETITIONS, websiteLink, SEASON_NAME_MAX } from "@/lib/competitions";
import { parseFeedLink, feedProvider } from "@/lib/feedLinks";
import { parseMajestriLink, majestriCompUrl } from "@/lib/majestriDraw";
import { readDriblLink } from "@/lib/driblLink";
import { driblStatus } from "@/lib/dribl";
import { AdminSwitch } from "@/components/AdminShell";

const AGE_GROUPS = ["U6", "U7", "U8", "U9", "U10", "U11", "U12+"];
const WORDS_A = ["red", "gold", "swift", "lucky", "mighty", "brave", "flying", "rapid"];
const WORDS_B = ["kanga", "roo", "striker", "keeper", "winger", "boot", "goal", "eagle"];

function friendlyCode() {
  const r = new Uint32Array(3);
  crypto.getRandomValues(r);
  return `${WORDS_A[r[0] % WORDS_A.length]}-${WORDS_B[r[1] % WORDS_B.length]}-${10 + (r[2] % 90)}`;
}
const slugify = (name) => String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const WEEKDAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"]];
// Season window (team.season): weekly training and the calendar only run
// inside it; blank means the team follows the current calendar year.
const BLANK_SEASON = { startISO: "", endISO: "" };
const seasonForEdit = (season) => ({ startISO: season?.startISO || "", endISO: season?.endISO || "" });
const thisYear = new Date().getFullYear();
const SEASON_YEARS = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
// The season's Squadi rows: one feed, or two for one squad that plays as two
// teams each round (each row then needs a label, which names that side on
// every game). Each row can carry its draw's website link. `note` is what
// reading that link found: shown under the field and never sent.
const squadiRow = (s = {}) => ({ label: s.label || "", competitionId: s.competitionId || "", divisionId: s.divisionId || "", teamId: s.teamId || "", link: s.link || "", note: null });
const seasonFeedsForEdit = (squadi) => (Array.isArray(squadi) && squadi.length ? squadi.slice(0, 2).map(squadiRow) : [squadiRow(squadi || {})]);
const rowFilled = (r) => !!(String(r.competitionId).trim() || String(r.divisionId).trim() || String(r.teamId).trim() || String(r.link).trim());
const SIDE_LABEL_MAX = 12;
const BLANK = {
  name: "", ageGroup: "U8", password: "", coachEmails: "",
  strip: "Red", // the kit the team wears: a new team wears the home kit until changed
  division: "", whatsapp: "", season: { ...BLANK_SEASON },
  squadi: [squadiRow()], // the season: one row, or two for a two-team squad
  seasonName: "", // what the club calls the season ("FQ Season"); blank is "Season"
  competitions: [], // every other competition: { id?, name, squadi: { competitionId, divisionId, teamId }, dribl: { url, team }, majestri: { url, team, teamId }, scores, link, note, teams }
  importText: "",
  training: [], // { weekday, time, endTime, location }
  features: { ...DEFAULT_FEATURES },
  parentsSee: { ...DEFAULT_PARENTS_SEE },
  logo: "", hasLogo: false, coachPin: "",
  staff: STAFF_ROLES.map((role) => ({ role, name: "", mobile: "", email: "", custom: false }))
};

// The three Squadi ids of another competition as the form holds them (strings,
// blank when not set).
const squadiForEdit = (s) => ({ competitionId: s?.competitionId || "", divisionId: s?.divisionId || "", teamId: s?.teamId || "" });
const hasSquadiIds = (s) => !!(s.competitionId || s.divisionId || s.teamId);
// A competition whose draw is on Dribl instead: its fixtures request and our
// team's name there, which says which side of each game is ours.
const driblForEdit = (d) => ({ url: d?.url || "", team: d?.team || "" });
// Or on a club's Majestri site: the competition's page, our team's name there
// and Majestri's number for it. The page is the row's link, so there is no box
// for it of its own.
const majestriForEdit = (m) => ({ url: m?.url || "", team: m?.team || "", teamId: m?.teamId ? String(m.teamId) : "" });
// The row's Majestri draw, while its link is still that competition's page.
// A link changed to anything else takes the draw away with it.
const onMajestri = (c) => {
  if (!c.majestri.url) return false;
  const p = parseMajestriLink(c.link.trim());
  return !p.error && majestriCompUrl(p.host, p.compId) === c.majestri.url;
};

// Another competition's row as the form holds it. `note` is what reading its
// link found and `teams` the team names its draw listed, offered in the team
// box; neither is sent. A Majestri draw saved without a link shows its page
// as the link, since that is where it is read from. `scores` is the choice to
// take the competition's scores from its draw (Squadi, Dribl or Majestri): on
// for a competition being added, and as it was saved for one already there.
const competitionRow = (c = {}) => ({
  ...(c.id ? { id: c.id } : {}), name: c.name || "", squadi: squadiForEdit(c.squadi), dribl: driblForEdit(c.dribl), majestri: majestriForEdit(c.majestri),
  scores: c.id ? c.scores === true : true, link: c.link || c.majestri?.url || "", note: null, teams: []
});
// Where a row's scores can come from: the site its draw is on.
const scoresSite = (c) => (onMajestri(c) ? "Majestri" : hasSquadiIds(c.squadi) ? "Squadi" : c.dribl.url.trim() ? "Dribl" : "");

// ---- Setting a draw up from its link ----------------------------------------
// A draw's website link is the address of its page, and when that page is the
// team's fixtures on Squadi or on Dribl, or a competition's page on a club's
// Majestri site, the row can be filled in from it (lib/feedLinks.js). A Squadi
// link is looked up through /api/feed-link for the three ids the sync uses. A
// Majestri link is read there too, for the competition's teams to choose ours
// from (lib/majestriDraw.js). A Dribl link is turned into the competition's
// fixtures request by this browser (lib/driblLink.js), since Dribl turns
// servers away. Whichever it is, what was found is read back under the field
// before anything is saved, and the link itself is kept as the website link.
export const DRIBL_IN_SEASON = "The season's games come from Squadi. For a draw on Dribl or Majestri, use Add a competition below and paste its link there.";
export const LINK_BEING_READ = "A link is still being read. Give it a moment, then save.";
export const DRIBL_BY_HAND = "The link is kept. To sync this draw, its fixtures request can still be pasted in the Dribl box by hand (see the note below).";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// ", 4 with their scores" after a count of games, when some have one.
const withScores = (n) => (n > 0 ? `, ${n} with ${n === 1 ? "its score" : "their scores"}` : "");
// What reading a Squadi link found, said back in a sentence or two.
const squadiFound = (found) => {
  const f = found && typeof found === "object" ? found : {};
  const what = [f.team, f.division, f.competition].filter(Boolean).join(" · ");
  const games = f.games == null ? "The draw could not be read just now, but the link is good. Its games sync by themselves."
    : f.games === 0 ? "No games are published for this team yet. They sync by themselves once they are. If that is not right, check the link is your team's."
    : `${plural(f.games, "game")} found${withScores(f.results)}. They sync by themselves.`;
  return `${what ? what + ". " : ""}${games}`;
};
// What reading a Dribl link found, as the note under the field. The request
// has been filled in whatever this says; the note is about its draw.
export function driblFound({ draw, problem, clubs }) {
  if (!draw) return { kind: "err", text: `The fixtures request is filled in, but Dribl did not give its draw: ${problem}` };
  if (problem) return { kind: "err", text: problem };
  if (!draw.games) return { kind: "warn", text: "The fixtures request is filled in. Dribl lists no games in this draw yet. Once it does, they sync whenever a coach opens the team." };
  const what = [draw.competition, draw.league].filter(Boolean).join(" · ");
  if (!draw.ours) return { kind: "warn", text: `${what ? what + ". " : ""}${plural(draw.games, "game")} found, but the draw does not show which team is yours. Choose it in the team name box above.` };
  const check = driblCheck(draw);
  const logos = driblLogoNote(draw.logos, clubs, draw.shape);
  return {
    kind: check ? "warn" : "ok",
    text: `${[draw.ours, what].filter(Boolean).join(" · ")}. ${plural(draw.ourGames, "game")} found${withScores(draw.ourResults)}. They sync whenever a coach opens the team.${check ? " " + check : ""}${logos ? " " + logos : ""}`
  };
}
// What the draw and Dribl's club list hold of the opposition's logos, for the
// club logo library, in a sentence or two: how many come through, where they
// are when the app does not show logos from there yet, and, when there are
// none, the field names a game had, so a screenshot shows what Dribl sends.
// Never a team, place or person: counts, host names and field names only.
export function driblLogoNote(logos, clubs, shape) {
  const l = logos && typeof logos === "object" ? logos : null;
  const c = clubs && typeof clubs === "object" ? clubs : null;
  const said = [];
  if (l?.teams) {
    if (l.shown) said.push(`Logos for ${l.shown} of the ${plural(l.teams, "team")} it plays come through.`);
    if (l.elsewhere?.length) said.push(`Logos for ${plural(l.withLogo - l.shown, "team")} are on ${l.elsewhere.join(", ")}, which the app does not show logos from yet.`);
    if (!l.withLogo) said.push(`Dribl gives no logos with these games${shape?.fields?.length ? ` (a game there has: ${shape.fields.slice(0, 40).join(", ")})` : ""}.`);
  }
  if (c?.error) said.push(`Dribl's club list could not be read (${String(c.error).replace(/\.+$/, "")}).`);
  else if (c && Number.isInteger(c.count)) {
    said.push(c.count ? `Dribl's club list has ${plural(c.count, "club")}, ${c.shown} with a logo the app can show.` : "Dribl's club list is empty.");
    if (c.elsewhere?.length) said.push(`Its other logos are on ${c.elsewhere.join(", ")}, which the app does not show logos from yet.`);
  }
  return said.join(" ");
}
// Whether Dribl's answer is the shape this app reads its results from: said
// only when it is not, with the names of the fields a game carried, so a
// screenshot of the note shows what to change. Dribl's answer cannot be seen
// from anywhere but a person's own browser, so this is where it is checked.
export function driblCheck(draw) {
  const shape = draw?.shape || {};
  const fields = (shape.fields || []).slice(0, 40).join(", ");
  const words = Object.keys(shape.statuses || {});
  const unread = (draw?.ourFinished || 0) - (draw?.ourResults || 0);
  if (unread > 0) return `Dribl calls ${plural(unread, "game")} of ours finished but gives no score this app can read. A game there has: ${fields}.`;
  if ((draw?.ourPast || 0) > 0 && words.length && words.every((w) => w === "(none)")) return `Dribl gives these games no status this app reads, so no scores are taken from them. A game there has: ${fields}.`;
  const unknown = words.filter((w) => w !== "(none)" && !driblStatus({ status: w }));
  if (unknown.length) return `Dribl uses ${unknown.length === 1 ? "a status" : "statuses"} this app does not know (${unknown.map((w) => `"${w}"`).join(", ")}), and takes no score from ${unknown.length === 1 ? "a game with it" : "games with them"}.`;
  return "";
}
// What reading a Majestri link found, as the note under the field.
export function majestriFound(found) {
  const f = found && typeof found === "object" ? found : {};
  const what = [f.competition, f.division].filter(Boolean).join(" · ");
  const teams = Array.isArray(f.teams) ? f.teams.length : 0;
  if (!f.ours) {
    const games = f.games ? `${plural(f.games, "game")} found for ${plural(teams, "team")}` : `No games are published yet for its ${plural(teams, "team")}`;
    return { kind: "warn", text: `${what ? what + ". " : ""}${games}. Choose yours in the team box above.` };
  }
  return { kind: "ok", text: `${[f.ours, what].filter(Boolean).join(" · ")}. ${f.ourGames
    ? `${plural(f.ourGames, "game")} found${withScores(f.ourResults)}. They sync by themselves.`
    : "No games are published for this team yet. They sync by themselves once they are."}` };
}
// What the scores choice means, said under it.
export const scoresFrom = (site) => `A game's score comes in from ${site} once ${site === "Squadi" ? "the competition confirms the result" : "the result is shown there"}. A score already in the app is never changed.`;
export const SCORES_BY_HAND = "Its scores are entered by hand by the team's coaches.";

// How much text arrived in one change to a box: the length of what is new
// between the part both values start with and the part both end with. Typing
// adds a character or two; a paste, or a link the phone's keyboard offers from
// its clipboard, adds a link's worth. Not every phone tells the page about a
// paste, so a whole link arriving at once is treated as one however it came.
const WHOLE_LINK = 10;
export function arrived(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.length - start - end;
}

// A draw's website link: the page it is on, kept beside its ids. It takes a
// line of its own under the ids, and once what is typed is a web address a
// link at the end of that line opens it in a new tab. When it is a fixtures
// page on Squadi, Dribl or Majestri, Read link fills the row in from it, and what was
// found shows underneath. A link pasted in, or put in whole some other way,
// is read straight away; one typed out waits for Read link or Enter.
function LinkField({ who, value, note, onChange, onRead }) {
  const href = websiteLink(value);
  const busy = note?.kind === "busy";
  const readable = !!feedProvider(value);
  const changed = (e) => {
    const next = e.target.value;
    onChange(next);
    if (arrived(value, next) >= WHOLE_LINK && feedProvider(next.trim())) onRead(next.trim());
  };
  return (
    <div style={{ flex: "1 1 100%", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <input className="adm-inp" style={{ flex: 1, minWidth: 0 }} aria-label={`${who} website link`} inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="Paste the draw's page link (https://…)" value={value} onChange={changed}
          onPaste={(e) => { const pasted = (e.clipboardData?.getData("text") || "").trim(); if (feedProvider(pasted)) { e.preventDefault(); onChange(pasted); onRead(pasted); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && readable) { e.preventDefault(); if (!busy) onRead(value); } }} />
        {href && (
          <a className="adm-link" style={{ flexShrink: 0 }} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${who} website link in a new tab`}>
            Open<ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
        {readable && (
          <button type="button" className="adm-btn soft sm" style={{ flexShrink: 0 }} disabled={busy} aria-label={`Read link for ${who}`} onClick={() => onRead(value)}>{busy ? "Reading…" : "Read link"}</button>
        )}
      </div>
      {note && note.kind !== "busy" && (
        <div className={"adm-msg " + (note.kind === "err" ? "err" : note.kind === "ok" ? "ok" : "warn")} role={note.kind === "err" ? "alert" : "status"} style={{ marginTop: 8 }}>{note.text}</div>
      )}
    </div>
  );
}

// Staff rows: an email on a row gives that person a coach-level login, with the
// row's title shown in the app. On edit we keep EVERY existing row (including
// titles the coach added in the dashboard) so an admin save never drops them or
// wipes their emails, then make sure the three standard slots always show.
// Rows outside STAFF_ROLES are "custom": free-text title, removable.
const staffRow = (s = {}) => ({ role: s.role || "", name: s.name || "", mobile: s.mobile || "", email: s.email || "" });
function staffForEdit(existing) {
  const rows = (Array.isArray(existing) ? existing : []).map((s) => ({ ...staffRow(s), custom: !STAFF_ROLES.includes(s.role) }));
  for (const role of STAFF_ROLES) if (!rows.some((r) => r.role === role)) rows.push({ ...staffRow({ role }), custom: false });
  return rows;
}

// One numbered step of the form. A module-level component (never defined
// inside the wizard's render) so typing in a field doesn't remount it.
function Step({ n, title, optional, lead, children }) {
  return (
    <div className="adm-step">
      <div className="adm-step-h">
        <span className="adm-step-n" aria-hidden="true">{n}</span>
        <h4 className="adm-step-t">{title}</h4>
        {optional && <span className="adm-pill">Optional</span>}
      </div>
      {lead && <div className="adm-note lead">{lead}</div>}
      {children}
    </div>
  );
}

// onTeamsChanged: told after a team is created, edited or removed, so the
// page around the wizard can refresh anything that lists teams.
export default function TeamWizard({ onTeamsChanged }) {
  const [teams, setTeams] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);      // BLANK-shaped draft (null = closed)
  const [editSlug, setEditSlug] = useState(null); // slug being edited, else creating
  const [created, setCreated] = useState(null);   // success panel payload
  const [reveal, setReveal] = useState({});       // slug -> show code
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/teams", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "load failed");
      setTeams((await r.json()).teams);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const copy = (text, tag) => {
    try { navigator.clipboard?.writeText(text); setCopied(tag); setTimeout(() => setCopied(""), 1800); } catch {}
  };
  const feedUrl = (t) => `${window.location.origin}/api/calendar?key=${t.calendarKey}`;

  const openCreate = () => { setCreated(null); setEditSlug(null); setForm({ ...BLANK, squadi: [squadiRow()], season: { ...BLANK_SEASON }, features: { ...DEFAULT_FEATURES }, parentsSee: { ...DEFAULT_PARENTS_SEE }, training: [], competitions: [], password: friendlyCode() }); };
  const openEdit = (t) => {
    setCreated(null); setEditSlug(t.slug);
    setForm({
      name: t.name, ageGroup: t.ageGroup || "U8", password: t.password, strip: t.strip || "",
      coachEmails: (t.coachEmails || []).join(", "),
      division: t.division || "", whatsapp: t.whatsapp || "", season: seasonForEdit(t.season),
      squadi: seasonFeedsForEdit(t.squadi), seasonName: t.seasonName || "",
      competitions: (t.competitions || []).map(competitionRow),
      importText: "", training: [],
      features: { ...DEFAULT_FEATURES, ...(t.features || {}) },
      parentsSee: { ...DEFAULT_PARENTS_SEE, ...(t.parentsSee || {}) },
      logo: "", hasLogo: !!t.hasLogo, coachPin: t.coachPin || "",
      staff: staffForEdit(t.staff)
    });
  };

  // As super admin you're a coach on every team — jump straight into one.
  // Open a team from club admin. This is how the people who run the club
  // reach a team they hold no role on: the team_slug cookie names it, and
  // dropping act_as lets the server pick the strongest role they hold there
  // (rather than a role last worn on some other team).
  const openDashboard = (t) => {
    document.cookie = `team_slug=${encodeURIComponent(t.slug)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
    document.cookie = "act_as=; path=/; max-age=0; samesite=lax";
    window.location.href = "/";
  };
  const rotateKey = async (slug) => {
    if (!window.confirm("Rotate the calendar key? Every existing calendar subscription stops updating until people re-subscribe with the new link.")) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/teams", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, rotateCalendarKey: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "rotate failed");
      await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  // Live parse of the Majestri paste / CSV upload (create flow only).
  const imported = useMemo(
    () => (form && !editSlug && form.importText.trim() ? parsePlayerImport(form.importText) : { isMajestri: false, players: [], staff: [] }),
    [form, editSlug]
  );
  // The file's coach and manager rows against the staff rows under Team
  // identity: who would be added or filled in if they were used. Nothing moves
  // until "Use them as this team's staff" is pressed, and the rows stay
  // editable afterwards.
  const staffFromFile = useMemo(
    () => mergeImportedStaff(form ? form.staff : [], imported.staff),
    [form, imported]
  );
  const staffToUse = staffFromFile.added.length + staffFromFile.updated.length;
  const useFileStaff = () => setForm((f) => ({
    ...f,
    staff: mergeImportedStaff(f.staff, imported.staff).staff.map((s) => ({ ...staffRow(s), custom: s.custom ?? !STAFF_ROLES.includes(s.role) }))
  }));
  const onLogoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const logo = await downscaleImage(file, 256, "image/png"); // same treatment as the dashboard's Settings
      setForm((f) => ({ ...f, logo, hasLogo: true }));
    } catch { setErr("Couldn't read that image — try a PNG or JPG."); }
    e.target.value = "";
  };

  const onCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, importText: String(reader.result || "") }));
    reader.readAsText(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  // Read the website link of a season row or a competition row and fill the
  // row in from it. `list` is the form key the row lives in ("squadi" for the
  // season, "competitions"). The row is found again by its link when the
  // answer comes back, so a row removed or changed in the meantime is left as
  // it is. A link that is not a fixtures page on Squadi, Dribl or Majestri has
  // nothing to read and is simply the website link it was. `team` is the
  // Majestri team just chosen, when this read is to check it.
  const readLink = async (list, i, text, { team: chosen } = {}) => {
    const patch = (fn, only) => setForm((f) => (!f ? f : { ...f, [list]: f[list].map((r, k) => (k === i && (!only || r.link === only) ? fn(r) : r)) }));
    if (!feedProvider(text)) return;
    const parsed = parseFeedLink(text);
    // A page on one of them that does not name a team's draw: said, and kept.
    if (parsed.error) { patch((r) => ({ ...r, note: { kind: "warn", text: parsed.error } })); return; }
    if (parsed.provider !== "squadi" && list === "squadi") { patch((r) => ({ ...r, link: parsed.link, note: { kind: "warn", text: DRIBL_IN_SEASON } })); return; }
    // A Majestri page is read for the team the row already has, so the answer
    // can say whether it is in this competition. An answer for a team since
    // changed in the box is left to the read for the new one.
    const team = parsed.provider === "majestri" ? String(chosen ?? form?.competitions?.[i]?.majestri?.team ?? "").trim() : "";
    const current = (r) => parsed.provider !== "majestri" || r.majestri.team.trim() === team;
    patch((r) => ({ ...r, link: parsed.link, note: { kind: "busy" } }));
    try {
      if (parsed.provider === "dribl") {
        const got = await readDriblLink(parsed.link, { team: form?.competitions?.[i]?.dribl?.team || "" });
        // One source to a row: the Dribl request takes the place of any Squadi ids.
        patch((r) => ({
          ...r, squadi: squadiForEdit(), dribl: { url: got.url, team: r.dribl.team }, majestri: majestriForEdit(), teams: got.draw?.teams || [], note: driblFound(got),
          name: r.name.trim() ? r.name : String(got.draw?.competition || "").slice(0, 40)
        }), parsed.link);
        return;
      }
      const res = await fetch("/api/feed-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: parsed.link, ...(team ? { team } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (parsed.provider === "majestri") {
        if (!res.ok || !j.majestri) throw new Error(j.error || "Couldn't read that link. Try again.");
        // The competition's page takes the place of any other source on the
        // row. Our team is the one Majestri found, or none: a name that is not
        // one of its teams is cleared, so it is chosen again from them.
        patch((r) => (!current(r) ? r : {
          ...r, squadi: squadiForEdit(), dribl: driblForEdit(), majestri: majestriForEdit(j.majestri),
          teams: Array.isArray(j.found?.teams) ? j.found.teams : [], note: majestriFound(j.found),
          name: r.name.trim() ? r.name : String(j.found?.competition || "").slice(0, 40)
        }), parsed.link);
        return;
      }
      if (!res.ok || !j.squadi) throw new Error(j.error || "Couldn't read that link. Try again.");
      const ids = { competitionId: String(j.squadi.competitionId), divisionId: String(j.squadi.divisionId), teamId: String(j.squadi.teamId) };
      const note = { kind: "ok", text: squadiFound(j.found) };
      patch((r) => (list === "squadi"
        ? { ...r, ...ids, note }
        // The Squadi ids take the place of any other source, and a competition
        // with no name yet takes Squadi's name for it, which can be changed.
        : { ...r, squadi: ids, dribl: driblForEdit(), majestri: majestriForEdit(), teams: [], note, name: r.name.trim() ? r.name : String(j.found?.competition || "").slice(0, 40) }), parsed.link);
    } catch (e) {
      const said = String(e?.message || e);
      patch((r) => (!current(r) ? r : { ...r, note: { kind: "err", text: parsed.provider === "dribl" ? `${said} ${DRIBL_BY_HAND}` : said } }), parsed.link);
    }
  };

  const submit = async () => {
    // A link still being read has filled nothing in yet: saving now would keep
    // the link and none of what it is about to find.
    if ([...form.squadi, ...form.competitions].some((r) => r.note?.kind === "busy")) { setErr(LINK_BEING_READ); return; }
    // One filled row is sent as the single feed it always was; two filled
    // rows as the labelled pair. A label on a lone row is not sent.
    const rows = form.squadi.filter(rowFilled);
    if (rows.length === 2) {
      const labels = rows.map((r) => r.label.trim());
      const bad = labels.some((l) => !l) ? "Give each Squadi team a label, like McKay and McKain."
        : labels[0].toLowerCase() === labels[1].toLowerCase() ? "The two Squadi team labels must be different."
        : "";
      if (bad) { setErr(bad); return; }
    }
    setBusy(true); setErr("");
    const linkOf = (r) => (r.link.trim() ? { link: r.link.trim() } : {});
    const idsOf = ({ competitionId, divisionId, teamId }) => ({ competitionId, divisionId, teamId });
    const squadi = rows.length === 2 ? rows.map((r) => ({ label: r.label.trim(), ...idsOf(r), ...linkOf(r) })) : rows.length === 1 ? { ...idsOf(rows[0]), ...linkOf(rows[0]) } : null;
    // A row nobody filled in is not sent. A named row with no ids is: the
    // competition is kept and synced once its ids are added.
    const competitions = form.competitions
      .filter((c) => c.name.trim() || hasSquadiIds(c.squadi) || c.dribl.url.trim() || c.link.trim())
      .map((c) => ({
        ...(c.id ? { id: c.id } : {}), name: c.name.trim(),
        ...(hasSquadiIds(c.squadi) ? { squadi: c.squadi } : {}),
        ...(c.dribl.url.trim() ? { dribl: { url: c.dribl.url.trim(), team: c.dribl.team.trim() } } : {}),
        // A Majestri row with no team chosen is sent as it is, and the server says what is missing.
        ...(onMajestri(c) ? { majestri: { url: c.majestri.url, team: c.majestri.team.trim(), ...(c.majestri.teamId ? { teamId: c.majestri.teamId } : {}) } } : {}),
        ...(c.scores && scoresSite(c) ? { scores: true } : {}),
        ...linkOf(c)
      }));
    const season = form.season.startISO || form.season.endISO ? { startISO: form.season.startISO, endISO: form.season.endISO } : null;
    const payload = {
      name: form.name, ageGroup: form.ageGroup, password: form.password.trim(),
      // On an edit the season is always sent, so emptying its rows removes it.
      coachEmails: form.coachEmails, ...(squadi ? { squadi } : editSlug ? { squadi: {} } : {}),
      // Always sent, so emptying the name makes the season "Season" again.
      seasonName: form.seasonName.trim(),
      // On an edit the list is always sent, so removing a row removes it.
      ...(editSlug || competitions.length ? { competitions } : {}),
      division: form.division, whatsapp: form.whatsapp, season, features: form.features, parentsSee: form.parentsSee,
      strip: form.strip, // always sent: "" leaves a team that has none without one
      staff: form.staff.filter((s) => s.name.trim()).map(({ role, name, mobile, email }) => ({ role, name, mobile, email })),
      coachPin: form.coachPin,
      ...(form.logo ? { logo: form.logo } : {}), // only when a new file was chosen
      ...(!editSlug && imported.players.length ? { players: imported.players } : {}),
      ...(!editSlug && form.training.length ? { training: form.training.map((t) => ({ ...t, weekday: Number(t.weekday) })) } : {}),
      ...(editSlug ? { slug: editSlug } : {})
    };
    try {
      const r = await fetch("/api/teams", {
        method: editSlug ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save failed");
      await load();
      onTeamsChanged?.();
      if (!editSlug) setCreated({ ...j.team, playersImported: j.playersImported || 0, trainingSeeded: j.trainingSeeded || 0 });
      setForm(null); setEditSlug(null);
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const remove = async (slug) => {
    if (!window.confirm(`Remove team "${slug}"?`)) return;
    const purgeData = window.confirm(`Also wipe its stored data (players, fixtures, replies, duties)?\n\nOK: wipe it, so re-adding "${slug}" starts fresh.\nCancel: keep it, so re-adding "${slug}" restores it.`);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/teams", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, purgeData }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "delete failed");
      await load();
      onTeamsChanged?.();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  // Where a team came from: made here (editable, removable) or defined in the
  // TEAMS environment variable.
  const srcPill = (t) => t.source === "stored"
    ? <span className="adm-pill ok">Created here</span>
    : <span className="adm-pill">Set in the environment</span>;

  // Steps number themselves, so the create flow (11 steps) and the edit flow
  // (9: no player import, no training seed) both read 1, 2, 3 with no gaps.
  let stepNo = 0;
  const editing = editSlug ? (teams || []).find((t) => t.slug === editSlug) : null;

  return (
    <section className="adm-card" aria-labelledby="adm-teams">
      <h2 className="adm-label" id="adm-teams">Teams</h2>
      {err && <div className="adm-msg err" role="alert" style={{ marginTop: 10 }}>{err}</div>}

      {created && (
        <div className="adm-msg ok" role="status" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, fontWeight: 800 }}><Check size={16} aria-hidden="true" />{created.name} is live</div>
          <div className="plain" style={{ marginTop: 8 }}>
            Team code: <b className="adm-mono" style={{ fontSize: 15 }}>{created.password}</b>{" "}
            <button className="adm-link" onClick={() => copy(created.password, "newcode")}>{copied === "newcode" ? "Copied" : "Copy"}</button>
          </div>
          <div className="adm-note" style={{ marginTop: 6 }}>
            {created.playersImported > 0 && <b>{created.playersImported} player{created.playersImported > 1 ? "s" : ""} imported with parent details. </b>}
            {created.trainingSeeded > 0 && <b>{created.trainingSeeded} weekly training session{created.trainingSeeded > 1 ? "s" : ""} added to the calendar. </b>}
            Share the code with the team. Parents log in with it at {typeof window !== "undefined" ? window.location.origin : ""}, and the calendar subscribe link is on their Calendar tab.
          </div>
          <button className="adm-btn soft sm" style={{ marginTop: 10 }} onClick={() => setCreated(null)}>Done</button>
        </div>
      )}

      {!teams ? (
        <div className="adm-empty">Loading…</div>
      ) : (
        <>
          {teams.map((t) => (
            <div key={t.slug} className="adm-team">
              <div className="adm-team-top">
                <span className="adm-team-name">{t.name}</span>
                {t.ageGroup && <span className="adm-pill">{t.ageGroup}</span>}
                {t.season && <span className="adm-pill">{seasonLabel(t.season)}</span>}
                {srcPill(t)}
              </div>
              <div className="adm-team-meta">
                <span>Slug <b>{t.slug}</b></span>
                <span>
                  Code <b>{reveal[t.slug] ? t.password : "••••••"}</b>{" "}
                  <button className="adm-link" aria-label={`${reveal[t.slug] ? "Hide" : "Show"} the team code for ${t.name}`}
                    onClick={() => setReveal((r) => ({ ...r, [t.slug]: !r[t.slug] }))}>{reveal[t.slug] ? "Hide" : "Show"}</button>{" "}
                  <button className="adm-link" aria-label={`Copy the team code for ${t.name}`}
                    onClick={() => copy(t.password, "code" + t.slug)}>{copied === "code" + t.slug ? "Copied" : "Copy"}</button>
                </span>
                {(t.coachEmails || []).length > 0 && <span>Coaches: {t.coachEmails.join(", ")}</span>}
              </div>
              <div className="adm-team-acts">
                <button className="adm-btn sm" aria-label={`Open ${t.name}`} onClick={() => openDashboard(t)}>Open</button>
                <button className="adm-btn soft sm" aria-label={`Edit ${t.name}`} onClick={() => openEdit(t)}>Edit</button>
                {t.calendarKey && (
                  <button className="adm-btn soft sm" aria-label={`Copy the calendar link for ${t.name}`}
                    onClick={() => copy(feedUrl(t), "cal" + t.slug)}>{copied === "cal" + t.slug ? "Calendar link copied" : "Copy calendar link"}</button>
                )}
                {t.source === "stored" && (
                  <button disabled={busy} className="adm-btn danger sm" aria-label={`Remove ${t.name}`} onClick={() => remove(t.slug)}>Remove</button>
                )}
              </div>
            </div>
          ))}
          {teams.length === 0 && <div className="adm-empty">No teams yet. Add the first one below.</div>}
        </>
      )}

      {!form ? (
        <button className="adm-btn" style={{ marginTop: 14 }} onClick={openCreate}><Plus size={16} aria-hidden="true" />Add a team</button>
      ) : (
        <div className="adm-wizard">
          <h3 className="adm-wizard-title">{editSlug ? `Edit ${editing?.name || editSlug}` : "New team"}</h3>

          <Step n={++stepNo} title="Team name">
            <input className="adm-inp" aria-label="Team name" placeholder="Olympic FC U9 Wallabies Blue" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            {!editSlug && form.name && <div className="adm-note">Slug (permanent): <b className="adm-mono">{slugify(form.name) || "not set"}</b></div>}
            <div className="adm-line">
              <input className="adm-inp" style={{ flex: "1 1 180px" }} aria-label="Division label" placeholder="Division label (e.g. Kangaroos K1 Central Hub)" value={form.division}
                onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))} />
              <input className="adm-inp" style={{ flex: "1 1 180px" }} aria-label="WhatsApp group link" placeholder="WhatsApp group link (optional)" value={form.whatsapp}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} />
            </div>
          </Step>

          <Step n={++stepNo} title="Age group">
            <div className="adm-chips">
              {AGE_GROUPS.map((a) => (
                <button key={a} type="button" aria-pressed={form.ageGroup === a} className={"adm-chip" + (form.ageGroup === a ? " on" : "")}
                  onClick={() => setForm((f) => ({ ...f, ageGroup: a }))}>
                  {a}
                </button>
              ))}
            </div>
            <div className="adm-note">Sets the default match format, for example U8 and U9 play 7-a-side, 2 × 20 minutes.</div>
          </Step>

          <Step n={++stepNo} title="Playing kit">
            <div className="adm-chips" role="group" aria-label="Playing kit">
              {KITS.map((k) => (
                <button key={k.strip} type="button" aria-pressed={form.strip === k.strip} className={"adm-chip" + (form.strip === k.strip ? " on" : "")}
                  onClick={() => setForm((f) => ({ ...f, strip: k.strip }))}>
                  {k.side} kit ({k.colour})
                </button>
              ))}
            </div>
            <div className="adm-note">The kit this team wears. A coach can switch any one game to the other kit on its Edit sheet, for a colour clash.</div>
          </Step>

          <Step n={++stepNo} title="Team code" lead="What everyone types to log in.">
            <div className="adm-line" style={{ marginTop: 0 }}>
              <input className="adm-inp adm-mono" style={{ flex: 1, minWidth: 0 }} aria-label="Team code" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              <button type="button" className="adm-btn soft" onClick={() => setForm((f) => ({ ...f, password: friendlyCode() }))}><RefreshCw size={15} aria-hidden="true" />New code</button>
            </div>
            <div className="adm-note">Must be unique across teams: the code picks the team at login. The calendar key is generated automatically.</div>
            {editSlug && (<>
              <button type="button" disabled={busy} className="adm-btn soft sm" style={{ marginTop: 8 }} onClick={() => rotateKey(editSlug)}>
                <RefreshCw size={13} aria-hidden="true" />Rotate calendar key
              </button>
              <div className="adm-note">Use this if the subscribe link has leaked. Everyone re-subscribes with the new link.</div>
            </>)}
          </Step>

          <Step n={++stepNo} title="Extra coach logins" optional>
            <input className="adm-inp" aria-label="Extra coach emails" placeholder="coach@example.com, another@example.com" value={form.coachEmails}
              onChange={(e) => setForm((f) => ({ ...f, coachEmails: e.target.value }))} />
            <div className="adm-note">
              Emails here get coach-level access. Anyone on the staff list under Team identity with an email
              gets it too, with their title shown in the app.
            </div>
          </Step>

          <Step n={++stepNo} title="Competitions" optional lead="Where this team's games come from. Fill in each draw when it is published and leave the rest until then.">
            <div className="adm-fl">Season</div>
            <input className="adm-inp" style={{ width: "100%" }} aria-label="Season name" placeholder="Name (e.g. FQ Season)" maxLength={SEASON_NAME_MAX}
              value={form.seasonName} onChange={(e) => setForm((f) => ({ ...f, seasonName: e.target.value }))} />
            {form.squadi.map((row, i) => {
              const two = form.squadi.length === 2;
              const who = i === 0 ? "Squadi" : "Second Squadi";
              // Typing in a row puts away what its link was last read as.
              const patchRow = (patch) => setForm((f) => ({ ...f, squadi: f.squadi.map((r, k) => (k === i ? { ...r, ...patch, note: null } : r)) }));
              const set = (key) => (e) => patchRow({ [key]: e.target.value });
              return (
                <div key={i} className="adm-line">
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} team label`} placeholder={two ? "Label (e.g. McKay)" : "Label (for two teams)"}
                    maxLength={SIDE_LABEL_MAX} required={two} aria-required={two} value={row.label} onChange={set("label")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} competition ID`} placeholder="competitionId" value={row.competitionId} onChange={set("competitionId")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} division ID`} placeholder="divisionId" value={row.divisionId} onChange={set("divisionId")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} team ID`} placeholder="teamId" value={row.teamId} onChange={set("teamId")} />
                  <LinkField who={who} value={row.link} note={row.note} onChange={(link) => patchRow({ link })} onRead={(text) => readLink("squadi", i, text)} />
                  {i === 1 && (
                    <button type="button" className="adm-link" onClick={() => setForm((f) => ({ ...f, squadi: f.squadi.slice(0, 1) }))}>Remove the second team</button>
                  )}
                </div>
              );
            })}
            {form.squadi.length === 1
              ? <button type="button" className="adm-link" style={{ marginTop: 6 }} onClick={() => setForm((f) => ({ ...f, squadi: [...f.squadi, squadiRow()] }))}>Add a second team</button>
              : <div className="adm-note">Two rows make one squad that plays as two teams each round, like McKay and McKain.</div>}
            {form.competitions.map((c, i) => {
              const set = (patch) => setForm((f) => ({ ...f, competitions: f.competitions.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
              // Typing a source in by hand puts away what the link was last read as.
              const setId = (key, value) => set({ squadi: { ...c.squadi, [key]: value }, note: null });
              const teamList = `adm-dribl-teams-${i}`;
              // The page link and the request are easy to mix up: a whole
              // fixtures page link put in the request box is moved to the
              // link box and read there, which fills the request in.
              const isPageLink = (text) => parseFeedLink(text).provider === "dribl";
              const moveToLink = (text) => { set({ link: text, note: null }); readLink("competitions", i, text); };
              // A Majestri team chosen from the page's names is checked against
              // the page straight away, which also finds Majestri's number for it.
              const pickMajestriTeam = (name) => {
                set({ majestri: { ...c.majestri, team: name, teamId: "" }, note: null });
                if (name) readLink("competitions", i, c.link, { team: name });
              };
              // Until the page has been read there are no names to choose from, and the team saved is typed.
              const site = scoresSite(c);
              const majestriTeams = !c.teams.length ? [] : c.majestri.team && !c.teams.includes(c.majestri.team) ? [c.majestri.team, ...c.teams] : c.teams;
              const who = c.name.trim() || `Competition ${i + 1}`;
              return (
                <div key={i} className="adm-comp">
                  <div className="adm-fl">Competition</div>
                  <div className="top">
                    <input className="adm-inp" style={{ flex: 1, minWidth: 0 }} aria-label={`Competition ${i + 1} name`} placeholder="Name (e.g. Winterfest)" value={c.name}
                      onChange={(e) => set({ name: e.target.value })} />
                    <button type="button" className="adm-iconbtn" aria-label={`Remove ${who}`}
                      onClick={() => setForm((f) => ({ ...f, competitions: f.competitions.filter((_, k) => k !== i) }))}><X size={16} aria-hidden="true" /></button>
                  </div>
                  <div className="adm-line">
                    <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} competition ID`} placeholder="competitionId" value={c.squadi.competitionId}
                      onChange={(e) => setId("competitionId", e.target.value)} />
                    <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} division ID`} placeholder="divisionId" value={c.squadi.divisionId}
                      onChange={(e) => setId("divisionId", e.target.value)} />
                    <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} team ID`} placeholder="teamId" value={c.squadi.teamId}
                      onChange={(e) => setId("teamId", e.target.value)} />
                  </div>
                  <div className="adm-line">
                    <input className="adm-inp" style={{ flex: "1 1 100%" }} aria-label={`${who} Dribl fixtures request`} inputMode="url" autoComplete="off" spellCheck={false}
                      placeholder="Or, for a draw on Dribl, its fixtures request (https://mc-api.dribl.com/api/fixtures?…)" value={c.dribl.url}
                      onPaste={(e) => { const pasted = (e.clipboardData?.getData("text") || "").trim(); if (isPageLink(pasted)) { e.preventDefault(); moveToLink(pasted); } }}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (arrived(c.dribl.url, next) >= WHOLE_LINK && isPageLink(next.trim())) { moveToLink(next.trim()); return; }
                        set({ dribl: { ...c.dribl, url: next }, note: null, teams: [] });
                      }} />
                    {c.dribl.url.trim() && (<>
                      {/* The teams the draw listed when its link was read are offered as they are spelt there. */}
                      <input className="adm-inp" style={{ flex: "1 1 100%" }} aria-label={`${who} team name on Dribl`} placeholder="Your team's name as Dribl shows it"
                        list={c.teams.length ? teamList : undefined} autoComplete="off"
                        value={c.dribl.team} onChange={(e) => set({ dribl: { ...c.dribl, team: e.target.value }, note: null })} />
                      {c.teams.length > 0 && <datalist id={teamList}>{c.teams.map((name) => <option key={name} value={name} />)}</datalist>}
                    </>)}
                  </div>
                  {onMajestri(c) && (
                    <div className="adm-line">
                      {/* Majestri lists every team in the competition, so ours is chosen from them once the link is read. */}
                      {majestriTeams.length ? (
                        <select className="adm-inp" style={{ flex: "1 1 100%" }} aria-label={`${who} team on Majestri`} value={c.majestri.team} onChange={(e) => pickMajestriTeam(e.target.value)}>
                          <option value="">Choose your team</option>
                          {majestriTeams.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      ) : (
                        <input className="adm-inp" style={{ flex: "1 1 100%" }} aria-label={`${who} team on Majestri`} placeholder="Your team's name as Majestri shows it" autoComplete="off"
                          value={c.majestri.team} onChange={(e) => set({ majestri: { ...c.majestri, team: e.target.value, teamId: "" }, note: null })} />
                      )}
                    </div>
                  )}
                  {site && (
                    <div style={{ marginTop: 8 }}>
                      <div className="adm-swrow">
                        <span>Scores from {site}</span>
                        <AdminSwitch on={c.scores} label={`Scores for ${who} from ${site}`} onClick={() => set({ scores: !c.scores })} />
                      </div>
                      <div className="adm-note">{c.scores ? scoresFrom(site) : SCORES_BY_HAND}</div>
                    </div>
                  )}
                  <div className="adm-line">
                    <LinkField who={who} value={c.link} note={c.note} onChange={(link) => set({ link, note: null })} onRead={(text) => readLink("competitions", i, text)} />
                  </div>
                </div>
              );
            })}
            {form.competitions.length < MAX_COMPETITIONS && (
              <button type="button" className="adm-btn soft sm" style={{ marginTop: 8 }}
                onClick={() => setForm((f) => ({ ...f, competitions: [...f.competitions, competitionRow()] }))}>
                <Plus size={14} aria-hidden="true" />Add a competition
              </button>
            )}
            <div className="adm-note">
              The quickest way to fill a draw in is its link. Open your team's fixtures page on Squadi or Dribl, or the
              competition's page on Majestri, copy its address and paste it into the row's link box: a Squadi link fills in the
              three IDs, a Dribl link fills in the Dribl fixtures request, and a Majestri link lists the competition's teams for
              you to choose yours. What it found is shown under the box before you save.
            </div>
            <div className="adm-note">
              Give the season and each competition the name the club knows it by, such as FQ Season, Winterfest or Summer Fives:
              a competition's games are labelled with it, and a name a link fills in can be typed over. Add a competition for
              anything played alongside the season, such as a winter tournament. One with no IDs yet is
              kept, and synced once you add them with Edit. Its games are labelled with its name and kept out of the season
              record. A draw on Squadi or Majestri syncs for everyone; a draw on Dribl is kept in step whenever a coach opens
              the team. The season's scores are entered by hand. Any other competition can take its scores from its draw
              instead (Scores from, under its draw): a score comes in once the result is final, fills a game with no score yet,
              and never changes a score already in the app.
            </div>
            <div className="adm-note">
              Everything a link fills in can also be typed by hand. Squadi IDs come from the FQ widget via DevTools (see the
              README). A Dribl fixtures request is the address of the request that starts with
              https://mc-api.dribl.com/api/fixtures, in DevTools under Network on the competition's Dribl fixtures page; add your
              team's name as Dribl shows it when the draw has more than one of your club's teams.
            </div>
            <div className="adm-note">
              The link is kept with its draw and shown on the team's league page, so families can open the draw. A link to
              any other site can go here too: it is kept and nothing is read from it.
            </div>
          </Step>

          {!editSlug && (
            <Step n={++stepNo} title="Players and parents" optional
              lead={<>Upload the Majestri CSV export, or paste it (from the file or straight out of Excel). Parents' names,
                emails and mobiles come across, which is what powers parent login and replies. Full names show in the squad
                list. Coach and manager rows can fill in the staff below. A simple list works too:{" "}
                <i>Name, number, position, parent, mobile, dd/mm/yyyy</i>.</>}>
              <label className="adm-btn soft sm">
                Upload CSV
                <input type="file" accept={PLAYER_FILE_ACCEPT} className="adm-file" onChange={onCsvFile} />
              </label>
              <textarea
                className="adm-inp" style={{ marginTop: 8 }} aria-label="Player import"
                placeholder={"Or paste the export here\nSpencer, 6, MID, Damien, 0400 000 000, 12/03/2018"}
                value={form.importText}
                onChange={(e) => setForm((f) => ({ ...f, importText: e.target.value }))}
              />
              {form.importText.trim() && (
                <div className="adm-note" role="status">
                  {imported.isMajestri && <b style={{ color: "var(--green-strong)" }}>Majestri export detected. </b>}
                  {imported.players.length > 0 ? (
                    <>
                      <b style={{ color: "var(--green-strong)" }}>{imported.players.length} player{imported.players.length > 1 ? "s" : ""} ready:</b>{" "}
                      {imported.players.slice(0, 8).map((p) => p.name).join(", ")}{imported.players.length > 8 ? "…" : ""}
                      {" · "}{imported.players.filter((p) => (p.parentEmails || []).length).length} with parent emails
                    </>
                  ) : imported.staff.length === 0 ? (
                    <b style={{ color: "var(--red-strong)" }}>Nothing readable yet. Check the format.</b>
                  ) : null}
                </div>
              )}
              {imported.staff.length > 0 && (
                <div className="adm-note" role="group" aria-label="Staff in this file">
                  <b>{imported.staff.length} {imported.staff.length === 1 ? "staff member" : "staff"} in this file:</b>{" "}
                  {imported.staff.map((s) => `${s.name} (${s.role})`).join(", ")}.{" "}
                  {staffToUse > 0
                    ? <>They are not on the staff list yet.</>
                    : <>Already in the staff list under Team identity.</>}
                  {staffToUse > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button type="button" className="adm-btn soft sm" onClick={useFileStaff}>Use them as this team's staff</button>
                    </div>
                  )}
                </div>
              )}
            </Step>
          )}

          <Step n={++stepNo} title="Season" optional lead="When the team is active.">
            <div className="adm-chips">
              {SEASON_YEARS.map((yr) => {
                const on = form.season.startISO === `${yr}-01-01` && form.season.endISO === `${yr}-12-31`;
                return (
                  <button key={yr} type="button" aria-pressed={on} className={"adm-chip" + (on ? " on" : "")}
                    onClick={() => setForm((f) => ({ ...f, season: { startISO: `${yr}-01-01`, endISO: `${yr}-12-31` } }))}>
                    {yr}
                  </button>
                );
              })}
            </div>
            <div className="adm-grid2" style={{ marginTop: 10 }}>
              <div>
                <label className="adm-fl" htmlFor="tw-season-start">Season starts</label>
                <input id="tw-season-start" type="date" className="adm-inp" value={form.season.startISO}
                  onChange={(e) => setForm((f) => ({ ...f, season: { ...f.season, startISO: e.target.value } }))} />
              </div>
              <div>
                <label className="adm-fl" htmlFor="tw-season-end">Season finishes</label>
                <input id="tw-season-end" type="date" className="adm-inp" value={form.season.endISO}
                  onChange={(e) => setForm((f) => ({ ...f, season: { ...f.season, endISO: e.target.value } }))} />
              </div>
            </div>
            {(form.season.startISO || form.season.endISO) && (
              <button type="button" className="adm-link" style={{ marginTop: 6 }} onClick={() => setForm((f) => ({ ...f, season: { ...BLANK_SEASON } }))}>Clear the season</button>
            )}
            <div className="adm-note">Weekly training and the calendar only run inside this window. Leave blank to follow the current calendar year.</div>
          </Step>

          {!editSlug && (
            <Step n={++stepNo} title="Weekly training" optional
              lead="These become recurring sessions on the team calendar, and flow into every parent's subscribed calendar automatically, exactly like Squadi-synced games.">
              {form.training.map((row, i) => {
                const setRow = (patch) => setForm((f) => ({ ...f, training: f.training.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
                return (
                  <div key={i} className="adm-train">
                    <select className="adm-inp" aria-label={`Training day ${i + 1}`} value={row.weekday} onChange={(e) => setRow({ weekday: e.target.value })}>
                      {WEEKDAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input className="adm-inp" aria-label={`Training ${i + 1} location`} placeholder="Location" value={row.location}
                      onChange={(e) => setRow({ location: e.target.value })} />
                    <button type="button" className="adm-iconbtn" aria-label={`Remove training day ${i + 1}`}
                      onClick={() => setForm((f) => ({ ...f, training: f.training.filter((_, k) => k !== i) }))}><X size={16} aria-hidden="true" /></button>
                    <div className="times">
                      <input type="time" className="adm-inp adm-mono" aria-label={`Training ${i + 1} starts`} value={row.time} onChange={(e) => setRow({ time: e.target.value })} />
                      <span className="adm-note">to</span>
                      <input type="time" className="adm-inp adm-mono" aria-label={`Training ${i + 1} finishes`} value={row.endTime} onChange={(e) => setRow({ endTime: e.target.value })} />
                    </div>
                  </div>
                );
              })}
              <button type="button" className="adm-btn soft sm" style={{ marginTop: 8 }}
                onClick={() => setForm((f) => ({ ...f, training: [...f.training, { weekday: "2", time: "17:00", endTime: "18:00", location: "" }] }))}>
                <Plus size={14} aria-hidden="true" />Add training day
              </button>
            </Step>
          )}

          <Step n={++stepNo} title="Features" lead="What this team uses. Turn off anything that isn't relevant and the dashboard hides it for everyone on this team.">
            <div>
              {Object.keys(DEFAULT_FEATURES).map((k) => {
                const on = !!form.features[k];
                return (
                  <div key={k} className="adm-swrow">
                    <span>{FEATURE_LABELS[k]}</span>
                    <AdminSwitch on={on} label={FEATURE_LABELS[k]} onClick={() => setForm((f) => ({ ...f, features: { ...f.features, [k]: !on } }))} />
                  </div>
                );
              })}
            </div>
          </Step>

          <Step n={++stepNo} title="Parents can see" lead="What parents see of match day.">
            <div>
              {Object.keys(DEFAULT_PARENTS_SEE).map((k) => {
                const on = !!form.parentsSee[k];
                return (
                  <div key={k} className="adm-swrow">
                    <span>{PARENTS_SEE_LABELS[k]}</span>
                    <AdminSwitch on={on} label={PARENTS_SEE_LABELS[k]} onClick={() => setForm((f) => ({ ...f, parentsSee: { ...f.parentsSee, [k]: !on } }))} />
                  </div>
                );
              })}
            </div>
            <div className="adm-note">Coaches can change this any time in Team settings.</div>
          </Step>

          <Step n={++stepNo} title="Team identity" optional lead="Logo, staff and the coach PIN.">
            <div className="adm-line" style={{ marginTop: 0 }}>
              {form.logo
                ? <img src={form.logo} alt="" className="adm-logo" />
                : form.hasLogo
                ? <span className="adm-pill ok lg"><Check size={12} aria-hidden="true" />Logo set</span>
                : null}
              <label className="adm-btn soft sm">
                {form.logo || form.hasLogo ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/*" className="adm-file" onChange={onLogoFile} />
              </label>
              <span className="adm-note">Shown on the header, login and calendar.</span>
            </div>
            <div className="adm-note" style={{ marginTop: 10 }}>
              Staff with an email get coach-level login, with their title shown in the app. Mobile is optional. Add
              anyone else on the bench with their own title.
            </div>
            {form.staff.map((s, i) => {
              const set = (patch) => setForm((f) => ({ ...f, staff: f.staff.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
              const who = s.role || `Staff member ${i + 1}`;
              return (
                <div key={i} className="adm-staff">
                  <div className="top">
                    {s.custom
                      ? <input className="adm-inp" style={{ flex: "1 1 0", minWidth: 0 }} aria-label={`Title for staff member ${i + 1}`} placeholder="Title (e.g. Goalkeeper coach)" value={s.role}
                          onChange={(e) => set({ role: e.target.value })} />
                      : <span className="w110">{s.role}</span>}
                    <input className="adm-inp" style={{ flex: "1.4 1 0", minWidth: 0 }} aria-label={`${who} name`} placeholder="Name" value={s.name}
                      onChange={(e) => set({ name: e.target.value })} />
                    {s.custom && (
                      <button type="button" className="adm-iconbtn" aria-label="Remove staff member"
                        onClick={() => setForm((f) => ({ ...f, staff: f.staff.filter((_, k) => k !== i) }))}><X size={16} aria-hidden="true" /></button>
                    )}
                  </div>
                  <div className="more">
                    <input className="adm-inp adm-mono" aria-label={`${who} mobile`} placeholder="Mobile" inputMode="tel" value={s.mobile}
                      onChange={(e) => set({ mobile: e.target.value })} />
                    <input type="email" className="adm-inp" aria-label={`${who} email`} placeholder="Email" inputMode="email" autoComplete="off" value={s.email}
                      onChange={(e) => set({ email: e.target.value })} />
                  </div>
                </div>
              );
            })}
            <button type="button" className="adm-btn soft sm" style={{ marginTop: 8 }}
              onClick={() => setForm((f) => ({ ...f, staff: [...f.staff, { role: "", name: "", mobile: "", email: "", custom: true }] }))}>
              <Plus size={14} aria-hidden="true" />Add staff member
            </button>
            <div className="adm-line">
              <span className="w110">Coach PIN</span>
              <input className="adm-inp adm-mono" style={{ width: 120 }} aria-label="Coach PIN" inputMode="numeric" placeholder="e.g. 2468" value={form.coachPin}
                onChange={(e) => setForm((f) => ({ ...f, coachPin: e.target.value }))} />
              <span className="adm-note">In team-code mode, hides the edit controls behind this PIN.</span>
            </div>
          </Step>

          <div className="adm-actions">
            <button disabled={busy || !form.name.trim() || form.password.trim().length < 4} className="adm-btn" onClick={submit}>
              {busy ? "Saving…" : editSlug ? "Save changes" : "Create team"}
            </button>
            <button type="button" className="adm-btn soft" onClick={() => { setForm(null); setEditSlug(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
