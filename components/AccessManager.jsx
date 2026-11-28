"use client";
// The /admin page. Super admins ("super" scope) get four sections: Teams
// (the team wizard and the league link), People (everyone with a login and
// what each is attached to), Logos (the club logo library: the opposition's
// logos found on Squadi and Dribl, components/ClubLogos.jsx) and Access
// (view-as, club admins, per-team role overrides and the role table). Club admins ("club" scope) get the team
// wizard, the role table and the league link only, with no sections to
// choose between. Talks to /api/access; lib/directory.js applies whatever is
// saved here on every request.
//
// Direction C: the dashboard's sub-header and cards via AdminShell (paper
// page, hairline cards, tinted pills, lucide icons, no gradients, no emoji).
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronRight, Eye, Trophy } from "lucide-react";
import TeamWizard from "@/components/TeamWizard";
import PeopleDirectory from "@/components/PeopleDirectory";
import ClubLogos from "@/components/ClubLogos";
import RoleMatrix from "@/components/RoleMatrix";
import { AdminPage } from "@/components/AdminShell";
import { SignOutButton } from "@/components/AuthShell";

const ROLE_LABELS = { coach: "Coach", parent: "Parent or player", viewer: "View only", blocked: "Blocked" };
const ROLE_TONES = { coach: " ok", parent: " info", viewer: " warn", blocked: " bad" };

// The super admin's sections. The one showing is kept in the address
// (?section=people) so a reload, or coming back from a team, lands on it again.
const SECTIONS = [["teams", "Teams"], ["people", "People"], ["logos", "Logos"], ["access", "Access"]];
const sectionInAddress = () => {
  try {
    const wanted = new URLSearchParams(window.location.search).get("section");
    return SECTIONS.some(([key]) => key === wanted) ? wanted : "teams";
  } catch { return "teams"; }
};

