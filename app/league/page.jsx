"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

// FQ Metro Region organisation key (from footballqueensland.com.au's own embeds).
const FQ_METRO_ORG = "b0e92958-980b-4da0-9ec9-a9c2597b06f0";
// Known season ids on FQ's site: 2025 -> 7, 2026 -> 8.
const YEARS = [{ label: "2026", id: "8" }, { label: "2025", id: "7" }];
// FQ's 2025 Metro Coles MiniRoos competition key (working default until the 2026 one is published).
const MINIROOS_2025 = "b63aa285-57d7-4ac7-b10c-7c443fc0d80c";

const DEFAULT_CFG = {
  mode: "builder", // builder | url
  url: "",
  org: FQ_METRO_ORG,
  yearId: "8",
  comp: "58ec2bda-ceed-48f2-a33e-5b9d13cc30e8", // Metro | Coles MiniRoos & U12 (2026)
  divisionId: "10661", // Under 8 Kangaroos K1 Central Hub (2026)
  teamId: "110013" // Olympic FC U8 Kangaroos White (2026)
};

// The filters for this team, as shown in the Squadi widget:
const TEAM_PRESET = [
  ["Year", "2026"],
  ["Organisation", "Metro Region"],
  ["Competition", "Metro | Coles MiniRoos & U12"],
  ["Age Group", "Under 8 Kangaroos K1 Central Hub"],
  ["Team", "Olympic FC U8 Kangaroos White"]
];

function buildUrl(c) {
  if (c.mode === "url" && c.url) return c.url;
  if (!c.comp) return "";
  const p = new URLSearchParams({
    organisationKey: c.org || FQ_METRO_ORG,
    yearId: c.yearId || "8",
    competitionUniqueKey: c.comp,
    divisionId: c.divisionId || "All"
  });
  if (c.teamId) p.set("teamId", c.teamId);
  return "https://registration.squadi.com/liveScoreSeasonFixture?" + p.toString();
}

