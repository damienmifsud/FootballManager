"use client";
// People (club admin, super admins only): everyone with a login, and
// everything each is attached to. One card per person with their roles as
// pills; tapping a card opens it to change their role on a team, add them to
// another, make them a club admin, or view the site as them.
//
// Roles come from each team's own lists (its staff, the emails on its
// players' records). What is changed here is the club's say on top of those
// lists for one person on one team, the same overrides the Access section
// lists, so nothing on a team's roster is edited from this page. Reads
// /api/people; writes go through /api/access.
import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronRight, Eye } from "lucide-react";
import { hatLabel } from "@/lib/hats";
import { shortTeamNames, personPills, personInitials, filterPeople, ownRoles, OVERRIDE_LABELS } from "@/lib/people";

const TONE = { club: " bad", staff: " ok", family: " info", plain: "", blocked: " warn" };
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

export default function PeopleDirectory({ onChanged }) {
  const [data, setData] = useState(null); // { teams, people }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(""); // the email whose card is open
  const [add, setAdd] = useState({ team: "", role: "coach" });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/people", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not load the people list.");
      setData(j);
    } catch (e) { setErr(String(e.message || e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not save that.");
      await load();
      onChanged?.();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  const viewAs = async (email) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "viewAs", email }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not start view-as.");
      window.location.href = "/"; // straight into their view
    } catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };

  const teams = data?.teams || [];
  const short = useMemo(() => shortTeamNames(teams.map((t) => t.name)), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = data?.people || [];
  const shown = useMemo(() => filterPeople(people, q), [people, q]);
  const toggle = (email) => { setOpen((cur) => (cur === email ? "" : email)); setAdd({ team: "", role: "coach" }); };

  if (!data && !err) return <div className="adm-card quiet">Loading people…</div>;

  return (<>
    {err && <div className="adm-msg err" role="alert">{err}</div>}
    {data && (<>
      <input className="adm-inp" type="search" aria-label="Search people" placeholder="Search a name, email or team" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="adm-note adm-people-count" role="status">
        {people.length === 0 ? "Nobody has a login yet."
          : q.trim() ? `${shown.length} of ${people.length} ${people.length === 1 ? "person" : "people"}`
          : `${people.length} ${people.length === 1 ? "person" : "people"} with a login`}
      </div>
      {people.length === 0 && (
        <div className="adm-card quiet">People appear here once their email is on a team's staff list or on a player's record.</div>
      )}
      {people.length > 0 && shown.length === 0 && <div className="adm-card quiet">Nobody matches that search.</div>}

      {shown.map((p) => {
        const isOpen = open === p.email;
        const who = p.name || p.email;
        const id = "person-" + p.email.replace(/[^a-z0-9]/gi, "-");
        const pills = personPills(p, teams, short);
        // The teams this person has a role of their own on, or that the club has said something about.
        const slugs = [...new Set([...(p.teams || []).filter((t) => t.mine).map((t) => t.teamSlug), ...Object.keys(p.overrides || {})])];
        const rows = slugs.map((slug) => {
          const team = (p.teams || []).find((t) => t.teamSlug === slug);
          const name = teams.find((t) => t.slug === slug)?.name || team?.teamName || slug;
          const override = (p.overrides || {})[slug] || "";
          const roles = override === "blocked" ? "No access" : (ownRoles(team).map(hatLabel).join(" · ") || "View only");
          return { slug, name, override, roles };
        }).sort((a, b) => a.name.localeCompare(b.name));
        const others = teams.filter((t) => !slugs.includes(t.slug));
        return (
          <div className={"adm-card adm-person" + (isOpen ? " open" : "")} key={p.email}>
            <button className="adm-person-head" aria-expanded={isOpen} aria-controls={id} onClick={() => toggle(p.email)}>
              <span className="disc" aria-hidden="true">{personInitials(p)}</span>
              <span className="who"><b>{who}</b>{p.name && <span>{p.email}</span>}</span>
              <ChevronRight className="chev" size={18} aria-hidden="true" />
            </button>
            {pills.length > 0 && (
              <div className="adm-person-pills">
                {pills.map((pill) => <span key={pill.text} className={"adm-pill lg wrap" + TONE[pill.tone]}>{pill.text}</span>)}
              </div>
            )}
            {isOpen && (
              <div className="adm-person-body" id={id}>
                {p.superAdmin ? (
                  <div className="adm-note">Super admin, set in the site's settings. A super admin has coach access to every team, so there is nothing to change here.</div>
                ) : (<>
                  {rows.map((row) => (
                    <div className="adm-person-team" key={row.slug}>
                      <div className="t"><b>{row.name}</b><span>{row.roles}</span></div>
                      <select className="adm-inp auto" aria-label={`Role for ${who} on ${row.name}`} value={row.override} disabled={busy}
                        onChange={(e) => post({ action: "setOverride", email: p.email, teamSlug: row.slug, role: e.target.value || null })}>
                        <option value="">As listed</option>
                        {Object.entries(OVERRIDE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                  ))}
                  {others.length > 0 && (
                    <div className="adm-person-add">
                      <select className="adm-inp team" aria-label={`Add ${who} to a team`} value={add.team} disabled={busy} onChange={(e) => setAdd({ ...add, team: e.target.value })}>
                        <option value="">Add to a team…</option>
                        {others.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                      </select>
                      <select className="adm-inp" aria-label="Role on that team" value={add.role} disabled={busy} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                        <option value="coach">Coach</option>
                        <option value="viewer">View only</option>
                        <option value="blocked">No access</option>
                      </select>
                      <button className="adm-btn sm" disabled={busy || !add.team}
                        onClick={() => { post({ action: "setOverride", email: p.email, teamSlug: add.team, role: add.role }); setAdd({ team: "", role: "coach" }); }}>Add</button>
                    </div>
                  )}
                  <div className="adm-person-acts">
                    <button className="adm-btn soft sm" disabled={busy} onClick={() => viewAs(p.email)}><Eye size={14} aria-hidden="true" />View as {firstName(p.name) || "them"}</button>
                    {!p.clubAdmin && <button className="adm-btn soft sm" disabled={busy} onClick={() => post({ action: "addClubAdmin", email: p.email })}>Make club admin</button>}
                    {p.clubAdmin === "stored" && <button className="adm-btn danger sm" disabled={busy} onClick={() => post({ action: "removeClubAdmin", email: p.email })}>Remove club admin</button>}
                  </div>
                  {p.clubAdmin === "env" && <div className="adm-note">Club admin, set in the site's settings.</div>}
                </>)}
              </div>
            )}
          </div>
        );
      })}
      {people.length > 0 && (
        <div className="adm-note adm-people-foot">
          Roles come from each team's own staff and squad lists. Choosing a role here sets it for that person on that team only;
          <b> As listed</b> goes back to the team's lists.
        </div>
      )}
    </>)}
  </>);
}
