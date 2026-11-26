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
import { Plus, RefreshCw, X, Check } from "lucide-react";
import { parsePlayerImport, mergeImportedStaff, PLAYER_FILE_ACCEPT } from "@/lib/majestri";
import { DEFAULT_FEATURES, FEATURE_LABELS, DEFAULT_PARENTS_SEE, PARENTS_SEE_LABELS, STAFF_ROLES, seasonLabel } from "@/lib/teamSetup";
import { downscaleImage } from "@/lib/clientImage";
import { MAX_COMPETITIONS } from "@/lib/competitions";
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
// every game).
const squadiRow = (s = {}) => ({ label: s.label || "", competitionId: s.competitionId || "", divisionId: s.divisionId || "", teamId: s.teamId || "" });
const seasonFeedsForEdit = (squadi) => (Array.isArray(squadi) && squadi.length ? squadi.slice(0, 2).map(squadiRow) : [squadiRow(squadi || {})]);
const rowFilled = (r) => !!(String(r.competitionId).trim() || String(r.divisionId).trim() || String(r.teamId).trim());
const SIDE_LABEL_MAX = 12;
const BLANK = {
  name: "", ageGroup: "U8", password: "", coachEmails: "",
  division: "", whatsapp: "", season: { ...BLANK_SEASON },
  squadi: [{ label: "", competitionId: "", divisionId: "", teamId: "" }], // the season: one row, or two for a two-team squad
  competitions: [], // every other competition: { id?, name, squadi: { competitionId, divisionId, teamId }, dribl: { url, team } }
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
      name: t.name, ageGroup: t.ageGroup || "U8", password: t.password,
      coachEmails: (t.coachEmails || []).join(", "),
      division: t.division || "", whatsapp: t.whatsapp || "", season: seasonForEdit(t.season),
      squadi: seasonFeedsForEdit(t.squadi),
      competitions: (t.competitions || []).map((c) => ({ id: c.id, name: c.name || "", squadi: squadiForEdit(c.squadi), dribl: driblForEdit(c.dribl) })),
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

  const submit = async () => {
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
    const idsOf = ({ competitionId, divisionId, teamId }) => ({ competitionId, divisionId, teamId });
    const squadi = rows.length === 2 ? rows.map((r) => ({ label: r.label.trim(), ...idsOf(r) })) : rows.length === 1 ? idsOf(rows[0]) : null;
    // A row nobody filled in is not sent. A named row with no ids is: the
    // competition is kept and synced once its ids are added.
    const competitions = form.competitions
      .filter((c) => c.name.trim() || hasSquadiIds(c.squadi) || c.dribl.url.trim())
      .map((c) => ({
        ...(c.id ? { id: c.id } : {}), name: c.name.trim(),
        ...(hasSquadiIds(c.squadi) ? { squadi: c.squadi } : {}),
        ...(c.dribl.url.trim() ? { dribl: { url: c.dribl.url.trim(), team: c.dribl.team.trim() } } : {})
      }));
    const season = form.season.startISO || form.season.endISO ? { startISO: form.season.startISO, endISO: form.season.endISO } : null;
    const payload = {
      name: form.name, ageGroup: form.ageGroup, password: form.password.trim(),
      coachEmails: form.coachEmails, ...(squadi ? { squadi } : {}),
      // On an edit the list is always sent, so removing a row removes it.
      ...(editSlug || competitions.length ? { competitions } : {}),
      division: form.division, whatsapp: form.whatsapp, season, features: form.features, parentsSee: form.parentsSee,
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
            {form.squadi.map((row, i) => {
              const two = form.squadi.length === 2;
              const who = i === 0 ? "Squadi" : "Second Squadi";
              const set = (key) => (e) => setForm((f) => ({ ...f, squadi: f.squadi.map((r, k) => (k === i ? { ...r, [key]: e.target.value } : r)) }));
              return (
                <div key={i} className="adm-line" style={i === 0 ? { marginTop: 0 } : undefined}>
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} team label`} placeholder={two ? "Label (e.g. McKay)" : "Label (for two teams)"}
                    maxLength={SIDE_LABEL_MAX} required={two} aria-required={two} value={row.label} onChange={set("label")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} competition ID`} placeholder="competitionId" value={row.competitionId} onChange={set("competitionId")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} division ID`} placeholder="divisionId" value={row.divisionId} onChange={set("divisionId")} />
                  <input className="adm-inp" style={{ flex: "1 1 120px" }} aria-label={`${who} team ID`} placeholder="teamId" value={row.teamId} onChange={set("teamId")} />
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
              const setId = (key, value) => set({ squadi: { ...c.squadi, [key]: value } });
              const who = c.name.trim() || `Competition ${i + 1}`;
              return (
                <div key={i} className="adm-comp">
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
                      onChange={(e) => set({ dribl: { ...c.dribl, url: e.target.value } })} />
                    {c.dribl.url.trim() && (
                      <input className="adm-inp" style={{ flex: "1 1 100%" }} aria-label={`${who} team name on Dribl`} placeholder="Your team's name as Dribl shows it"
                        value={c.dribl.team} onChange={(e) => set({ dribl: { ...c.dribl, team: e.target.value } })} />
                    )}
                  </div>
                </div>
              );
            })}
            {form.competitions.length < MAX_COMPETITIONS && (
              <button type="button" className="adm-btn soft sm" style={{ marginTop: 8 }}
                onClick={() => setForm((f) => ({ ...f, competitions: [...f.competitions, { name: "", squadi: squadiForEdit(), dribl: driblForEdit() }] }))}>
                <Plus size={14} aria-hidden="true" />Add a competition
              </button>
            )}
            <div className="adm-note">
              Squadi IDs come from the FQ widget via DevTools (see the README). Add a competition for anything played alongside the
              season, such as a winter tournament. One with no IDs yet is kept, and synced once you add them with Edit. Its games
              are labelled with its name and kept out of the season record.
            </div>
            <div className="adm-note">
              A competition on Dribl takes its fixtures request instead of Squadi IDs: on its Dribl fixtures page, open DevTools,
              choose Network and copy the address of the request that starts with https://mc-api.dribl.com/api/fixtures. Add your
              team's name as Dribl shows it, so the app knows which side of each game is yours. Its games are then kept in step
              whenever a coach opens the team.
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
