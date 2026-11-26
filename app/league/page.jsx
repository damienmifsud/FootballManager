"use client";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AdminPage } from "@/components/AdminShell";

// FQ Metro Region organisation key (from footballqueensland.com.au's own embeds).
const FQ_METRO_ORG = "b0e92958-980b-4da0-9ec9-a9c2597b06f0";
// Squadi's season ids: 2025 -> 7, 2026 -> 8, 2027 -> 9 (from its own
// competitions list). Newest first.
const YEARS = [{ label: "2027", id: "9" }, { label: "2026", id: "8" }, { label: "2025", id: "7" }];
// The Year list for a set-up: the known years, plus the set-up's own year id
// when it is one this page does not know (a later season, or one saved from a
// pasted link), so the list never shows a different year from the one saved.
const yearsFor = (yearId) => (!yearId || YEARS.some((y) => y.id === yearId) ? YEARS : [{ label: `Season id ${yearId}`, id: yearId }, ...YEARS]);
const SQUADI_FIXTURES = "https://registration.squadi.com/liveScoreSeasonFixture?";

// What the set-up form starts from when a team has nothing saved: the region
// and the year, and nothing that names a competition, an age group or a team.
// With no competition key there is no link, so no draw is embedded until a
// coach saves one. The page holds no team's ids: the one team that predates
// the set-up panel gets its old default from the server (/api/league, the
// original team only).
const EMPTY_CFG = { mode: "builder", url: "", org: FQ_METRO_ORG, yearId: "8", comp: "", divisionId: "", teamId: "" };

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
  return SQUADI_FIXTURES + p.toString();
}

