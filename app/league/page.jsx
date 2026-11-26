"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AdminPage } from "@/components/AdminShell";

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

// Direction C: the page uses the AdminShell (the dashboard's sub-header, the
// 560 px column and hairline cards); the embedded Squadi draw sits below at a
// wider measure because the widget needs the room.

// The server's error text from a failed JSON response, or a fallback.
async function errorText(res, fallback) {
  try {
    const j = await res.json();
    if (j && typeof j.error === "string" && j.error) return j.error;
  } catch {}
  return fallback;
}

export default function LeaguePage() {
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null); // /api/me: { mode, role, teamName, ... }
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  // Set-up, "Save for everyone" and "Sync now" are coach tools. Legacy
  // team-code sites have no roles (anyone with the code is trusted); in
  // account mode the WORN hat decides. The server enforces this regardless.
  const canManage = !!me && (me.mode === "code" || me.role === "coach");

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
    let cancelled = false;
    // Who am I (mode, worn hat, team name) alongside the team document.
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (!cancelled && m) setMe(m); })
      .catch(() => {});

    fetch("/api/data", { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          // Signed in, but no team is linked to this account (or the session
          // lapsed) — say so here rather than bouncing to the login page.
          setLoadError("No team linked to your account. Ask your coach to add you to the team.");
          return;
        }
        if (r.status === 409) { location.href = "/"; return; } // several teams, none chosen: the picker
        if (!r.ok) { setLoadError(await errorText(r, "Could not load the team.")); return; }
        const d = await r.json();
        if (!d) return;
        setData(d);
        if (d.squadi) setCfg({ ...DEFAULT_CFG, ...d.squadi });
      })
      .catch(() => { if (!cancelled) setLoadError("Could not load the team."); });
    return () => { cancelled = true; };
  }, []);

  // Not configured yet and allowed to configure — show the panel.
  useEffect(() => {
    if (data && !data.squadi && canManage) setOpen(true);
  }, [data, canManage]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError("");
    try {
      const next = { ...data, squadi: cfg };
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (res.status === 409) { location.href = "/"; return; }
      if (!res.ok) {
        setSaveError(await errorText(res, `Save failed (${res.status}).`));
        return;
      }
      setData(next);
      setOpen(false);
    } catch (e) {
      setSaveError("Save failed: " + (e?.message || "network error"));
    } finally {
      setSaving(false);
    }
  };

  const src = buildUrl(cfg);

  return (
    <AdminPage
      title="League fixtures and ladder"
      kicker={me?.teamName ? `${me.teamName} · Squadi` : "Squadi"}
      right={canManage && (
        <button className="adm-hpill" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Set up"}</button>
      )}
      after={src ? (
        <>
          <div className="adm-frame-bar">
            <a href={src} target="_blank" rel="noopener noreferrer" className="adm-link">
              Open full page<ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
          <iframe src={src} className="adm-frame" title="Squadi fixtures" />
        </>
      ) : null}
    >
      {loadError && <div className="adm-msg err" role="alert">{loadError}</div>}

      {canManage && open && (
        <section className="adm-card" aria-labelledby="league-setup">
          <h2 className="adm-label" id="league-setup" style={{ marginBottom: 12 }}>Set up</h2>
          <div className="adm-seg">
            <button className={cfg.mode === "builder" ? "on" : ""} aria-pressed={cfg.mode === "builder"} onClick={() => setCfg({ ...cfg, mode: "builder" })}>Build from filters</button>
            <button className={cfg.mode === "url" ? "on" : ""} aria-pressed={cfg.mode === "url"} onClick={() => setCfg({ ...cfg, mode: "url" })}>Paste full URL</button>
          </div>

          {cfg.mode === "url" ? (
            <div style={{ marginTop: 14 }}>
              <label className="adm-fl" htmlFor="lg-url">Squadi embed URL</label>
              <input id="lg-url" className="adm-inp" value={cfg.url} placeholder="https://registration.squadi.com/liveScoreSeasonFixture?…"
                onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              <div className="adm-note" style={{ marginTop: 10 }}>
                On the FQ competitions page, set the filters you want, then right-click the widget, choose <b>Inspect</b> and
                copy the iframe's <b>src</b> (or grab the request URL from the Network tab) and paste it here.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div className="adm-grid2 stack">
                <div>
                  <label className="adm-fl" htmlFor="lg-year">Year</label>
                  <select id="lg-year" className="adm-inp" value={cfg.yearId} onChange={(e) => setCfg({ ...cfg, yearId: e.target.value })}>
                    {YEARS.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="adm-fl" htmlFor="lg-division">Division ID (age group)</label>
                  <input id="lg-division" className="adm-inp adm-mono" value={cfg.divisionId} placeholder='e.g. 6872, or "All"'
                    onChange={(e) => setCfg({ ...cfg, divisionId: e.target.value })} />
                </div>
              </div>
              <label className="adm-fl" htmlFor="lg-comp" style={{ marginTop: 12 }}>Competition key</label>
              <input id="lg-comp" className="adm-inp adm-mono" value={cfg.comp} placeholder={`2025 Metro MiniRoos: ${MINIROOS_2025}`}
                onChange={(e) => setCfg({ ...cfg, comp: e.target.value })} />
              <div className="adm-grid2 stack" style={{ marginTop: 12 }}>
                <div>
                  <label className="adm-fl" htmlFor="lg-org">Organisation key</label>
                  <input id="lg-org" className="adm-inp adm-mono" value={cfg.org} onChange={(e) => setCfg({ ...cfg, org: e.target.value })} />
                </div>
                <div>
                  <label className="adm-fl" htmlFor="lg-team">Team ID (optional, pins one team)</label>
                  <input id="lg-team" className="adm-inp adm-mono" value={cfg.teamId} onChange={(e) => setCfg({ ...cfg, teamId: e.target.value })} />
                </div>
              </div>
              <div className="adm-note" style={{ marginTop: 10 }}>
                <b>One-time setup for Olympic FC U8 Kangaroos White:</b> use <b>Open full page</b> (above the
                widget below), then set the filters exactly as on the FQ site:
                {TEAM_PRESET.map(([k, v]) => <span key={k}><br />• {k}: <b>{v}</b></span>)}
                <br />As you pick each filter, the page's <b>address bar URL updates</b> with the real IDs
                (competitionUniqueKey, divisionId, teamId). Copy that URL, switch to <b>Paste full URL</b> here,
                paste, and <b>Save for everyone</b>. Until the 2026 MiniRoos &amp; U12 comp is selectable, the widget
                below shows the 2025 MiniRoos season as a placeholder.
              </div>
            </div>
          )}
          <button className="adm-btn block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save for everyone"}</button>
          {saveError && <div className="adm-msg err" role="alert" style={{ marginTop: 10 }}>{saveError}</div>}
          <button className="adm-btn soft block" style={{ marginTop: 8 }} onClick={syncNow}>Sync fixtures from Squadi now</button>
          {syncMsg && <div className="adm-note" role="status" style={{ marginTop: 10 }}>{syncMsg}</div>}
        </section>
      )}

      {!src && (
        <div className="adm-card quiet">
          <b style={{ color: "var(--ink)" }}>Not configured yet.</b><br />
          {canManage
            ? <>Tap <b>Set up</b> and either build the link from filters or paste the embed URL from the FQ website.</>
            : <>The coach has not linked the Squadi fixtures for this team yet.</>}
        </div>
      )}
    </AdminPage>
  );
}