const S = {
  page: { minHeight: "100vh", background: "#F4F4F3", fontFamily: "system-ui,sans-serif" },
  bar: { background: "linear-gradient(160deg,#C8102E,#7A0A1B)", color: "#fff", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 },
  back: { color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13, background: "rgba(255,255,255,.15)", padding: "7px 12px", borderRadius: 999 },
  h: { fontSize: 17, fontWeight: 800, margin: 0 },
  gear: { marginLeft: "auto", background: "rgba(255,255,255,.15)", color: "#fff", border: "none", borderRadius: 999, padding: "7px 12px", fontWeight: 700, fontSize: 13, cursor: "pointer" },
  panel: { background: "#fff", borderBottom: "1px solid #e7e3e3", padding: 16 },
  lab: { display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#6b5a5d", margin: "10px 0 4px" },
  inp: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid #e7e3e3", fontSize: 14, background: "#faf9f9" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  btn: { marginTop: 14, width: "100%", padding: 12, borderRadius: 10, border: "none", background: "#C8102E", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" },
  note: { fontSize: 12, color: "#6b5a5d", lineHeight: 1.55, marginTop: 10 },
  seg: { display: "flex", gap: 6, marginTop: 10 },
  segBtn: (on) => ({ flex: 1, padding: 9, borderRadius: 10, border: "1px solid " + (on ? "#C8102E" : "#e7e3e3"), background: on ? "#C8102E" : "#faf9f9", color: on ? "#fff" : "#6b5a5d", fontWeight: 700, fontSize: 13, cursor: "pointer" }),
  frameWrap: { padding: 14 },
  frame: { width: "100%", height: "calc(100vh - 120px)", border: "1px solid #e7e3e3", borderRadius: 14, background: "#fff" },
  empty: { textAlign: "center", padding: "60px 24px", color: "#6b5a5d", fontSize: 14, lineHeight: 1.6 }
};

export default function LeaguePage() {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const syncNow = async () => {
    setSyncMsg("Syncing…");
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setSyncMsg("Sync failed: " + (j.error || res.status)); return; }
      setSyncMsg(j.changes.length
        ? `Updated ${j.changes.length} item${j.changes.length > 1 ? "s" : ""}: ` + j.changes.slice(0, 3).join(" · ") + (j.changes.length > 3 ? " …" : "")
        : "Already up to date with Squadi.");
    } catch (e) { setSyncMsg("Sync failed: " + e.message); }
  };

  useEffect(() => {
    fetch("/api/data", { cache: "no-store" })
      .then((r) => (r.status === 401 ? (location.href = "/login") : r.json()))
      .then((d) => {
        if (!d) return;
        setData(d);
        if (d.squadi) setCfg({ ...DEFAULT_CFG, ...d.squadi });
        else setOpen(true); // not configured yet — show the panel
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const next = { ...data, squadi: cfg };
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (res.ok) {
        setData(next);
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const src = buildUrl(cfg);

  return (
    <div style={S.page}>
      <div style={S.bar}>
        <Link href="/" style={S.back}>← Dashboard</Link>
        <h1 style={S.h}>League fixtures & ladder (Squadi)</h1>
        <button style={S.gear} onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Set up"}</button>
      </div>

      {open && (
        <div style={S.panel}>
          <div style={S.seg}>
            <button style={S.segBtn(cfg.mode === "builder")} onClick={() => setCfg({ ...cfg, mode: "builder" })}>Build from filters</button>
            <button style={S.segBtn(cfg.mode === "url")} onClick={() => setCfg({ ...cfg, mode: "url" })}>Paste full URL</button>
          </div>

          {cfg.mode === "url" ? (
            <>
              <label style={S.lab}>Squadi embed URL</label>
              <input style={S.inp} value={cfg.url} placeholder="https://registration.squadi.com/liveScoreSeasonFixture?…"
                onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              <div style={S.note}>
                On the FQ competitions page, set the filters you want, then right-click the widget → <b>Inspect</b> →
                copy the iframe's <b>src</b> (or grab the request URL from the Network tab) and paste it here.
              </div>
            </>
          ) : (
            <>
              <div style={S.row}>
                <div>
                  <label style={S.lab}>Year</label>
                  <select style={S.inp} value={cfg.yearId} onChange={(e) => setCfg({ ...cfg, yearId: e.target.value })}>
                    {YEARS.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lab}>Division ID (age group)</label>
                  <input style={S.inp} value={cfg.divisionId} placeholder='e.g. 6872, or "All"'
                    onChange={(e) => setCfg({ ...cfg, divisionId: e.target.value })} />
                </div>
              </div>
              <label style={S.lab}>Competition key</label>
              <input style={S.inp} value={cfg.comp} placeholder={`2025 Metro MiniRoos: ${MINIROOS_2025}`}
                onChange={(e) => setCfg({ ...cfg, comp: e.target.value })} />
              <div style={S.row}>
                <div>
                  <label style={S.lab}>Organisation key</label>
                  <input style={S.inp} value={cfg.org} onChange={(e) => setCfg({ ...cfg, org: e.target.value })} />
                </div>
                <div>
                  <label style={S.lab}>Team ID (optional — pins one team)</label>
                  <input style={S.inp} value={cfg.teamId} onChange={(e) => setCfg({ ...cfg, teamId: e.target.value })} />
                </div>
              </div>
              <div style={S.note}>
                <b>One-time setup for Olympic FC U8 Kangaroos White:</b> use <b>Open full page</b> (top right of the
                widget below), then set the filters exactly as on the FQ site:
                {TEAM_PRESET.map(([k, v]) => <span key={k}><br />• {k}: <b>{v}</b></span>)}
                <br />As you pick each filter, the page's <b>address bar URL updates</b> with the real IDs
                (competitionUniqueKey, divisionId, teamId). Copy that URL, switch to <b>Paste full URL</b> here,
                paste, and <b>Save for everyone</b>. Until the 2026 MiniRoos &amp; U12 comp is selectable, the widget
                below shows the 2025 MiniRoos season as a placeholder.
              </div>
            </>
          )}
          <button style={S.btn} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save for everyone"}</button>
          <button style={{ ...S.btn, background: "#1d2440", marginTop: 8 }} onClick={syncNow}>Sync fixtures from Squadi now</button>
          {syncMsg && <div style={S.note}>{syncMsg}</div>}
        </div>
      )}

      <div style={S.frameWrap}>
        {src ? (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <a href={src} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12.5, fontWeight: 700, color: "#C8102E", textDecoration: "none", background: "#fdeaec", padding: "7px 12px", borderRadius: 999 }}>
                Open full page ↗ (filter there, then copy the URL)
              </a>
            </div>
            <iframe src={src} style={S.frame} title="Squadi fixtures" />
          </>
        ) : (
          <div style={S.empty}>
            <b>Not configured yet.</b><br />
            Hit <b>Set up</b> and either build the link from filters or paste the embed URL from the FQ website.
          </div>
        )}
      </div>
    </div>
  );
}
