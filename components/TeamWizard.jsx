"use client";
// Team setup wizard for the super admin (/admin). Creates teams live via
// /api/teams — no TEAMS env editing, no restarts. Also lists every team with
// its code + calendar feed, and can edit or remove wizard-created teams
// (editing an env-defined team takes it over into the store).
import { useState, useEffect, useCallback, useMemo } from "react";
import { parsePlayerImport } from "@/lib/majestri";
import { DEFAULT_FEATURES, FEATURE_LABELS, DEFAULT_PARENTS_SEE, PARENTS_SEE_LABELS, STAFF_ROLES } from "@/lib/teamSetup";
import { downscaleImage } from "@/lib/clientImage";

const C = { red: "#C8102E", ink: "#1d1417", muted: "#7a6f72", line: "#eee", soft: "#f6f2f3", ok: "#1E9E57" };
const card = { background: "#fff", borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: "0 10px 26px rgba(40,0,8,.18)", color: C.ink };
const label = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.muted, marginBottom: 10 };
const inp = { padding: "9px 12px", borderRadius: 10, border: "2px solid " + C.line, fontSize: 14, boxSizing: "border-box", width: "100%" };
const btn = { padding: "9px 14px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const ghost = { ...btn, background: "#fff", color: C.red, border: "1px solid " + C.red };
const chip = { display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 };
const fieldLb = { display: "block", fontSize: 12, fontWeight: 700, color: C.ink, margin: "10px 0 4px" };
const hint = { fontSize: 11.5, color: C.muted, marginTop: 3 };

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
const BLANK = {
  name: "", ageGroup: "U8", password: "", coachEmails: "",
  division: "", whatsapp: "",
  squadi: { competitionId: "", divisionId: "", teamId: "" },
  importText: "",
  training: [], // { weekday, time, endTime, location }
  features: { ...DEFAULT_FEATURES },
  parentsSee: { ...DEFAULT_PARENTS_SEE },
  logo: "", hasLogo: false, coachPin: "",
  staff: STAFF_ROLES.map((role) => ({ role, name: "", mobile: "" }))
};

export default function TeamWizard() {
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

  const openCreate = () => { setCreated(null); setEditSlug(null); setForm({ ...BLANK, features: { ...DEFAULT_FEATURES }, parentsSee: { ...DEFAULT_PARENTS_SEE }, training: [], password: friendlyCode() }); };
  const openEdit = (t) => {
    setCreated(null); setEditSlug(t.slug);
    setForm({
      name: t.name, ageGroup: t.ageGroup || "U8", password: t.password,
      coachEmails: (t.coachEmails || []).join(", "),
      division: t.division || "", whatsapp: t.whatsapp || "",
      squadi: { competitionId: t.squadi?.competitionId || "", divisionId: t.squadi?.divisionId || "", teamId: t.squadi?.teamId || "" },
      importText: "", training: [],
      features: { ...DEFAULT_FEATURES, ...(t.features || {}) },
      parentsSee: { ...DEFAULT_PARENTS_SEE, ...(t.parentsSee || {}) },
      logo: "", hasLogo: !!t.hasLogo, coachPin: t.coachPin || "",
      staff: STAFF_ROLES.map((role) => {
        const s = (t.staff || []).find((x) => x.role === role) || {};
        return { role, name: s.name || "", mobile: s.mobile || "" };
      })
    });
  };

  // As super admin you're a coach on every team — jump straight into one.
  const openDashboard = (t) => {
    document.cookie = `team_slug=${encodeURIComponent(t.slug)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
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
    () => (form && !editSlug && form.importText.trim() ? parsePlayerImport(form.importText) : { isMajestri: false, players: [] }),
    [form, editSlug]
  );
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
    setBusy(true); setErr("");
    const squadi = (form.squadi.competitionId || form.squadi.divisionId || form.squadi.teamId) ? form.squadi : null;
    const payload = {
      name: form.name, ageGroup: form.ageGroup, password: form.password.trim(),
      coachEmails: form.coachEmails, ...(squadi ? { squadi } : {}),
      division: form.division, whatsapp: form.whatsapp, features: form.features, parentsSee: form.parentsSee,
      staff: form.staff.filter((s) => s.name.trim()),
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
      if (!editSlug) setCreated({ ...j.team, playersImported: j.playersImported || 0, trainingSeeded: j.trainingSeeded || 0 });
      setForm(null); setEditSlug(null);
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const remove = async (slug) => {
    if (!window.confirm(`Remove team "${slug}"? Its data stays in the store — re-adding the same slug restores it.`)) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/teams", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "delete failed");
      await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const srcChip = (t) => t.source === "stored"
    ? <span style={{ ...chip, background: "rgba(30,158,87,.12)", color: C.ok }}>wizard</span>
    : <span style={{ ...chip, background: C.soft, color: C.muted }}>{t.source}</span>;

  return (
    <div style={card}>
      <div style={label}>Teams</div>
      {err && <div style={{ background: "#fff4f4", color: C.red, fontWeight: 700, fontSize: 13, borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>{err}</div>}

      {created && (
        <div style={{ background: "rgba(30,158,87,.08)", border: "1px solid rgba(30,158,87,.35)", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.ok }}>✓ {created.name} is live</div>
          <div style={{ fontSize: 13, marginTop: 8 }}>
            Team code: <b style={{ fontSize: 15 }}>{created.password}</b>{" "}
            <button style={{ ...ghost, padding: "3px 9px", fontSize: 11 }} onClick={() => copy(created.password, "newcode")}>{copied === "newcode" ? "Copied!" : "Copy"}</button>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
            {created.playersImported > 0 && <b>{created.playersImported} player{created.playersImported > 1 ? "s" : ""} imported with parent details. </b>}
            {created.trainingSeeded > 0 && <b>{created.trainingSeeded} weekly training session{created.trainingSeeded > 1 ? "s" : ""} added to the calendar. </b>}
            Share the code with the team. Parents log in with it at {typeof window !== "undefined" ? window.location.origin : ""} — the calendar subscribe link is on their Home tab.
          </div>
          <button style={{ ...ghost, marginTop: 10, padding: "5px 10px", fontSize: 12 }} onClick={() => setCreated(null)}>Done</button>
        </div>
      )}

      {!teams ? (
        <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {teams.map((t) => (
            <div key={t.slug} style={{ padding: "10px 0", borderBottom: "1px solid " + C.line }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 800, fontSize: 14.5 }}>{t.name}</span>
                {t.ageGroup && <span style={{ ...chip, background: C.soft, color: C.muted }}>{t.ageGroup}</span>}
                {srcChip(t)}
                <span style={{ flex: 1 }} />
                <button style={{ ...btn, padding: "4px 9px", fontSize: 11.5 }} onClick={() => openDashboard(t)}>Open ▸</button>
                <button style={{ ...ghost, padding: "4px 9px", fontSize: 11.5 }} onClick={() => openEdit(t)}>Edit</button>
                {t.source === "stored" && (
                  <button disabled={busy} style={{ ...ghost, padding: "4px 9px", fontSize: 11.5 }} onClick={() => remove(t.slug)}>Remove</button>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 12.5, color: C.muted }}>
                <span>slug: <b style={{ color: C.ink }}>{t.slug}</b></span>
                <span>
                  code:{" "}
                  <b style={{ color: C.ink }}>{reveal[t.slug] ? t.password : "••••••"}</b>{" "}
                  <button style={{ background: "none", border: "none", color: C.red, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}
                    onClick={() => setReveal((r) => ({ ...r, [t.slug]: !r[t.slug] }))}>{reveal[t.slug] ? "hide" : "show"}</button>{" "}
                  <button style={{ background: "none", border: "none", color: C.red, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}
                    onClick={() => copy(t.password, "code" + t.slug)}>{copied === "code" + t.slug ? "copied!" : "copy"}</button>
                </span>
                {t.calendarKey && (
                  <button style={{ background: "none", border: "none", color: C.red, fontWeight: 700, fontSize: 11.5, cursor: "pointer", padding: 0 }}
                    onClick={() => copy(feedUrl(t), "cal" + t.slug)}>{copied === "cal" + t.slug ? "calendar link copied!" : "copy calendar link"}</button>
                )}
                {(t.coachEmails || []).length > 0 && <span>coaches: {t.coachEmails.join(", ")}</span>}
              </div>
            </div>
          ))}
          {teams.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No teams yet — add the first one below.</div>}
        </>
      )}

      {!form ? (
        <button style={{ ...btn, marginTop: 14 }} onClick={openCreate}>＋ Add a team</button>
      ) : (
        <div style={{ marginTop: 14, borderTop: "2px solid " + C.soft, paddingTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{editSlug ? `Edit ${editSlug}` : "New team"}</div>

          <span style={fieldLb}>1 · Team name</span>
          <input style={inp} placeholder="Olympic FC U9 Wallabies Blue" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          {!editSlug && form.name && <div style={hint}>slug (permanent): <b>{slugify(form.name) || "—"}</b></div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <input style={{ ...inp, flex: "1 1 180px" }} placeholder="Division label (e.g. Kangaroos K1 Central Hub)" value={form.division}
              onChange={(e) => setForm((f) => ({ ...f, division: e.target.value }))} />
            <input style={{ ...inp, flex: "1 1 180px" }} placeholder="WhatsApp group link (optional)" value={form.whatsapp}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))} />
          </div>

          <span style={fieldLb}>2 · Age group</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {AGE_GROUPS.map((a) => (
              <button key={a} onClick={() => setForm((f) => ({ ...f, ageGroup: a }))}
                style={{ ...chip, cursor: "pointer", border: "1px solid " + (form.ageGroup === a ? C.red : C.line), background: form.ageGroup === a ? C.red : "#fff", color: form.ageGroup === a ? "#fff" : C.ink, padding: "6px 12px" }}>
                {a}
              </button>
            ))}
          </div>
          <div style={hint}>Sets the default match format (e.g. U8–U9 → 7-a-side, 2 × 20').</div>

          <span style={fieldLb}>3 · Team code — what everyone types to log in</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            <button style={ghost} onClick={() => setForm((f) => ({ ...f, password: friendlyCode() }))}>↻ New</button>
          </div>
          <div style={hint}>Must be unique across teams — the code picks the team at login. The calendar key is generated automatically.</div>
          {editSlug && (
            <button disabled={busy} style={{ ...ghost, marginTop: 8, padding: "6px 11px", fontSize: 12 }} onClick={() => rotateKey(editSlug)}>
              ↻ Rotate calendar key (if the subscribe link leaked)
            </button>
          )}

          <span style={fieldLb}>4 · Coach / manager emails (optional — for account login)</span>
          <input style={inp} placeholder="coach@example.com, manager@example.com" value={form.coachEmails}
            onChange={(e) => setForm((f) => ({ ...f, coachEmails: e.target.value }))} />

          <span style={fieldLb}>5 · Squadi sync (optional — fill in when FQ publishes the draw)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inp, flex: "1 1 120px" }} placeholder="competitionId" value={form.squadi.competitionId}
              onChange={(e) => setForm((f) => ({ ...f, squadi: { ...f.squadi, competitionId: e.target.value } }))} />
            <input style={{ ...inp, flex: "1 1 120px" }} placeholder="divisionId" value={form.squadi.divisionId}
              onChange={(e) => setForm((f) => ({ ...f, squadi: { ...f.squadi, divisionId: e.target.value } }))} />
            <input style={{ ...inp, flex: "1 1 120px" }} placeholder="teamId" value={form.squadi.teamId}
              onChange={(e) => setForm((f) => ({ ...f, squadi: { ...f.squadi, teamId: e.target.value } }))} />
          </div>
          <div style={hint}>From the FQ widget via DevTools (see the README) — leave blank to add later with Edit.</div>

          {!editSlug && (
            <>
              <span style={fieldLb}>6 · Players & parents — Majestri import (optional)</span>
              <div style={hint}>
                Upload the Majestri CSV export, or paste it (from the file or straight out of Excel).
                Player rows only — parents' names, emails and mobiles come across, which is what
                powers parent login and RSVPs. A simple list works too:
                <i> Name, number, position, parent, mobile, dd/mm/yyyy</i>.
              </div>
              <div style={{ margin: "8px 0 6px" }}>
                <label style={{ ...ghost, display: "inline-block", cursor: "pointer" }}>
                  Upload CSV…
                  <input type="file" accept=".csv,text/csv,text/plain" style={{ display: "none" }} onChange={onCsvFile} />
                </label>
              </div>
              <textarea
                style={{ ...inp, minHeight: 96, fontFamily: "ui-monospace,monospace", fontSize: 12 }}
                placeholder={"…or paste the export here\nSpencer, 6, MID, Damien, 0400 000 000, 12/03/2018"}
                value={form.importText}
                onChange={(e) => setForm((f) => ({ ...f, importText: e.target.value }))}
              />
              {form.importText.trim() && (
                <div style={{ ...hint, marginTop: 6 }}>
                  {imported.isMajestri && <b style={{ color: C.ok }}>Majestri export detected. </b>}
                  {imported.players.length > 0 ? (
                    <>
                      <b style={{ color: C.ok }}>{imported.players.length} player{imported.players.length > 1 ? "s" : ""} ready:</b>{" "}
                      {imported.players.slice(0, 8).map((p) => p.name).join(", ")}{imported.players.length > 8 ? "…" : ""}
                      {" · "}{imported.players.filter((p) => (p.parentEmails || []).length).length} with parent emails
                    </>
                  ) : (
                    <span style={{ color: C.red, fontWeight: 700 }}>Nothing parseable yet — check the format.</span>
                  )}
                </div>
              )}

              <span style={fieldLb}>7 · Weekly training schedule (optional)</span>
              <div style={hint}>
                These become recurring sessions on the team calendar — and flow into every parent's
                subscribed calendar automatically, exactly like Squadi-synced games.
              </div>
              {form.training.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <select style={{ ...inp, width: "auto" }} value={row.weekday}
                    onChange={(e) => setForm((f) => ({ ...f, training: f.training.map((r, k) => k === i ? { ...r, weekday: e.target.value } : r) }))}>
                    {WEEKDAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input type="time" style={{ ...inp, width: "auto" }} value={row.time}
                    onChange={(e) => setForm((f) => ({ ...f, training: f.training.map((r, k) => k === i ? { ...r, time: e.target.value } : r) }))} />
                  <span style={{ fontSize: 12, color: C.muted }}>to</span>
                  <input type="time" style={{ ...inp, width: "auto" }} value={row.endTime}
                    onChange={(e) => setForm((f) => ({ ...f, training: f.training.map((r, k) => k === i ? { ...r, endTime: e.target.value } : r) }))} />
                  <input style={{ ...inp, flex: "1 1 120px" }} placeholder="Location" value={row.location}
                    onChange={(e) => setForm((f) => ({ ...f, training: f.training.map((r, k) => k === i ? { ...r, location: e.target.value } : r) }))} />
                  <button style={{ background: "none", border: "none", color: C.red, fontWeight: 700, cursor: "pointer" }}
                    onClick={() => setForm((f) => ({ ...f, training: f.training.filter((_, k) => k !== i) }))}>✕</button>
                </div>
              ))}
              <button style={{ ...ghost, marginTop: 8, padding: "6px 11px", fontSize: 12 }}
                onClick={() => setForm((f) => ({ ...f, training: [...f.training, { weekday: "2", time: "17:00", endTime: "18:00", location: "" }] }))}>
                ＋ Add training day
              </button>
            </>
          )}

          <span style={fieldLb}>{editSlug ? "Features" : "8 · Features"} — what this team uses</span>
          <div style={hint}>Turn off anything that isn't relevant — the dashboard hides it for everyone on this team.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {Object.keys(DEFAULT_FEATURES).map((k) => {
              const on = !!form.features[k];
              return (
                <button key={k} onClick={() => setForm((f) => ({ ...f, features: { ...f.features, [k]: !on } }))}
                  style={{ ...chip, cursor: "pointer", padding: "7px 12px", border: "1px solid " + (on ? C.ok : C.line), background: on ? "rgba(30,158,87,.10)" : "#fff", color: on ? C.ok : C.muted }}>
                  {on ? "✓ " : ""}{FEATURE_LABELS[k]}
                </button>
              );
            })}
          </div>

          <span style={fieldLb}>{editSlug ? "Parents can see" : "9 · Parents can see"} — what parents see of match day</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {Object.keys(DEFAULT_PARENTS_SEE).map((k) => {
              const on = !!form.parentsSee[k];
              return (
                <button key={k} onClick={() => setForm((f) => ({ ...f, parentsSee: { ...f.parentsSee, [k]: !on } }))}
                  style={{ ...chip, cursor: "pointer", padding: "7px 12px", border: "1px solid " + (on ? C.ok : C.line), background: on ? "rgba(30,158,87,.10)" : "#fff", color: on ? C.ok : C.muted }}>
                  {on ? "✓ " : ""}{PARENTS_SEE_LABELS[k]}
                </button>
              );
            })}
          </div>
          <div style={hint}>You can change this any time in Settings.</div>

          <span style={fieldLb}>{editSlug ? "Team identity" : "10 · Team identity"} — logo, staff & coach PIN (all optional)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {form.logo
              ? <img src={form.logo} alt="" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 10, background: C.soft }} />
              : form.hasLogo
              ? <span style={{ ...chip, background: "rgba(30,158,87,.10)", color: C.ok }}>logo set ✓</span>
              : null}
            <label style={{ ...ghost, display: "inline-block", cursor: "pointer" }}>
              {form.logo || form.hasLogo ? "Replace logo…" : "Upload logo…"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={onLogoFile} />
            </label>
            <span style={{ fontSize: 11.5, color: C.muted }}>shown on the header, login and calendar</span>
          </div>
          {form.staff.map((s, i) => (
            <div key={s.role} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: C.muted }}>{s.role}</span>
              <input style={{ ...inp, flex: "2 1 140px" }} placeholder="Name" value={s.name}
                onChange={(e) => setForm((f) => ({ ...f, staff: f.staff.map((r, k) => k === i ? { ...r, name: e.target.value } : r) }))} />
              <input style={{ ...inp, flex: "1 1 120px" }} placeholder="Mobile (optional)" inputMode="tel" value={s.mobile}
                onChange={(e) => setForm((f) => ({ ...f, staff: f.staff.map((r, k) => k === i ? { ...r, mobile: e.target.value } : r) }))} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: C.muted }}>Coach PIN</span>
            <input style={{ ...inp, width: 120 }} inputMode="numeric" placeholder="e.g. 2468" value={form.coachPin}
              onChange={(e) => setForm((f) => ({ ...f, coachPin: e.target.value }))} />
            <span style={{ fontSize: 11.5, color: C.muted }}>in team-code mode, hides the edit controls behind this PIN</span>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button disabled={busy || !form.name.trim() || form.password.trim().length < 4} style={btn} onClick={submit}>
              {busy ? "…" : editSlug ? "Save changes" : "Create team"}
            </button>
            <button style={ghost} onClick={() => { setForm(null); setEditSlug(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