// Squadi's own fixtures page for the organisation and year in the form, with
// no competition chosen: where a coach starts when nothing is set up yet.
// (Once a draw is showing, "Open full page" above it does the same job.)
function startUrl(c) {
  return SQUADI_FIXTURES + new URLSearchParams({ organisationKey: c.org || FQ_METRO_ORG, yearId: c.yearId || "8" }).toString();
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
  const [me, setMe] = useState(null); // /api/me: { mode, role, teamName, ... }
  const [meReady, setMeReady] = useState(false); // /api/me has answered, whatever it said
  const [cfg, setCfg] = useState(EMPTY_CFG);
  const [loaded, setLoaded] = useState(false); // this team's set-up has arrived from /api/league
  const [teamSlug, setTeamSlug] = useState(""); // the team that set-up was loaded for
  const [hadSetup, setHadSetup] = useState(false); // the team had a set-up of its own when the page loaded
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  // Set-up, "Save for everyone" and "Sync now" are coach tools. Legacy
  // team-code sites have no roles (anyone with the code is trusted); in
  // account mode the WORN hat decides. The server enforces this regardless.
  // Nothing is offered until the team's own set-up has loaded: the form must
  // never open on, and save over, a set-up it has not read.
  const canManage = loaded && !!me && (me.mode === "code" || me.role === "coach");

  const syncNow = async () => {
    setSyncMsg("Syncing…");
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) { setSyncMsg("Sync failed: " + (j.error || res.status)); return; }
      // Nothing to pull: no draw has its Squadi ids yet (they go in club admin).
      if (j.skipped === "no squadi config") { setSyncMsg("No Squadi draw is set up for this team yet."); return; }
      // A team can have several draws (its season and other competitions). One
      // that could not be fetched is named; the others were still applied.
      const failed = Array.isArray(j.failed) && j.failed.length
        ? " Could not sync " + j.failed.map((f) => `${f.name} (${f.error})`).join("; ") + "."
        : "";
      setSyncMsg((j.changes.length
        ? `Updated ${j.changes.length} item${j.changes.length > 1 ? "s" : ""}: ` + j.changes.slice(0, 3).join(" · ") + (j.changes.length > 3 ? " …" : "")
        : "Already up to date with Squadi.") + failed);
    } catch (e) { setSyncMsg("Sync failed: " + e.message); }
  };

  useEffect(() => {
    let cancelled = false;
    // Who am I (mode, worn hat, team name) alongside the team's league set-up.
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (!cancelled && m) setMe(m); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMeReady(true); });

    // Only this team's set-up, through its own narrow route — never the whole
    // team document. squadi is null for a team that has saved nothing.
    fetch("/api/league", { cache: "no-store" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 401) {
          // Signed in, but no team is linked to this account (or the session
          // lapsed) — say so here rather than bouncing to the login page.
          setLoadError("No team linked to your account. Ask your coach to add you to the team.");
          return;
        }
        if (r.status === 409) { location.href = "/"; return; } // several teams, none chosen: on to My teams
        if (!r.ok) { setLoadError(await errorText(r, "Could not load the team.")); return; }
        const j = await r.json();
        if (cancelled) return;
        setCfg({ ...EMPTY_CFG, ...(j?.squadi || {}) });
        setTeamSlug(typeof j?.teamSlug === "string" ? j.teamSlug : "");
        setHadSetup(!!j?.saved);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoadError("Could not load the team."); });
    return () => { cancelled = true; };
  }, []);

  // Nothing saved yet and allowed to configure — show the panel. (Once, when
  // both answers are in: neither value changes again while the page is open.)
  useEffect(() => {
    if (!hadSetup && canManage) setOpen(true);
  }, [hadSetup, canManage]);

  // Writes only this team's league set-up (/api/league), then shows exactly
  // what the server stored. The save names the team the page loaded: the
  // server acts on the team in the cookies, which another tab may have
  // changed since, and refuses a save meant for a different team.
  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamSlug, squadi: cfg })
      });
      if (res.status === 409) { location.href = "/"; return; }
      if (!res.ok) {
        setSaveError(await errorText(res, `Save failed (${res.status}).`));
        return;
      }
      const j = await res.json().catch(() => null);
      if (j?.squadi) setCfg({ ...EMPTY_CFG, ...j.squadi });
      setOpen(false);
    } catch (e) {
      setSaveError("Save failed: " + (e?.message || "network error"));
    } finally {
      setSaving(false);
    }
  };

  // The form starts empty and only the team's own set-up fills it, so there is
  // no link (and no draw) on the first paint, after a failed load, or for a
  // team that has saved nothing.
  const src = buildUrl(cfg);
  const teamLabel = me?.teamName || "this team";

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
                    {yearsFor(cfg.yearId).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="adm-fl" htmlFor="lg-division">Division ID (age group)</label>
                  <input id="lg-division" className="adm-inp adm-mono" value={cfg.divisionId} placeholder='e.g. 6872, or "All"'
                    onChange={(e) => setCfg({ ...cfg, divisionId: e.target.value })} />
                </div>
              </div>
              <label className="adm-fl" htmlFor="lg-comp" style={{ marginTop: 12 }}>Competition key</label>
              <input id="lg-comp" className="adm-inp adm-mono" value={cfg.comp} placeholder="competitionUniqueKey from the Squadi link"
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
                <b>One-time setup for {teamLabel}:</b> open the Squadi fixtures page (the link below) and choose
                the year, organisation, competition, age group and team. As you pick each filter, the page's{" "}
                <b>address bar URL updates</b> with the real IDs (competitionUniqueKey, divisionId, teamId).
                Copy that URL, switch to <b>Paste full URL</b> here, paste it and <b>Save for everyone</b>.
              </div>
              <a href={startUrl(cfg)} target="_blank" rel="noopener noreferrer" className="adm-link" style={{ marginTop: 6 }}>
                Open the Squadi fixtures page<ExternalLink size={13} aria-hidden="true" />
              </a>
            </div>
          )}
          <button className="adm-btn block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save for everyone"}</button>
          {saveError && <div className="adm-msg err" role="alert" style={{ marginTop: 10 }}>{saveError}</div>}
          <button className="adm-btn soft block" style={{ marginTop: 8 }} onClick={syncNow}>Sync fixtures from Squadi now</button>
          {syncMsg && <div className="adm-note" role="status" style={{ marginTop: 10 }}>{syncMsg}</div>}
        </section>
      )}

      {loaded && meReady && !src && (
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