export default function AccessManager({ adminEmail, scope = "super" }) {
  const superAdmin = scope === "super";
  const [state, setState] = useState(null); // { teams, clubAdmins, envClubAdmins, overrides, roles }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [caEmail, setCaEmail] = useState("");
  const [ovEmail, setOvEmail] = useState("");
  const [ovTeam, setOvTeam] = useState("");
  const [ovRole, setOvRole] = useState("viewer");
  const [vaEmail, setVaEmail] = useState("");
  const [section, setSectionState] = useState("teams");
  useEffect(() => { if (superAdmin) setSectionState(sectionInAddress()); }, [superAdmin]);
  const setSection = (key) => {
    setSectionState(key);
    try { window.history.replaceState(null, "", key === "teams" ? window.location.pathname : `?section=${key}`); } catch {}
  };
  // A club admin has one page and nothing to choose between.
  const showing = (key) => (superAdmin ? section === key : key === "teams");

  const startViewAs = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "viewAs", email: vaEmail }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "failed");
      window.location.href = "/"; // straight into their view
    } catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/access", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "load failed");
      const j = await r.json();
      setState(j);
      // Keep the chosen team if it still exists; otherwise fall to the first.
      setOvTeam((t) => (j.teams.some((x) => x.slug === t) ? t : j.teams[0]?.slug || ""));
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { if (superAdmin) load(); }, [load, superAdmin]);

  const post = async (body) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "save failed");
      await load();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };

  const teamName = (slug) => state?.teams.find((t) => t.slug === slug)?.name || slug;
  const overrideRows = state
    ? Object.entries(state.overrides).flatMap(([email, per]) => Object.entries(per).map(([slug, role]) => ({ email, slug, role })))
    : [];

  return (
    <AdminPage
      title={superAdmin ? "Club admin" : "Club teams"}
      kicker={`${superAdmin ? "Super admin" : "Club admin"} · ${adminEmail}`}
      right={<SignOutButton className="adm-hpill" />}
    >
      {err && <div className="adm-msg err" role="alert">{err}</div>}

      {superAdmin && (
        <div className="adm-seg" role="group" aria-label="Club admin sections">
          {SECTIONS.map(([key, label]) => (
            <button key={key} type="button" className={section === key ? "on" : ""} aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>
          ))}
        </div>
      )}

      {/* Teams: what both kinds of admin open this page for. The wizard stays
          mounted while another section shows, so a team being set up is not
          lost by looking something up; it also tells this page when the team
          list changes so the override form's team menu stays current. */}
      <div className={"adm-sect" + (showing("teams") ? "" : " off")}>
        <TeamWizard onTeamsChanged={superAdmin ? load : undefined} />
      </div>

      {showing("people") && <PeopleDirectory onChanged={load} />}

      {showing("logos") && <ClubLogos />}

      {showing("access") && !state && !err && <div className="adm-card quiet">Loading access settings…</div>}

      {showing("access") && state && (<>
        <section className="adm-card" aria-labelledby="adm-viewas">
          <h2 className="adm-label" id="adm-viewas">View as a user</h2>
          <div className="adm-body">
            See the site exactly as a parent, coach or club admin sees it. It is strictly read only:
            every save is refused while you are viewing. An orange banner shows while it is active,
            and Exit brings you back to yourself.
          </div>
          {state.viewingAs ? (
            <div className="adm-form">
              <span className="adm-pill warn lg"><Eye size={12} aria-hidden="true" />Viewing as {state.viewingAs}</span>
              <Link href="/" className="adm-btn sm">Open their view</Link>
              <button disabled={busy} className="adm-btn soft sm" onClick={() => post({ action: "clearViewAs" })}>Exit view-as</button>
            </div>
          ) : (
            <div className="adm-form">
              <input className="adm-inp grow" type="email" aria-label="Email to view as" placeholder="parent@example.com" value={vaEmail}
                onChange={(e) => setVaEmail(e.target.value)} />
              <button disabled={busy || !vaEmail.includes("@")} className="adm-btn" onClick={startViewAs}><Eye size={15} aria-hidden="true" />View as</button>
            </div>
          )}
        </section>

        <section className="adm-card" aria-labelledby="adm-clubadmins">
          <h2 className="adm-label" id="adm-clubadmins">Club admins</h2>
          <div className="adm-body">View-only access to every team, for example the club technical director.</div>
          <div className="adm-rows">
            {state.envClubAdmins.map((e) => (
              <div key={e} className="adm-row">
                <span className="adm-row-main">{e}</span>
                <span className="adm-pill">Set in the environment</span>
              </div>
            ))}
            {state.clubAdmins.map((e) => (
              <div key={e} className="adm-row">
                <span className="adm-row-main">{e}</span>
                <button disabled={busy} className="adm-btn danger sm" aria-label={`Remove ${e}`}
                  onClick={() => post({ action: "removeClubAdmin", email: e })}>Remove</button>
              </div>
            ))}
            {state.envClubAdmins.length + state.clubAdmins.length === 0 && <div className="adm-empty">No club admins yet.</div>}
          </div>
          <div className="adm-form">
            <input className="adm-inp grow" type="email" aria-label="Club admin email" placeholder="td@club.com" value={caEmail} onChange={(e) => setCaEmail(e.target.value)} />
            <button disabled={busy || !caEmail.includes("@")} className="adm-btn" onClick={() => { post({ action: "addClubAdmin", email: caEmail }); setCaEmail(""); }}>Add</button>
          </div>
        </section>

        <section className="adm-card" aria-labelledby="adm-overrides">
          <h2 className="adm-label" id="adm-overrides">Per-team role overrides</h2>
          <div className="adm-body">
            Wins over the defaults for one person on one team: keep a Team A coach to parent-only on Team B,
            or block access entirely. The super admin can't be overridden.
          </div>
          <div className="adm-rows">
            {overrideRows.length === 0 && <div className="adm-empty">No overrides set.</div>}
            {overrideRows.map(({ email, slug, role }) => (
              <div key={email + slug} className="adm-row">
                <span className="adm-row-main">{email}<span className="adm-row-sub" style={{ display: "block", fontWeight: 400 }}>{teamName(slug)}</span></span>
                <span className={"adm-pill lg" + (ROLE_TONES[role] || "")}>{ROLE_LABELS[role] || role}</span>
                <button disabled={busy} className="adm-btn soft sm" aria-label={`Clear the override for ${email} on ${teamName(slug)}`}
                  onClick={() => post({ action: "setOverride", email, teamSlug: slug, role: null })}>Clear</button>
              </div>
            ))}
          </div>
          {state.teams.length === 0 ? (
            <div className="adm-note" style={{ marginTop: 10 }}>Add a team first, then set overrides for it here.</div>
          ) : (
            <div className="adm-form">
              <input className="adm-inp" style={{ flex: "1 1 100%" }} type="email" aria-label="Email for the override" placeholder="parent@example.com" value={ovEmail} onChange={(e) => setOvEmail(e.target.value)} />
              <select className="adm-inp grow" aria-label="Team" value={ovTeam} onChange={(e) => setOvTeam(e.target.value)}>
                {state.teams.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
              <select className="adm-inp auto" aria-label="Role" value={ovRole} onChange={(e) => setOvRole(e.target.value)}>
                {state.roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
              <button disabled={busy || !ovEmail.includes("@") || !ovTeam} className="adm-btn"
                onClick={() => { post({ action: "setOverride", email: ovEmail, teamSlug: ovTeam, role: ovRole }); setOvEmail(""); }}>Set</button>
            </div>
          )}
        </section>
      </>)}

      {/* The role table: under Access for a super admin, on the one page for a club admin. */}
      {(superAdmin ? showing("access") : true) && (
        <details className="adm-card adm-fold">
          <summary>
            <h2 className="adm-label">Who can do what</h2>
            <span className="hint">Every role, every feature</span>
            <ChevronRight className="chev" size={18} aria-hidden="true" />
          </summary>
          <div className="adm-fold-body"><RoleMatrix /></div>
        </details>
      )}

      {showing("teams") && <Link href="/league" className="adm-card adm-linkcard">
        <span className="adm-lc-ic" aria-hidden="true"><Trophy size={18} /></span>
        <span className="adm-lc-body">
          <span className="adm-lc-title">League page</span>
          <span className="adm-lc-sub">The Squadi draw and ladder, its filter setup and fixture sync</span>
        </span>
        <ChevronRight className="chev" size={18} aria-hidden="true" />
      </Link>}
    </AdminPage>
  );
}
